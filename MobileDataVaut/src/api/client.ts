import type {
  ApiResponse,
  AuthSession,
  CaptureInput,
  DashboardData,
  Organization,
  PaginationResult,
  PaymentInput,
  RecordDetail,
  ReferenceData,
  SavedRecord,
  SavedRecordInput,
  Vault,
} from './types.js'

export class DataVaultApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DataVaultApiError'
  }
}

type QueryValue = string | number | boolean | null | undefined

export interface DataVaultApiOptions {
  baseUrl?: string
  organizationId?: () => string | null
  csrfToken?: () => string | null | undefined
  onUnauthorized?: () => void
  fetcher?: typeof fetch
}

function getConfiguredApiUrl() {
  const environment = import.meta.env as ImportMetaEnv & {
    VITE_API_URL?: string
  }
  return (environment.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

function toQueryString(query?: Record<string, QueryValue>) {
  if (!query) return ''
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function makeIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export class DataVaultApiClient {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: DataVaultApiOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    query?: Record<string, QueryValue>,
  ): Promise<T> {
    const headers = new Headers(init.headers)
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    if (!isFormData) headers.set('Content-Type', 'application/json')

    const organizationId = this.options.organizationId?.()
    if (organizationId) headers.set('X-Organization-Id', organizationId)

    const csrfToken = this.options.csrfToken?.()
    if (csrfToken && init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method)) {
      headers.set('X-CSRF-Token', csrfToken)
    }

    const response = await this.fetcher(
      `${this.options.baseUrl ?? getConfiguredApiUrl()}${path}${toQueryString(query)}`,
      {
        ...init,
        headers,
        credentials: 'include',
      },
    )

    if (response.status === 401) this.options.onUnauthorized?.()

    const raw = await response.text()
    let payload: ApiResponse<T> | null = null
    try {
      payload = raw ? (JSON.parse(raw) as ApiResponse<T>) : null
    } catch {
      throw new DataVaultApiError('INVALID_API_RESPONSE', 'The server returned an invalid response.', response.status)
    }

    if (!payload) {
      if (!response.ok) throw new DataVaultApiError('REQUEST_FAILED', 'The request could not be completed.', response.status)
      return undefined as T
    }
    if (!payload.success) throw new DataVaultApiError(payload.error.code, payload.error.message, response.status, payload.error.details)
    return payload.data
  }

  getMe = () => this.request<AuthSession>('/api/v1/me')

  login = (email: string, password: string) =>
    this.request<AuthSession>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })

  register = (name: string, email: string, password: string) =>
    this.request<AuthSession>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    })

  logout = () =>
    this.request<void>('/api/v1/auth/logout', {
      method: 'POST',
      body: '{}',
    })

  forgotPassword = (email: string) =>
    this.request<void>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })

  createOrganization = (body: { name: string; slug: string; currency: string; locale: string; timeZone: string }) =>
    this.request<Organization>('/api/v1/organizations', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  dashboard = () => this.request<DashboardData>('/api/v1/dashboard')

  listSavedRecords = (query?: Record<string, QueryValue>) =>
    this.request<PaginationResult<SavedRecord>>('/api/v1/saved-records', {}, query)

  getSavedRecord = (id: string) => this.request<RecordDetail>(`/api/v1/saved-records/${id}`)

  createSavedRecord = (body: SavedRecordInput) =>
    this.request<SavedRecord>('/api/v1/saved-records', {
      method: 'POST',
      headers: { 'Idempotency-Key': makeIdempotencyKey() },
      body: JSON.stringify(body),
    })

  updateSavedRecord = (id: string, body: Partial<SavedRecordInput>) =>
    this.request<SavedRecord>(`/api/v1/saved-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })

  archiveSavedRecord = (id: string) =>
    this.request<void>(`/api/v1/saved-records/${id}/archive`, { method: 'POST', body: '{}' })

  restoreSavedRecord = (id: string) =>
    this.request<void>(`/api/v1/saved-records/${id}/restore`, { method: 'POST', body: '{}' })

  deleteSavedRecord = (id: string) =>
    this.request<void>(`/api/v1/saved-records/${id}`, { method: 'DELETE' })

  restoreTrashedRecord = (id: string) =>
    this.request<SavedRecord>(`/api/v1/saved-records/${id}/trash/restore`, { method: 'POST', body: '{}' })

  listVaults = () => this.request<Vault[]>('/api/v1/vaults')

  search = (query: string) =>
    this.request<PaginationResult<Record<string, unknown>>>('/api/v1/search', {}, { q: query, limit: 20 })

  createCapture = (body: CaptureInput) =>
    this.request<Record<string, unknown>>('/api/v1/captures', {
      method: 'POST',
      headers: { 'Idempotency-Key': makeIdempotencyKey() },
      body: JSON.stringify(body),
    })

  listPayments = (query?: Record<string, QueryValue>) =>
    this.request<PaginationResult<Record<string, unknown>>>('/api/v1/payments', {}, query)

  createPayment = (body: PaymentInput) =>
    this.request<Record<string, unknown>>('/api/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': makeIdempotencyKey() },
      body: JSON.stringify({
        taxAmount: '0.00',
        feeAmount: '0.00',
        discountAmount: '0.00',
        status: 'completed',
        ...body,
      }),
    })

  listInvoices = (query?: Record<string, QueryValue>) =>
    this.request<PaginationResult<Record<string, unknown>>>('/api/v1/invoices', {}, query)

  referenceData = () => this.request<ReferenceData>('/api/v1/settings/reference-data')
}
