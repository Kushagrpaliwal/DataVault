export interface ApiErrorPayload {
  code: string
  message: string
  details?: unknown
  requestId?: string
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorPayload }

export interface PaginationResult<T> {
  items: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  currency: string
  locale: string
  timeZone: string
  role: string
  permissions: string[]
  isPersonal: boolean
}

export interface AuthSession {
  user: User
  organizations: Organization[]
  csrfToken?: string
}

export interface Vault {
  id: string
  organizationId: string
  name: string
  slug: string
  description: string | null
  kind: 'personal' | 'workspace'
  color: string
  isDefault: boolean
  createdAt: string
}

export interface SavedRecord {
  id: string
  organizationId: string
  recordType: string
  title: string
  description: string | null
  originalText: string | null
  sourceType: string
  sourceUrl: string | null
  sourceDomain: string | null
  sourcePageTitle: string | null
  capturedAt: string | null
  createdVia: string
  amount: string | null
  currency: string | null
  party: string | null
  category: string | null
  status: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  vaultId: string
  captureKind: string
  reviewStatus: string
  privacyLevel: string
  deletedAt: string | null
}

export interface RecordDetail extends SavedRecord {
  metadata: Record<string, unknown>
  capture: Record<string, unknown> | null
  payment: Record<string, unknown> | null
  attachments: Array<{
    id: string
    fileName: string
    mimeType: string
    byteSize: string
    createdAt: string
  }>
  audit: Array<Record<string, unknown>>
  collections: Array<{ id: string; name: string; color: string }>
  tags: Array<{ id: string; name: string; color: string }>
  evidence: Array<{
    id: string
    sourceUrl: string | null
    sourceTitle: string | null
    sourceDomain: string | null
    contentHash: string
    capturedAt: string
  }>
}

export interface DashboardSummary {
  totalReceived: string
  totalPaid: string
  netCashFlow: string
  pendingPayments: string
  outstandingInvoices: string
  refunds: string
  savedRecords: number
  extensionCaptures: number
}

export interface DashboardData {
  summary: DashboardSummary
  cashFlow?: Array<Record<string, unknown>>
  statuses?: Array<Record<string, unknown>>
  methods?: Array<Record<string, unknown>>
  recentRecords?: SavedRecord[]
  recentCaptures: SavedRecord[]
}

export interface CaptureInput {
  selectedText: string
  originalText?: string
  source: { url: string; title: string; domain: string }
  recordType?: string
  captureKind?: string
  vaultId?: string
  tagNames?: string[]
}

export interface SavedRecordInput {
  recordType: string
  title: string
  description?: string
  originalText?: string
  sourceType?: string
  source?: { url: string; title: string; domain: string }
  capturedAt?: string
  metadata?: Record<string, unknown>
  vaultId?: string
  captureKind?: string
  reviewStatus?: string
  privacyLevel?: string
}

export interface PaymentInput {
  direction: 'incoming' | 'outgoing'
  amount: string
  currency: string
  paymentDate: string
  status?: string
  description?: string
  notes?: string
  transactionReference?: string | null
  utr?: string | null
  customerId?: string | null
  vendorId?: string | null
  paymentMethodId?: string | null
  categoryId?: string | null
  invoiceId?: string | null
  taxAmount?: string
  feeAmount?: string
  discountAmount?: string
}

export interface ReferenceData {
  categories: Array<Record<string, unknown>>
  paymentMethods: Array<Record<string, unknown>>
}
