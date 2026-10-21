/**
 * The kinds of thing a saved item can be.
 *
 * These describe research material rather than bookkeeping: an article worth
 * citing, a quote to reuse, a statistic to check, a definition, a person, a
 * product, an event, and the plain formats a clip can arrive in.
 */
export const RECORD_TYPES = [
  "article", "quote", "statistic", "definition", "person", "product", "event",
  "webpage", "highlight", "document", "image", "bookmark", "note", "link", "other",
] as const;

export const CAPTURE_KINDS = [
  "selection", "page", "page-text", "link", "image", "document", "note",
] as const;

export const VAULT_KINDS = ["personal", "workspace"] as const;
export const VAULT_ITEM_STATUSES = ["inbox", "reviewed", "archived", "trashed"] as const;
export const PRIVACY_LEVELS = ["private", "workspace", "cloud-ai-opt-in"] as const;

export const CREATED_VIA = ["website", "extension", "api", "import"] as const;
export const SOURCE_TYPES = ["manual", "browser_extension", "api", "import"] as const;

export const PERMISSIONS = [
  "captures.read", "captures.create", "captures.update", "captures.delete",
  "records.read", "records.create", "records.update", "records.delete",
  "notes.read", "notes.create", "notes.update", "notes.delete",
  "reports.read", "users.manage", "settings.manage", "ai.use",
] as const;

export const BUILT_IN_ROLES = ["super_admin", "admin", "editor", "viewer", "custom"] as const;
