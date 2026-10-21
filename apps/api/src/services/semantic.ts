import { and, eq, sql } from "drizzle-orm";
import { recordEmbeddings, savedRecords, withTenant } from "@data-vault/database";
import type { ServerEnvironment } from "@data-vault/config";
import type { TenantContext } from "../auth/context";
import { AppError } from "../lib/errors";
import { EMBEDDING_MODEL, embedText } from "./gemini";

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
 */
export async function indexRecord(env: ServerEnvironment, context: TenantContext, recordId: string, title: string, text: string | null, model = EMBEDDING_MODEL): Promise<boolean> {
  const body = textForEmbedding(title, text);
  if (!body.trim()) return false;
  const embedding = await embedText(env, body).catch(() => null);
  if (!embedding) return false;
  return withTenant(context.organizationId, async (tx) => {
    await tx.delete(recordEmbeddings).where(and(eq(recordEmbeddings.organizationId, context.organizationId), eq(recordEmbeddings.savedRecordId, recordId)));
    await tx.insert(recordEmbeddings).values({ organizationId: context.organizationId, savedRecordId: recordId, model, embedding });
    return true;
  });
}

/**
 * The items whose numbers are closest to the numbers of a question.
 *
 * The numbers of the question are made by the caller, so that the search
 * itself is only about the numbers and not about the model.
 */
export async function semanticSearch(context: TenantContext, embedding: number[], limit = 20, model = EMBEDDING_MODEL): Promise<{ items: SemanticResult[]; total: number }> {
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
 * This is what is needed after the model has changed, or after material has
 * been brought in from somewhere else.
 */
export async function reindexWorkspace(context: TenantContext, env: ServerEnvironment, options: { limit?: number } = {}): Promise<{ indexed: number; skipped: number }> {
  const limit = options.limit ?? 200;
  const records = await withTenant(context.organizationId, (tx) => tx
    .select({ id: savedRecords.id, title: savedRecords.title, text: savedRecords.originalText })
    .from(savedRecords)
    .where(eq(savedRecords.organizationId, context.organizationId))
    .limit(limit));
  let indexed = 0;
  let skipped = 0;
  for (const record of records) {
    const body = textForEmbedding(record.title, record.text);
    if (!body.trim()) {
      skipped += 1;
      continue;
    }
    try {
      const embedding = await embedText(env, body);
      await withTenant(context.organizationId, async (tx) => {
        await tx.delete(recordEmbeddings).where(and(eq(recordEmbeddings.organizationId, context.organizationId), eq(recordEmbeddings.savedRecordId, record.id)));
        await tx.insert(recordEmbeddings).values({ organizationId: context.organizationId, savedRecordId: record.id, model: EMBEDDING_MODEL, embedding });
      });
      indexed += 1;
    } catch {
      skipped += 1;
    }
  }
  return { indexed, skipped };
}
