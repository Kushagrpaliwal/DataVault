import { createContext, useContext, useEffect, useState, type ReactNode } from '@lynx-js/react'

import { DataVaultApiClient, DataVaultApiError } from '../api/client.js'
import type { AuthSession, Organization } from '../api/types.js'
import { getStoredValue, removeStoredValue, setStoredValue } from '../native/storage.js'

const organizationKey = 'datavault.organization-id'

interface SessionContextValue {
  api: DataVaultApiClient
  session: AuthSession | null
  organization: Organization | null
  loading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  selectOrganization: (id: string) => Promise<void>
  createOrganization: (name: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const api = new DataVaultApiClient({
    organizationId: () => organizationId,
    csrfToken: () => session?.csrfToken,
    onUnauthorized: () => setSession(null),
  })

  const applySession = async (next: AuthSession | null) => {
    setSession(next)
    setError(null)
    if (!next) {
      setOrganizationId(null)
      await removeStoredValue(organizationKey)
      return
    }

    const stored = await getStoredValue(organizationKey)
    const selected = stored && next.organizations.some((item) => item.id === stored)
      ? stored
      : next.organizations[0]?.id ?? null
    setOrganizationId(selected)
    if (selected) await setStoredValue(organizationKey, selected)
  }

  const refresh = async () => {
    try {
      await applySession(await api.getMe())
    } catch (cause) {
      if (cause instanceof DataVaultApiError && cause.status === 401) {
        await applySession(null)
      } else {
        setError(cause instanceof Error ? cause.message : 'DataVault could not be reached.')
      }
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    try {
      await applySession(await api.login(email, password))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sign in failed.'
      setError(message)
      throw cause
    }
  }

  const register = async (name: string, email: string, password: string) => {
    try {
      await applySession(await api.register(name, email, password))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Account creation failed.'
      setError(message)
      throw cause
    }
  }

  const logout = async () => {
    try {
      if (session) await api.logout()
    } finally {
      await applySession(null)
    }
  }

  const selectOrganization = async (id: string) => {
    if (!session?.organizations.some((item) => item.id === id)) return
    setOrganizationId(id)
    await setStoredValue(organizationKey, id)
  }

  const createOrganization = async (name: string) => {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const organization = await api.createOrganization({
      name: name.trim(),
      slug: slug || `workspace-${Date.now()}`,
      currency: 'USD',
      locale: 'en-US',
      timeZone: 'UTC',
    })
    await refresh()
    await selectOrganization(organization.id)
  }

  const organization = session?.organizations.find((item) => item.id === organizationId)
    ?? session?.organizations[0]
    ?? null

  return (
    <SessionContext.Provider
      value={{
        api,
        session,
        organization,
        loading,
        error,
        login,
        register,
        logout,
        refresh,
        selectOrganization,
        createOrganization,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}
