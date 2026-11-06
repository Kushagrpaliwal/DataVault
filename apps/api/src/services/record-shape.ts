import type { savedRecords } from "@data-vault/database";
import type { SavedRecord } from "@data-vault/types";

/**
 * The shape of a saved item on the wire.
 *
 * It lives on its own so that every service can use it without one of them
 * having to import another.
 */
export function mapSavedRecord(row: typeof savedRecords.$inferSelect, tags?: unknown): SavedRecord {
  return {
    id: row.id, organizationId: row.organizationId, recordType: row.recordType, title: row.title,
    description: row.description, originalText: row.originalText, sourceType: row.sourceType,
    sourceUrl: row.sourceUrl, sourceDomain: row.sourceDomain, sourcePageTitle: row.sourcePageTitle,
    capturedAt: row.capturedAt?.toISOString() ?? null, createdVia: row.createdVia,
    vaultId: row.vaultId, captureKind: row.captureKind, reviewStatus: row.reviewStatus, privacyLevel: row.privacyLevel,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    tags: Array.isArray(tags) ? (tags as Array<{ id: string; name: string; color: string }>) : [],
  };
}
