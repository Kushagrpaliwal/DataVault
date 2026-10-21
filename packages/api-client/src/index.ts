import type {
  AiActivityEntry, AiClassificationResult, AiCreditStatus, AiExtractionResult, AiRunResult, AiSummaryResult,
  ApiResponse, AuthMethods, AuthSession, CaptureCreateInput, ExtensionSession, ExtensionTokenSet, Note, NoteClipResult,
  NoteRevision, NoteSummary, NoteWriteUpSection, Organization, PaginationResult, PaymentCreateInput, SavedRecord, Vault,
  VaultCollection, VaultCreateInput, VaultTag,
} from "@data-vault/types";

export class DataVaultApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "DataVaultApiError";
  }
}

export interface TokenProvider {
  getAccessToken(): Promise<string | null>;
  refreshAccessToken(): Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  organizationId?: () => string | null;
  csrfToken?: () => string | null;
  tokenProvider?: TokenProvider;
  fetcher?: typeof fetch;
}

type QueryValue = string | number | boolean | null | undefined;

function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class DataVaultApiClient {
  private readonly fetcher: typeof fetch;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(private readonly options: ApiClientOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, init: RequestInit = {}, query?: Record<string, QueryValue>, allowRefresh = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const organizationId = this.options.organizationId?.();
    if (organizationId) headers.set("X-Organization-Id", organizationId);
    const csrf = this.options.csrfToken?.();
    if (csrf && init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) headers.set("X-CSRF-Token", csrf);
    const token = await this.options.tokenProvider?.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await this.fetcher(`${this.options.baseUrl}${path}${queryString(query)}`, { ...init, headers, credentials: token ? "omit" : "include" });
    if (response.status === 401 && token && allowRefresh && this.options.tokenProvider) {
      this.refreshPromise ??= this.options.tokenProvider.refreshAccessToken().finally(() => { this.refreshPromise = null; });
      const refreshed = await this.refreshPromise;
      if (refreshed) return this.request<T>(path, init, query, false);
    }
    const payload = await response.json() as ApiResponse<T>;
    if (!payload.success) throw new DataVaultApiError(payload.error.code, payload.error.message, response.status, payload.error.details);
    return payload.data;
  }

  private async requestBlob(path: string, allowRefresh = true): Promise<Blob> {
    const headers = new Headers();
    const organizationId = this.options.organizationId?.();
    if (organizationId) headers.set("X-Organization-Id", organizationId);
    const token = await this.options.tokenProvider?.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await this.fetcher(`${this.options.baseUrl}${path}`, { headers, credentials: token ? "omit" : "include" });
    if (response.status === 401 && token && allowRefresh && this.options.tokenProvider) {
      this.refreshPromise ??= this.options.tokenProvider.refreshAccessToken().finally(() => { this.refreshPromise = null; });
      if (await this.refreshPromise) return this.requestBlob(path, false);
    }
    if (!response.ok) {
      try {
        const payload = await response.json() as ApiResponse<never>;
        if (!payload.success) throw new DataVaultApiError(payload.error.code, payload.error.message, response.status, payload.error.details);
      } catch (error) {
        if (error instanceof DataVaultApiError) throw error;
      }
      throw new DataVaultApiError("ATTACHMENT_DOWNLOAD_FAILED", "Could not load the attachment.", response.status);
    }
    return response.blob();
  }

  getMe = () => this.request<AuthSession>("/api/v1/me");
  authMethods = () => this.request<AuthMethods>("/api/v1/auth/methods");
  login = (body: { email: string; password: string }) => this.request<AuthSession>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) });
  register = (body: { name: string; email: string; password: string }) => this.request<AuthSession>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(body) });
  logout = () => this.request<void>("/api/v1/auth/logout", { method: "POST", body: "{}" });
  forgotPassword = (email: string) => this.request<void>("/api/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  resetPassword = (token: string, password: string) => this.request<void>("/api/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
  resendVerificationEmail = (email: string) => this.request<void>("/api/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ email }) });
  setPassword = (token: string, password: string) => this.request<{ email: string }>("/api/v1/auth/set-password", { method: "POST", body: JSON.stringify({ token, password }) });
  requestPasswordSetup = (email: string) => this.request<void>("/api/v1/auth/request-password-setup", { method: "POST", body: JSON.stringify({ email }) });
  aiCredits = () => this.request<AiCreditStatus>("/api/v1/ai/credits");
  aiActivity = () => this.request<AiActivityEntry[]>("/api/v1/ai/activity");
  aiConsent = () => this.request<{ consented: boolean }>("/api/v1/ai/consent", { method: "POST", body: JSON.stringify({ accepted: true }) });
  aiSummarize = (body: { recordId?: string; text?: string }, idempotencyKey: string = crypto.randomUUID()) => this.request<AiRunResult<AiSummaryResult>>("/api/v1/ai/summarize", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  aiClassify = (body: { recordId?: string; text?: string }, idempotencyKey: string = crypto.randomUUID()) => this.request<AiRunResult<AiClassificationResult>>("/api/v1/ai/classify", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  aiExtract = (body: { recordId?: string; text?: string }, idempotencyKey: string = crypto.randomUUID()) => this.request<AiRunResult<AiExtractionResult>>("/api/v1/ai/extract", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  listOrganizations = () => this.request<Organization[]>("/api/v1/organizations");
  createOrganization = (body: Record<string, unknown>) => this.request<Organization>("/api/v1/organizations", { method: "POST", body: JSON.stringify(body) });
  listSavedRecords = (query?: Record<string, QueryValue>) => this.request<PaginationResult<SavedRecord>>("/api/v1/saved-records", {}, query);
  getSavedRecord = (id: string) => this.request<SavedRecord & Record<string, unknown>>(`/api/v1/saved-records/${id}`);
  createSavedRecord = (body: Record<string, unknown>, idempotencyKey: string = crypto.randomUUID()) => this.request<SavedRecord>("/api/v1/saved-records", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  updateSavedRecord = (id: string, body: Record<string, unknown>) => this.request<SavedRecord>(`/api/v1/saved-records/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  archiveSavedRecord = (id: string) => this.request<void>(`/api/v1/saved-records/${id}/archive`, { method: "POST", body: "{}" });
  restoreSavedRecord = (id: string) => this.request<void>(`/api/v1/saved-records/${id}/restore`, { method: "POST", body: "{}" });
  deleteSavedRecord = (id: string) => this.request<{ id: string }>(`/api/v1/saved-records/${id}`, { method: "DELETE" });
  restoreTrashedRecord = (id: string) => this.request<SavedRecord>(`/api/v1/saved-records/${id}/trash/restore`, { method: "POST", body: "{}" });
  organizeSavedRecord = (id: string, body: Record<string, unknown>) => this.request<SavedRecord>(`/api/v1/saved-records/${id}/organization`, { method: "PUT", body: JSON.stringify(body) });
  listVaults = () => this.request<Vault[]>("/api/v1/vaults");
  createVault = (body: VaultCreateInput) => this.request<Vault>("/api/v1/vaults", { method: "POST", body: JSON.stringify(body) });
  updateVault = (id: string, body: Record<string, unknown>) => this.request<Vault>(`/api/v1/vaults/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  deleteVault = (id: string) => this.request<{ id: string }>(`/api/v1/vaults/${id}`, { method: "DELETE" });
  listCollections = (vaultId: string) => this.request<VaultCollection[]>(`/api/v1/vaults/${vaultId}/collections`);
  createCollection = (body: Record<string, unknown>) => this.request<VaultCollection>("/api/v1/collections", { method: "POST", body: JSON.stringify(body) });
  updateCollection = (id: string, body: Record<string, unknown>) => this.request<VaultCollection>(`/api/v1/collections/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  deleteCollection = (id: string) => this.request<{ id: string }>(`/api/v1/collections/${id}`, { method: "DELETE" });
  listTags = () => this.request<VaultTag[]>("/api/v1/tags");
  createTag = (body: Record<string, unknown>) => this.request<VaultTag>("/api/v1/tags", { method: "POST", body: JSON.stringify(body) });
  updateTag = (id: string, body: Record<string, unknown>) => this.request<VaultTag>(`/api/v1/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  deleteTag = (id: string) => this.request<{ id: string }>(`/api/v1/tags/${id}`, { method: "DELETE" });
  listSavedViews = () => this.request<Record<string, unknown>[]>("/api/v1/saved-views");
  createSavedView = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/saved-views", { method: "POST", body: JSON.stringify(body) });
  deleteSavedView = (id: string) => this.request<void>(`/api/v1/saved-views/${id}`, { method: "DELETE", body: "{}" });
  listPayments = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/payments", {}, query);
  getPayment = (id: string) => this.request<Record<string, unknown>>(`/api/v1/payments/${id}`);
  createPayment = (body: PaymentCreateInput, idempotencyKey = crypto.randomUUID()) => this.request<Record<string, unknown>>("/api/v1/payments", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  updatePayment = (id: string, body: Record<string, unknown>) => this.request<Record<string, unknown>>(`/api/v1/payments/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  refundPayment = (id: string, body: Record<string, unknown>, idempotencyKey = crypto.randomUUID()) => this.request<Record<string, unknown>>(`/api/v1/payments/${id}/refund`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  listCustomers = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/customers", {}, query);
  getCustomer = (id: string) => this.request<Record<string, unknown>>(`/api/v1/customers/${id}`);
  createCustomer = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/customers", { method: "POST", body: JSON.stringify(body) });
  updateCustomer = (id: string, body: Record<string, unknown>) => this.request<Record<string, unknown>>(`/api/v1/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  listVendors = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/vendors", {}, query);
  getVendor = (id: string) => this.request<Record<string, unknown>>(`/api/v1/vendors/${id}`);
  createVendor = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/vendors", { method: "POST", body: JSON.stringify(body) });
  updateVendor = (id: string, body: Record<string, unknown>) => this.request<Record<string, unknown>>(`/api/v1/vendors/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  listInvoices = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/invoices", {}, query);
  getInvoice = (id: string) => this.request<Record<string, unknown>>(`/api/v1/invoices/${id}`);
  createInvoice = (body: Record<string, unknown>, idempotencyKey = crypto.randomUUID()) => this.request<Record<string, unknown>>("/api/v1/invoices", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  updateInvoice = (id: string, body: Record<string, unknown>) => this.request<Record<string, unknown>>(`/api/v1/invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  listRecurring = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/recurring-payments", {}, query);
  createRecurring = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/recurring-payments", { method: "POST", body: JSON.stringify(body) });
  referenceData = () => this.request<{ categories: Record<string, unknown>[]; paymentMethods: Record<string, unknown>[] }>("/api/v1/settings/reference-data");
  createCategory = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/settings/categories", { method: "POST", body: JSON.stringify(body) });
  createPaymentMethod = (body: Record<string, unknown>) => this.request<Record<string, unknown>>("/api/v1/settings/payment-methods", { method: "POST", body: JSON.stringify(body) });
  createCapture = (body: CaptureCreateInput, idempotencyKey: string = crypto.randomUUID()) => this.request<Record<string, unknown>>("/api/v1/captures", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  recentCaptures = () => this.request<SavedRecord[]>("/api/v1/captures/recent");
  search = (q: string, page = 1, limit = 20) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/search", {}, { q, page, limit });
  dashboard = () => this.request<Record<string, unknown>>("/api/v1/dashboard");
  auditLogs = (query?: Record<string, QueryValue>) => this.request<PaginationResult<Record<string, unknown>>>("/api/v1/audit-logs", {}, query);
  report = (query: Record<string, QueryValue>) => this.request<Record<string, unknown>>("/api/v1/reports", {}, query);
  uploadScreenshot = (recordId: string, file: File) => { const form = new FormData(); form.set("file", file); return this.request<Record<string, unknown>>(`/api/v1/saved-records/${recordId}/attachments`, { method: "POST", body: form }); };
  getAttachmentBlob = (id: string) => this.requestBlob(`/api/v1/attachments/${id}`);
  extensionStart = (body: Record<string, unknown>) => this.request<{ authorizationUrl: string }>("/api/v1/extension/auth/start", { method: "POST", body: JSON.stringify(body) });
  extensionExchange = (body: Record<string, unknown>) => this.request<ExtensionTokenSet>("/api/v1/extension/auth/exchange", { method: "POST", body: JSON.stringify(body) });
  extensionApprove = (body: Record<string, unknown>) => this.request<{ redirectUrl: string }>("/api/v1/extension/auth/approve", { method: "POST", body: JSON.stringify(body) });
  extensionRefresh = (refreshToken: string) => this.request<ExtensionTokenSet>("/api/v1/extension/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) }, undefined, false);
  extensionLogout = (refreshToken: string) => this.request<void>("/api/v1/extension/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, undefined, false);
  listExtensionSessions = () => this.request<ExtensionSession[]>("/api/v1/extension/sessions");
  revokeExtensionSession = (id: string) => this.request<void>(`/api/v1/extension/sessions/${id}/revoke`, { method: "POST", body: "{}" });

  /** The docs of this workspace. */
  listNotes = (query?: Record<string, QueryValue>) => this.request<NoteSummary[]>("/api/v1/notes", {}, query);
  /** One doc, with its whole content. */
  getNote = (id: string) => this.request<Note & Record<string, unknown>>(`/api/v1/notes/${id}`);
  createNote = (body: Record<string, unknown>, idempotencyKey: string = crypto.randomUUID()) => this.request<Note>("/api/v1/notes", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  updateNote = (id: string, body: Record<string, unknown>) => this.request<Note>(`/api/v1/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  deleteNote = (id: string) => this.request<{ id: string }>(`/api/v1/notes/${id}`, { method: "DELETE" });
  restoreNote = (id: string) => this.request<Note>(`/api/v1/notes/${id}/restore`, { method: "POST", body: "{}" });
  /** Add a piece of a web page to a doc. */
  addNoteClip = (id: string, body: Record<string, unknown>) => this.request<NoteClipResult>(`/api/v1/notes/${id}/clips`, { method: "POST", body: JSON.stringify(body) });
  /** Take a piece back out of a doc. */
  removeNoteClip = (id: string, clipId: string) => this.request<{ id: string; clipId: string }>(`/api/v1/notes/${id}/clips/${clipId}`, { method: "DELETE" });
  listNoteRevisions = (id: string) => this.request<NoteRevision[]>(`/api/v1/notes/${id}/revisions`);
  restoreNoteRevision = (id: string, revisionId: string) => this.request<Note>(`/api/v1/notes/${id}/revisions/${revisionId}/restore`, { method: "POST", body: "{}" });
  /** Let the AI sort the doc into topics. */
  organizeNote = (id: string, body: Record<string, unknown> = {}) => this.request<{ preview: boolean; sections: Array<{ title: string; clipIds: string[] }>; remaining: number }>(`/api/v1/notes/${id}/organize`, { method: "POST", body: JSON.stringify(body) });
  /** Turn the pieces into writing, with sentences that follow each other. */
  writeUpNote = (id: string, body: Record<string, unknown> = {}) => this.request<{ preview: boolean; title: string; sections: NoteWriteUpSection[]; remaining: number }>(`/api/v1/notes/${id}/write-up`, { method: "POST", body: JSON.stringify(body) });
  /** Sort the pieces of a doc again, using the mode the doc is set to. */
  rearrangeNote = (id: string) => this.request<Note>(`/api/v1/notes/${id}/rearrange`, { method: "POST", body: "{}" });
  /** The doc the keyboard shortcut adds to. */
  currentNote = () => this.request<{ noteId: string | null; title?: string | null; clipCount?: number }>("/api/v1/notes/current");
  setCurrentNote = (noteId: string | null) => this.request<{ noteId: string | null }>("/api/v1/notes/current", { method: "PUT", body: JSON.stringify({ noteId }) });
  /** The shortcut endpoint. It finds the current doc, or makes one. */
  addCurrentNoteClip = (body: Record<string, unknown>) => this.request<NoteClipResult>("/api/v1/notes/current/clips", { method: "POST", body: JSON.stringify(body) });
}
