export const RECORD_TYPES = [
  "payment", "expense", "income", "receipt", "invoice", "subscription",
  "customer", "vendor", "refund", "note", "webpage", "highlight", "document",
  "image", "product", "travel", "bookmark", "other",
] as const;

export const CAPTURE_KINDS = [
  "selection", "page", "page-text", "link", "image", "document", "note", "receipt",
] as const;

export const VAULT_KINDS = ["personal", "workspace"] as const;
export const VAULT_ITEM_STATUSES = ["inbox", "reviewed", "archived", "trashed"] as const;
export const PRIVACY_LEVELS = ["private", "workspace", "cloud-ai-opt-in"] as const;

export const CREATED_VIA = ["website", "extension", "api", "import"] as const;
export const SOURCE_TYPES = ["manual", "browser_extension", "api", "import"] as const;
export const PAYMENT_DIRECTIONS = ["incoming", "outgoing"] as const;
export const PAYMENT_STATUSES = [
  "pending", "completed", "failed", "cancelled", "partially_paid", "partially_refunded", "refunded",
] as const;
export const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"] as const;
export const INVOICE_KINDS = ["receivable", "payable"] as const;
export const RECURRING_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "yearly", "custom"] as const;
export const RECURRING_STATUSES = ["active", "paused", "completed", "cancelled"] as const;

export const PERMISSIONS = [
  "payments.read", "payments.create", "payments.update", "payments.archive", "payments.refund",
  "captures.read", "captures.create", "captures.update", "captures.delete",
  "invoices.read", "invoices.create", "invoices.update",
  "customers.read", "customers.create", "customers.update",
  "vendors.read", "vendors.create", "vendors.update",
  "reports.read", "users.manage", "settings.manage", "ai.use",
] as const;

export const BUILT_IN_ROLES = ["super_admin", "admin", "accountant", "viewer", "custom"] as const;
