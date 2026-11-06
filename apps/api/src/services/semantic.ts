import { and, eq, isNull, sql } from "drizzle-orm";
import { aiResponseCache, getDatabase, recordEmbeddings, savedRecords, withTenant } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { resolveAi } from "./ai";
import { embedTextForTarget, embeddingModelFor } from "./ai-provider";

/**
 * The numbers that say what a saved item is about.
 *
 * A search by meaning is not a search for words. It is a search for the
 * items whose numbers are close to the numbers of the question, which is
 * how an item about the sea is found by a question that never says the word
 * sea.
 */
export interface SemanticResult {
  id: string;
  title: string;
  resourceType: string;
  sourceDomain: string | null;
  /** How close the item is to the question, between -1 and 1. */
  similarity: number;
  snippet: string | null;
  createdAt: string;
}

/**
 * The text of an item, as it is given to the model.
 *
 * The title says the most about an item, so it is written first and it is
 * written twice, which is how a model is told that it matters.
 */
export function textForEmbedding(title: string | null | undefined, text: string | null | undefined): string {
  const name = (title ?? "").trim();
  const body = (text ?? "").trim();
  if (!name) return body.slice(0, 8_000);
  return `${name}\n${name}\n${body}`.slice(0, 8_000);
}

/**
 * Keep the numbers of a saved item.
 *
 * The numbers are made once and kept, so that a search does not have to ask
 * the model about every item in the workspace.
 *
 * Embeddings are created only through the user's connected provider. If no
 * provider is configured or it cannot embed, saving the item still succeeds.
 */
export async function indexRecord(
  env: ServerEnvironment,
  context: TenantContext,
  recordId: string,
  title: string,
  text: string | null,
): Promise<boolean> {
  const body = textForEmbedding(title, text);
  if (!body.trim()) return false;
  let resolved: Awaited<ReturnType<typeof resolveAi>>;
  try {
    resolved = await resolveAi(env, { userId: context.userId, organizationId: context.organizationId });
  } catch {
    return false;
  }
  let model: string;
  let embedding: number[];
  try {
    model = embeddingIndexKey(resolved.connectionId, resolved.target, env);
    embedding = await embedTextForTarget(env, resolved.target, body, "document");
  } catch {
    return false;
  }
  return withTenant(context.organizationId, async (tx) => {
    await tx.delete(recordEmbeddings).where(and(eq(recordEmbeddings.organizationId, context.organizationId), eq(recordEmbeddings.savedRecordId, recordId)));
    await tx.insert(recordEmbeddings).values({ organizationId: context.organizationId, savedRecordId: recordId, model, embedding });
    return true;
  });
}

/**
 * The numbers of a question.
 *
 * A question that is asked twice must not cost twice, so the numbers are
 * kept in the same place the written answers are kept, and the second
 * question is answered from there.
 */
export async function embedQuery(env: ServerEnvironment, context: TenantContext, question: string): Promise<{ values: number[]; model: string }> {
  const resolved = await resolveAi(env, { userId: context.userId, organizationId: context.organizationId });
  const model = embeddingIndexKey(resolved.connectionId, resolved.target, env);
  const contentHash = await sha256(`${context.userId}\n${resolved.connectionId}\n${model}\n${question.trim()}`);
  const [row] = await getDatabase()
    .select({ response: aiResponseCache.response })
    .from(aiResponseCache)
    .where(and(eq(aiResponseCache.contentHash, contentHash), eq(aiResponseCache.feature, "embed-query")))
    .limit(1);
  const cached = row?.response?.values;
  if (Array.isArray(cached) && cached.length && cached.every((value) => typeof value === "number")) {
    return { values: cached as number[], model };
  }
  const values = await embedTextForTarget(env, resolved.target, question, "query");
  await getDatabase()
    .insert(aiResponseCache).values({ contentHash, feature: "embed-query", model, response: { values } })
    .onConflictDoUpdate({
      target: [aiResponseCache.contentHash, aiResponseCache.feature],
      set: { response: { values }, createdAt: new Date() },
    });
  return { values, model };
}

function embeddingIndexKey(connectionId: string, target: Parameters<typeof embeddingModelFor>[0], env: ServerEnvironment): string {
  const model = embeddingModelFor(target, env);
  const host = new URL(target.baseUrl).host.toLowerCase();
  return `${connectionId}:${target.kind}:${host}:${model}`;
}

