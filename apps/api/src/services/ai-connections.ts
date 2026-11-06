import { and, eq } from "drizzle-orm";
import { aiConnections, aiConsents, withAccount, withUser } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { z } from "zod";
import { detectProviderFromKey } from "@data-vault/schemas";
import type { aiConnectionCreateSchema, aiConnectionPatchSchema, aiConnectionTestSchema } from "@data-vault/schemas";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { keyHint, openSecret, sealSecret } from "../lib/secret-box";
import { writeAudit } from "./audit";
import { listModels, normalizeBaseUrl, probeModel, type AiTarget } from "./ai-provider";

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
 * The key is not returned, because the interface only needs to say which
 * provider is in use. Whether the key can actually be read is said though,
 * because a provider that is listed but whose key cannot be opened would
 * quietly answer from the shared one instead, and the person would think
 * their own key was being used.
 */
export async function ownConnectionSummary(env: ServerEnvironment, userId: string): Promise<{ label: string; preset: string; model: string; keyReadable: boolean } | null> {
  const connection = await defaultConnection(userId).catch(() => undefined);
  if (!connection) return null;
  if (!connection.encryptedKey) return { label: connection.label, preset: connection.preset, model: connection.model, keyReadable: true };
  try {
    await connectionKey(env, userId, connection);
    return { label: connection.label, preset: connection.preset, model: connection.model, keyReadable: true };
  } catch {
    return { label: connection.label, preset: connection.preset, model: connection.model, keyReadable: false };
  }
}

