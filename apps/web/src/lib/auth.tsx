import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DataVaultApiClient, DataVaultApiError } from "@data-vault/api-client";
import type { AuthSession, Organization } from "@data-vault/types";

const API_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_URL ?? "http://localhost:3000");
const organizationStorageKey = "data-vault.organization-id";
/** How many times the session is read before the app admits it cannot reach DataVault. */
const SESSION_READ_ATTEMPTS = 3;

interface AuthValue {
  session: AuthSession | null;
  organization: Organization | null;
  api: DataVaultApiClient;
  loading: boolean;
  /** Set when DataVault could not be reached at all. */
  error: string | null;
  setSession: (session: AuthSession | null) => void;
  selectOrganization: (id: string) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState(() => localStorage.getItem(organizationStorageKey));
  const setSession = useCallback((next: AuthSession | null) => {
    setSessionState(next);
    if (next?.organizations.length && !next.organizations.some((organization) => organization.id === organizationId)) {
      const nextId = next.organizations[0]!.id;
      localStorage.setItem(organizationStorageKey, nextId);
      setOrganizationId(nextId);
    }
    if (!next) {
      localStorage.removeItem(organizationStorageKey);
      setOrganizationId(null);
    }
  }, [organizationId]);
  const api = useMemo(() => new DataVaultApiClient({
    baseUrl: API_URL,
    organizationId: () => organizationId,
    csrfToken: () => session?.csrfToken ?? null,
  }), [organizationId, session?.csrfToken]);
  /**
   * Read the session.
   *
   * A rejected sign-in is the only answer that signs the user out. Anything
   * else means the server could not be reached, so the request is tried again
   * a couple of times and, failing that, the app says so instead of throwing
   * the user out of their own account.
   */
  const refresh = useCallback(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < SESSION_READ_ATTEMPTS; attempt += 1) {
      try {
        setSession(await api.getMe());
        setError(null);
        return;
      } catch (caught) {
        lastError = caught;
        if (caught instanceof DataVaultApiError && caught.status === 401) {
          setSession(null);
          setError(null);
          return;
        }
        if (attempt < SESSION_READ_ATTEMPTS - 1) await wait(300 * (attempt + 1));
      }
    }
    setError(lastError instanceof Error ? lastError.message : "DataVault could not be reached.");
  }, [api, setSession]);
  useEffect(() => { void refresh().finally(() => setLoading(false)); }, []);
  const selectOrganization = useCallback((id: string) => { localStorage.setItem(organizationStorageKey, id); setOrganizationId(id); }, []);
  const organization = session?.organizations.find((item) => item.id === organizationId) ?? session?.organizations[0] ?? null;
  return <AuthContext.Provider value={{ session, organization, api, loading, error, setSession, selectOrganization, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