/**
 * The items whose numbers are closest to the numbers of a question.
 *
 * The numbers of the question are made by the caller, so that the search
 * itself is only about the numbers and not about the model.
 */
export async function semanticSearch(
  context: TenantContext,
  embedding: number[],
  model: string,
  limit = 20,
): Promise<{ items: SemanticResult[]; total: number }> {
  if (!embedding.length) throw new AppError(400, "AI_EMPTY_INPUT", "There is nothing to work with yet.");
  /**
   * The numbers of the question are written into the statement, because
   * PostgreSQL has to be told that they are a list of numbers and not a
   * list of words. They come from the model, and anything that is not a
   * number is written as a zero.
   */
  const numbers = embedding.map((value) => (Number.isFinite(value) ? String(value) : "0")).join(",");
  return withTenant(context.organizationId, async (tx) => {
    const rows = await tx.execute(sql`
      select
        record.id as id,
        record.title as title,
        record.record_type as "resourceType",
        record.source_domain as "sourceDomain",
        record.created_at as "createdAt",
        datavault_cosine(embedding.embedding, ARRAY[${sql.raw(numbers)}]::real[]) as similarity,
        left(coalesce(record.original_text, record.title), 220) as snippet
      from record_embeddings embedding
      inner join saved_records record on record.id = embedding.saved_record_id
      where embedding.organization_id = ${context.organizationId}
        and record.organization_id = ${context.organizationId}
        and embedding.model = ${model}
        and record.deleted_at is null
        and record.archived_at is null
      order by similarity desc, record.created_at desc
      limit ${limit}
    `);
    const items = (rows as unknown as SemanticResult[]) ?? [];
    return { items, total: items.length };
  });
}

/**
 * Make the numbers of every item in the workspace again.
 *
 * This is what is needed after the model has changed, or after material
 * has been brought in from somewhere else.
 *
 * The items that already have numbers for the connected provider are left
 * alone, and the trashed ones are left out. The number still waiting is
 * returned so that a large workspace can be handled in batches.
 */
export async function reindexWorkspace(
  context: TenantContext,
  env: ServerEnvironment,
  options: { limit?: number } = {},
): Promise<{ indexed: number; skipped: number; remaining: number }> {
  const resolved = await resolveAi(env, { userId: context.userId, organizationId: context.organizationId });
  const model = embeddingIndexKey(resolved.connectionId, resolved.target, env);
  const limit = options.limit ?? 200;

  const records = await withTenant(context.organizationId, (tx) => tx
    .select({ id: savedRecords.id, title: savedRecords.title, text: savedRecords.originalText })
    .from(savedRecords)
    .where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.deletedAt)))
    .orderBy(savedRecords.createdAt)
    .limit(limit));
  const counted = await withTenant(context.organizationId, (tx) => tx
    .select({ value: sql<number>`count(*)::int` })
    .from(savedRecords)
    .where(and(eq(savedRecords.organizationId, context.organizationId), isNull(savedRecords.deletedAt))));
  const total = counted[0]?.value ?? 0;

  /**
   * The items that already have numbers for this model are not given them
   * again, so the ones that are already right are left alone.
   */
  const done = new Set((await withTenant(context.organizationId, (tx) => tx
    .select({ recordId: recordEmbeddings.savedRecordId })
    .from(recordEmbeddings)
    .where(and(eq(recordEmbeddings.organizationId, context.organizationId), eq(recordEmbeddings.model, model)))))
    .map((row) => row.recordId));

  let indexed = 0;
  let skipped = 0;
  for (const record of records) {
    if (done.has(record.id)) {
      skipped += 1;
      continue;
    }
    const body = textForEmbedding(record.title, record.text);
    if (!body.trim()) {
      skipped += 1;
      continue;
    }
    try {
      const embedding = await embedTextForTarget(env, resolved.target, body, "document");
      await withTenant(context.organizationId, async (tx) => {
        await tx.delete(recordEmbeddings).where(and(eq(recordEmbeddings.organizationId, context.organizationId), eq(recordEmbeddings.savedRecordId, record.id)));
        await tx.insert(recordEmbeddings).values({ organizationId: context.organizationId, savedRecordId: record.id, model, embedding });
      });
      indexed += 1;
    } catch {
      skipped += 1;
    }
  }
  /**
   * The items that were not looked at are the ones that are still waiting,
   * because the run only covers a number of items at a time.
   */
  const looked = indexed + skipped;
  return { indexed, skipped, remaining: Math.max(0, total - looked) };
}