/**
 * The host a provider is called at.
 *
 * The key of a provider belongs to that provider, so the host is part of
 * what the key is tied to. A key that was given for one host will not open
 * for another, and so it is never sent to one.
 */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl.trim().toLowerCase();
  }
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
  return openSecret(env.aiKeyEncryptionKey, userId, connection.id, connection.encryptedKey, hostOf(connection.baseUrl));
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
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const encryptedKey = input.apiKey && env.aiKeyEncryptionKey
    ? await sealSecret(env.aiKeyEncryptionKey, context.userId, id, input.apiKey, hostOf(baseUrl))
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
      baseUrl,
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
 *
 * The address of a connection that holds a key cannot be changed without
 * the key being given again. The address is written by the person, and the
 * key is sent to the address in the header of every request, so a session
 * that was stolen could point a connection at a server of its own and read
 * the key out of the request. The key is tied to the host it was given for
 * as well, so it will not open for another one.
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
    const baseUrl = input.baseUrl ? normalizeBaseUrl(input.baseUrl) : existing.baseUrl;
    /**
     * A key that is given for one host is not given for another, so moving
     * a connection to another host means giving the key again.
     */
    if (existing.encryptedKey && hostOf(baseUrl) !== hostOf(existing.baseUrl) && !input.apiKey) {
      throw new AppError(400, "AI_KEY_REQUIRED_FOR_NEW_ADDRESS", "Enter the key again to move this connection to another address.");
    }
    /**
     * A key that cannot be held is not taken. The old one is kept and the
     * last four of it are not changed either, so that what is shown is
     * always the key that is actually there.
     */
    if (input.apiKey && !env.aiKeyEncryptionKey) {
      throw new AppError(503, "AI_KEYS_UNAVAILABLE", "The server cannot hold the keys of the users right now.");
    }
    const encryptedKey = input.apiKey
      ? await sealSecret(env.aiKeyEncryptionKey!, context.userId, id, input.apiKey, hostOf(baseUrl))
      : existing.encryptedKey;
    const [updated] = await tx.update(aiConnections).set({
      ...(input.label ? { label: input.label } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.baseUrl ? { baseUrl } : {}),
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
 * What a check of a provider says.
 *
 * The key and the model are two different things. A provider may accept the
 * key and still not have the model, and the person needs to know which of
 * the two is the problem.
 */
export interface AiConnectionCheck {
  /** True when the provider accepted the key. */
  keyAccepted: boolean;
  /** The models the provider offers. */
  models: string[];
  /** The model that will be used. */
  model: string | null;
  /** True when that model answered when it was asked. Null when none was asked. */
  modelAnswered: boolean | null;
  /** What to say about it, in words. */
  detail: string;
}

/**
 * Try a provider, and ask it which models it has.
 *
 * The provider may be one that is already saved, or one that is being set
 * up, so that a person can see whether it works before they keep it.
 *
 * The answer says whether the key was accepted and which models the
 * provider offers, and whether the model that is chosen answers. A key that
 * was refused is said as such, because that is the thing the person can do
 * something about.
 */
export async function testConnection(env: ServerEnvironment, context: TenantContext, input: TestInput): Promise<AiConnectionCheck> {
  const id = input.id;
  if (id) {
    const rows = await withAccount(context.userId, (tx) => tx
      .select()
      .from(aiConnections)
      .where(and(eq(aiConnections.userId, context.userId), eq(aiConnections.id, id)))
      .limit(1));
    const connection = rows[0];
    if (!connection) throw new AppError(404, "NOT_FOUND", "That connection could not be found.");
    const target = await targetFor(env, context.userId, connection);
    const models = await listModels(env, target);
    /**
     * The model that is in use is asked to say one word, so that a model the
     * key cannot use is found out here.
     */
    const model = connection.model || models[0] || "";
    let probe = model ? await probeModel(env, { ...target, model }) : { answered: false, detail: "that provider has no models to show." };
    if (!probe.answered && models.length > 1) {
      for (const alt of models) {
        if (alt === model) continue;
        const altProbe = await probeModel(env, { ...target, model: alt });
        if (altProbe.answered) {
          probe = { answered: false, detail: `model “${model}” did not answer, but “${alt}” is working and available to use.` };
          break;
        }
      }
    }
    if (probe.answered) {
      await withUser(context.userId, context.organizationId, (tx) => tx
        .update(aiConnections)
        .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiConnections.id, connection.id)));
    }
    return {
      keyAccepted: true,
      models,
      model: model || null,
      modelAnswered: probe.answered,
      detail: probe.answered
        ? `Your key works. ${models.length} model${models.length === 1 ? " is" : "s are"} available.`
        : `Your key works, but ${probe.detail}`,
    };
  }
  let rawUrl = input.baseUrl;
  let kind = input.kind;
  let defaultModel = input.model ?? "";
  if (!rawUrl && input.apiKey) {
    const detected = detectProviderFromKey(input.apiKey);
    if (detected) {
      rawUrl = detected.baseUrl;
      kind = kind ?? detected.kind;
      defaultModel = defaultModel || detected.model;
    }
  }
  if (!rawUrl) throw new AppError(400, "AI_ENDPOINT_INVALID", "Say where the provider is or paste an API key.");
  const baseUrl = normalizeBaseUrl(rawUrl);
  const target = {
    kind: kind ?? "openai-compatible",
    baseUrl,
    apiKey: input.apiKey ?? "",
    model: defaultModel,
  };
  const models = await listModels(env, target);
  /**
   * Determine candidate model: user's requested model, target preset model if in list,
   * or the first available model.
   */
  let candidateModel = (input.model && models.includes(input.model) ? input.model : "")
    || (models.includes(target.model) ? target.model : "")
    || models[0]
    || "";
  let probe = candidateModel ? await probeModel(env, { ...target, model: candidateModel }) : null;
  if (probe && !probe.answered && models.length > 1) {
    const alts = models.filter((alt) => alt !== candidateModel).slice(0, 3);
    for (const alt of alts) {
      const altProbe = await probeModel(env, { ...target, model: alt });
      if (altProbe.answered) {
        candidateModel = alt;
        probe = altProbe;
        break;
      }
    }
  }
  return {
    keyAccepted: true,
    models,
    model: candidateModel || null,
    modelAnswered: probe ? probe.answered : null,
    detail: probe
      ? (probe.answered
        ? `Your key works. ${models.length} model${models.length === 1 ? " is" : "s are"} available.`
        : `Your key works, but ${probe.detail}`)
      : `Your key works. ${models.length} model${models.length === 1 ? " is" : "s are"} available.`,
  };
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
