import { and, eq } from "drizzle-orm";
import { aiConnections, aiConsents, withAccount, withUser } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { z } from "zod";
import type { aiConnectionCreateSchema, aiConnectionPatchSchema, aiConnectionTestSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { keyHint, openSecret, sealSecret } from "../lib/secret-box";
import { writeAudit } from "./audit";
import { listModels, type AiTarget } from "./ai-provider";

type CreateInput = z.infer<typeof aiConnectionCreateSchema>;
type PatchInput = z.infer<typeof aiConnectionPatchSchema>;
type TestInput = z.infer<typeof aiConnectionTestSchema>;

/**
 * What the person is told about a connection.
 *
 * The key is never in it. The last four of the key are, because that is
 * enough to tell two keys apart and not enough to use one.
 */
export interface AiConnectionSummary {
  id: string;
  label: string;
  kind: "openai-compatible" | "anthropic" | "gemini";
  preset: string;
  baseUrl: string;
  model: string;
  /** The last four of the key, such as `…4f2a`. */
  keyHint: string | null;
  isDefault: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
}

function summarize(row: typeof aiConnections.$inferSelect): AiConnectionSummary {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    preset: row.preset,
    baseUrl: row.baseUrl,
    model: row.model,
    keyHint: row.keyHint,
    isDefault: row.isDefault,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The connections of the person.
 *
 * The rows are read with the person in place, so that the rule on the table
 * hides the connections of anybody else.
 */
export async function listConnections(userId: string): Promise<AiConnectionSummary[]> {
  const rows = await withAccount(userId, (tx) => tx
    .select()
    .from(aiConnections)
    .where(eq(aiConnections.userId, userId))
    .orderBy(aiConnections.createdAt));
  return rows.map(summarize);
}

/**
 * The connection that is used when nothing else is named.
 *
 * The first one is used when nobody has marked one, so that a single
 * connection is enough and the person does not have to choose.
 */
export async function defaultConnection(userId: string): Promise<typeof aiConnections.$inferSelect | undefined> {
  const rows = await withAccount(userId, (tx) => tx
    .select()
    .from(aiConnections)
    .where(eq(aiConnections.userId, userId))
    .orderBy(aiConnections.isDefault, aiConnections.createdAt));
  return rows.find((row) => row.isDefault) ?? rows[0];
}

/**
 * The provider of the person, for the interface.
 *
 * The key is not read, because the interface only needs to say which
 * provider is in use.
 */
export async function ownConnectionSummary(userId: string): Promise<{ label: string; preset: string; model: string } | null> {
  const connection = await defaultConnection(userId).catch(() => undefined);
  if (!connection) return null;
  return { label: connection.label, preset: connection.preset, model: connection.model };
}

/**
 * The key of a connection, read at the moment it is needed.
 *
 * It is only read for the connection that is being used, and it is never
 * kept anywhere but in the memory of the request that is using it.
 */
export async function connectionKey(env: ServerEnvironment, userId: string, connection: typeof aiConnections.$inferSelect): Promise<string> {
  if (!connection.encryptedKey) return "";
  if (!env.aiKeyEncryptionKey) throw new AppError(500, "AI_KEYS_UNAVAILABLE", "The server cannot hold the keys of the users right now.");
  return openSecret(env.aiKeyEncryptionKey, userId, connection.id, connection.encryptedKey);
}

/**
 * The provider a request is made to.
 */
export async function targetFor(env: ServerEnvironment, userId: string, connection: typeof aiConnections.$inferSelect): Promise<AiTarget> {
  return {
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    apiKey: await connectionKey(env, userId, connection),
    model: connection.model,
  };
}

/**
 * Save a connection.
 *
 * The key is encrypted before it is written down, and it is never written
 * down in plain text. The agreement to send content to that provider is
 * recorded as well, because the person has chosen to use it.
 */
export async function createConnection(
  env: ServerEnvironment,
  context: TenantContext,
  request: Request,
  input: CreateInput,
): Promise<AiConnectionSummary> {
  if (!env.aiKeyEncryptionKey && input.apiKey) {
    throw new AppError(503, "AI_KEYS_UNAVAILABLE", "The server cannot hold the keys of the users right now.");
  }
  const id = crypto.randomUUID();
  const encryptedKey = input.apiKey && env.aiKeyEncryptionKey
    ? await sealSecret(env.aiKeyEncryptionKey, context.userId, id, input.apiKey)
    : null;
  const row = await withUser(context.userId, context.organizationId, async (tx) => {
    if (input.isDefault) {
      await tx.update(aiConnections).set({ isDefault: false, updatedAt: new Date() }).where(eq(aiConnections.userId, context.userId));
    }
    const [created] = await tx.insert(aiConnections).values({
      id,
      userId: context.userId,
      label: input.label,
      kind: input.kind,
      preset: input.preset,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      model: input.model,
      encryptedKey,
      keyHint: input.apiKey ? keyHint(input.apiKey) : null,
      isDefault: input.isDefault,
    }).returning();
    if (!created) throw new Error("Connection insert failed");
    /**
     * The person has chosen to use this provider, so the agreement to send
     * content to it is recorded.
     */
    await tx.insert(aiConsents).values({ userId: context.userId, provider: consentFor(input.kind, input.preset) }).onConflictDoNothing();
    await writeAudit(tx, context, request, { action: "created", resourceType: "ai_connection", resourceId: created.id, newValues: { label: created.label, kind: created.kind, preset: created.preset, model: created.model } });
    return created;
  });
  return summarize(row);
}

/**
 * Change a connection.
 *
 * The key may be replaced, and it is encrypted again when it is. The key
 * itself is never sent back to the browser.
 */
export async function patchConnection(
  env: ServerEnvironment,
  context: TenantContext,
  request: Request,
  id: string,
  input: PatchInput,
): Promise<AiConnectionSummary> {
  const row = await withUser(context.userId, context.organizationId, async (tx) => {
    const [existing] = await tx.select().from(aiConnections).where(and(eq(aiConnections.userId, context.userId), eq(aiConnections.id, id))).limit(1);
    if (!existing) throw new AppError(404, "NOT_FOUND", "That connection could not be found.");
    if (input.isDefault) {
      await tx.update(aiConnections).set({ isDefault: false, updatedAt: new Date() }).where(eq(aiConnections.userId, context.userId));
    }
    const encryptedKey = input.apiKey
      ? (env.aiKeyEncryptionKey ? await sealSecret(env.aiKeyEncryptionKey, context.userId, id, input.apiKey) : existing.encryptedKey)
      : existing.encryptedKey;
    const [updated] = await tx.update(aiConnections).set({
      ...(input.label ? { label: input.label } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl.replace(/\/+$/, "") } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.apiKey ? { encryptedKey, keyHint: keyHint(input.apiKey) } : {}),
      updatedAt: new Date(),
    }).where(and(eq(aiConnections.userId, context.userId), eq(aiConnections.id, id))).returning();
    if (!updated) throw new AppError(404, "NOT_FOUND", "That connection could not be found.");
    await writeAudit(tx, context, request, { action: "updated", resourceType: "ai_connection", resourceId: id, newValues: { label: updated.label, model: updated.model, isDefault: updated.isDefault } });
    return updated;
  });
  return summarize(row);
}

/**
 * Remove a connection.
 *
 * The key goes with it, and nothing else does.
 */
export async function deleteConnection(context: TenantContext, id: string): Promise<void> {
  await withUser(context.userId, context.organizationId, async (tx) => {
    const deleted = await tx.delete(aiConnections).where(and(eq(aiConnections.userId, context.userId), eq(aiConnections.id, id))).returning({ id: aiConnections.id });
    if (!deleted.length) throw new AppError(404, "NOT_FOUND", "That connection could not be found.");
  });
}

/**
 * Try a provider, and ask it which models it has.
 *
 * The provider may be one that is already saved, or one that is being set
 * up, so that a person can see whether it works before they keep it.
 */
export async function testConnection(env: ServerEnvironment, context: TenantContext, input: TestInput): Promise<{ models: string[]; model: string | null }> {
  const id = input.id;
  if (id) {
    const rows = await withAccount(context.userId, (tx) => tx
      .select()
      .from(aiConnections)
      .where(and(eq(aiConnections.userId, context.userId), eq(aiConnections.id, id)))
      .limit(1));
    const connection = rows[0];
    if (!connection) throw new AppError(404, "NOT_FOUND", "That connection could not be found.");
    const models = await listModels(env, await targetFor(env, context.userId, connection));
    await withUser(context.userId, context.organizationId, (tx) => tx
      .update(aiConnections)
      .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(aiConnections.id, connection.id)));
    return { models, model: connection.model };
  }
  if (!input.baseUrl) throw new AppError(400, "AI_ENDPOINT_INVALID", "Say where the provider is.");
  const models = await listModels(env, {
    kind: input.kind ?? "openai-compatible",
    baseUrl: input.baseUrl,
    apiKey: input.apiKey ?? "",
    model: input.model ?? "",
  });
  return { models, model: input.model ?? null };
}

/**
 * The name the agreement is recorded under.
 *
 * The agreement is about the provider, and a provider of one's own is not
 * Google, so the name says which one it is.
 */
function consentFor(kind: string, preset: string): string {
  if (kind === "anthropic") return "anthropic";
  if (kind === "gemini") return "gemini";
  return `own:${preset}`;
}
