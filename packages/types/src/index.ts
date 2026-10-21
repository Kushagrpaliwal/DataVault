import type { z } from "zod";
import type {
  captureCreateSchema, invoiceCreateSchema, loginSchema, noteSchema, noteSummarySchema, organizationCreateSchema, parsedCaptureSchema,
  paymentCreateSchema, registerSchema, savedRecordCreateSchema, savedRecordSchema, vaultCreateSchema,
} from "@data-vault/schemas";

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
export type SavedRecordCreateInput = z.infer<typeof savedRecordCreateSchema>;
export type SavedRecord = z.infer<typeof savedRecordSchema>;
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type CaptureCreateInput = z.infer<typeof captureCreateSchema>;
export type ParsedCapture = z.infer<typeof parsedCaptureSchema>;
export type VaultCreateInput = z.infer<typeof vaultCreateSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteSummary = z.infer<typeof noteSummarySchema>;

/** How new clips are sorted into a doc. */
export type ArrangeMode = "page" | "site" | "day" | "none";

/** The doc content, as the editor stores it. */
export type NoteContent = Record<string, unknown>;

/** A piece of a web page that was added to a doc. */
export interface NoteClip {
  clipId: string;
  hash: string;
  sourceUrl: string;
  sourceTitle: string;
  domain: string;
  capturedAt: string;
}

/** What the API answers after a clip was added. */
export interface NoteClipResult {
  clipId: string;
  sectionTitle: string;
  duplicate: boolean;
  noteTitle: string;
  noteId: string;
  version: number;
  clipCount: number;
}

/** An earlier version of a doc. */
export interface NoteRevision {
  id: string;
  noteId: string;
  version: number;
  title: string;
  reason: "autosave" | "ai-organize" | "ai-write-up" | "conflict" | "restore";
  createdAt: string;
}

/** A part of a written doc. */
export interface NoteWriteUpSection {
  heading: string;
  paragraphs: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency: string;
  locale: string;
  timeZone: string;
  role: string;
  permissions: string[];
  isPersonal: boolean;
}

export interface Vault {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  kind: "personal" | "workspace";
  color: string;
  isDefault: boolean;
  /** How many saved items are in this folder. */
  itemCount?: number;
  createdAt: string;
}

export interface VaultCollection {
  id: string;
  vaultId: string;
  name: string;
  color: string;
  itemCount?: number;
}

export interface VaultTag {
  id: string;
  name: string;
  color: string;
  itemCount?: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiError };

export interface PaginationResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuthSession {
  user: User;
  organizations: Organization[];
  csrfToken?: string;
}

/** A browser that has been authorised to use an account. */
export interface ExtensionSession {
  id: string;
  organizationId: string;
  userAgent: string | null;
  extensionVersion: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface ExtensionTokenSet {
  accessToken: string;
  refreshToken: string;  expiresIn: number;
  sessionId: string;
  organizationId: string;
}

export interface SearchResult {
  id: string;
  resourceType: string;
  title: string;
  subtitle: string | null;
  amount: string | null;
  currency: string | null;
  occurredAt: string | null;
}

export interface DashboardSummary {
  totalReceived: string;
  totalPaid: string;
  netCashFlow: string;
  pendingPayments: string;
  outstandingInvoices: string;
  refunds: string;
  savedRecords: number;
  extensionCaptures: number;
  /** Items saved in the last seven days. */
  savedThisWeek: number;
  /** How many distinct websites the workspace has saved from. */
  uniqueSources: number;
  /** Timestamp of the most recently saved item, or null when there are none. */
  lastSavedAt: string | null;
}

/** Which sign-in methods this server offers. */
export interface AuthMethods {
  emailAndPassword: boolean;
  emailOtp: boolean;
  twoFactor: boolean;
  /** True when the signup captcha is active. */
  captcha: boolean;
  captchaSiteKey: string | null;
}

/** The user's free AI allowance and why it may be locked. */
export interface AiCreditStatus {
  /** Credits left in the current period. */
  remaining: number;
  /** The allowance the user is currently entitled to. */
  allowance: number;
  /** The allowance the account was granted at the start of the period. */
  baseAllowance: number;
  used: number;
  periodStart: string;
  periodEnd: string;
  /** Requests left in the shared daily budget. */
  dailyBudgetRemaining: number;
  /** The email address has been confirmed. */
  emailVerified: boolean;
  /** The user agreed to send content to the model provider. */
  consented: boolean;
  /** True when the AI features are switched off entirely. */
  available: boolean;
  /** Why the AI features are unavailable, when they are. */
  reason: string | null;
}

export interface AiActivityEntry {
  id: string;
  kind: string;
  credits: number;
  reason: string | null;
  createdAt: string;
}

export interface AiSummaryResult {
  summary: string;
  keyPoints: string[];
  suggestedTitle: string;
}

export interface AiClassificationResult {
  recordType: string;
  tags: string[];
  confidence: number;
  reason: string;
}

export interface AiExtractionResult {
  title: string;
  amount?: string;
  currency?: string;
  date?: string;
  party?: string;
  reference?: string;
  paymentMethod?: string;
}

export interface AiRunResult<T = unknown> {
  data: T;
  /** True when the answer was served from cache and cost no credit. */
  cached: boolean;
  /** Credits left after this request. */
  remaining: number;
  inputTokens: number;
  outputTokens: number;
}
