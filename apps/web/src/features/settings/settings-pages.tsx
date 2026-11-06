import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, LogOut, Mail, Monitor, Moon, Plus, ShieldCheck, Sun } from "lucide-react";
import { Badge, Button, cn } from "@data-vault/ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { PageHeader } from "../../components/page";
import { useToast } from "../../components/feedback";
import { ThemeOptions } from "../../components/theme-picker";
import { AiConnectionsPanel } from "./ai-connections-panel";
import { useTheme } from "../../lib/theme";

export function SettingsPage() {
  const { session, organization, api, setSession, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  const sessions = useQuery({ queryKey: ["extension-sessions"], queryFn: () => api.listExtensionSessions() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeExtensionSession(id), onSuccess: async () => { notify("Browser revoked"); await sessions.refetch(); } });
  const resendVerification = useMutation({
    mutationFn: () => api.resendVerificationEmail(session?.user.email ?? ""),
    onSuccess: () => notify("Confirmation email sent"),
    onError: (error) => notify(error instanceof Error ? error.message : "Could not send the email", "error"),
  });
  const verified = session?.user.emailVerified ?? false;

  return <>
    <PageHeader eyebrow="Workspace" title="Settings" description="Your account, your sign-in, and the browsers connected to this workspace." />
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {/* Column 1: Account, Workspaces, Security & Appearance */}
      <div className="space-y-6">
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Profile</h2>
          <dl className="mt-5 space-y-4">
            <Field label="Name" value={session?.user.name} />
            <Field label="Email" value={session?.user.email} capitalize={false} />
            <Field label="Workspace" value={organization?.name} />
            <Field label="Role" value={organization?.role.replaceAll("_", " ")} />
          </dl>
        </section>

        <section className="panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Workspaces</h2>
              <p className="mt-1 text-sm text-muted">
                Everything you save stays inside a workspace. A personal one is made for you; add another for a
                project or a team.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigate("/onboarding?new=1")}>
              <Plus className="size-4" />New
            </Button>
          </div>
          <ul className="mt-4 space-y-2">
            {session?.organizations.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => selectOrganization(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm",
                    item.id === organization?.id ? "border-deep bg-soft" : "hover:bg-hover",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {item.isPersonal ? "Personal" : "Workspace"} · {item.role.replaceAll("_", " ")}
                    </span>
                  </span>
                  {item.id === organization?.id ? <span className="shrink-0 text-xs font-semibold text-deep-text">Current</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-soft"><Mail className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Email address</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Confirming your address secures your account. Everything else works without it.</p>
              <div className="mt-4">
                {verified ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-green-800 dark:text-green-200"><ShieldCheck className="size-4" />Confirmed</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Not confirmed yet</p>
                    <Button className="mt-3" size="sm" variant="secondary" disabled={resendVerification.isPending} onClick={() => resendVerification.mutate()}>
                      {resendVerification.isPending ? "Sending…" : "Send the confirmation link"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-soft"><KeyRound className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Sign-in security</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Your password is hashed with Argon2id, and passwords known to have appeared in data breaches are rejected.</p>
              <div className="mt-4">
                <Button size="sm" variant="secondary" onClick={() => navigate("/forgot-password")}>Change password</Button>
              </div>
            </div>
          </div>
        </section>

        <ThemePanel />

        <section className="rounded-3xl bg-[#b8a4ed] p-6">
          <ShieldCheck className="size-7" />
          <h2 className="mt-5 text-lg font-semibold">Only you can see this</h2>
          <p className="mt-2 text-sm leading-6 text-ink/75">Everything you save stays inside this workspace. Nobody else can read your saved items unless you share them.</p>
        </section>

        <div>
          <Button variant="secondary" onClick={async () => { await api.logout(); setSession(null); navigate("/login"); }}>
            <LogOut className="size-4" />Sign out
          </Button>
        </div>
      </div>

      {/* Column 2: Connected Devices, AI & Workspace Data */}
      <div className="space-y-6">
        <section className="panel overflow-hidden">
          <div className="border-b border-line p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-deep text-white"><Monitor className="size-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold">Connected browsers</h2>
                  <p className="mt-1 text-sm text-muted">Revoke a browser to sign it out immediately.</p>
                </div>
              </div>
              {sessions.data?.length ? (
                <Badge tone="teal">{sessions.data.length} active</Badge>
              ) : null}
            </div>
          </div>
          <div className="divide-y divide-line">
            {sessions.data?.length
              ? sessions.data.map((item) => {
                const { browser, os } = parseBrowserSession(item.userAgent);
                return (
                  <div key={item.id} className="flex items-center gap-4 p-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{browser}{os ? ` on ${os}` : ""}</p>
                      <p className="mt-0.5 truncate text-xs text-muted" title={item.userAgent ?? undefined}>
                        Connected {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge tone="teal">Active</Badge>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(item.id)} disabled={revoke.isPending}>Revoke</Button>
                  </div>
                );
              })
              : <div className="p-8 text-center text-sm text-muted">No browsers are connected to this workspace yet.</div>}
          </div>
        </section>

        <AiConnectionsPanel />
      </div>
    </div>
  </>;
}


/**
 * The theme of the interface.
 *
 * The colours are named rather than written out, so the whole interface can
 * be turned over at once. The choice is kept in the browser, and the button
 * in the header changes the same choice.
 */
function ThemePanel() {
  const { theme, resolved } = useTheme();
  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-soft">{theme === "dark" ? <Moon className="size-5" /> : theme === "light" ? <Sun className="size-5" /> : <Monitor className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            The interface can be read in the dark, or follow the setting of the system.
            {theme === "system" ? ` The system is asking for the ${resolved} theme.` : ""}
          </p>
        </div>
      </div>
      <ThemeOptions className="mt-4" />
    </section>
  );
}

function Field({ label, value, capitalize = true }: { label: string; value?: string | undefined; capitalize?: boolean }) { return <div><dt className="text-xs uppercase tracking-[.12em] text-muted">{label}</dt><dd className={capitalize ? "mt-1 font-medium capitalize" : "mt-1 font-medium"}>{value ?? "—"}</dd></div>; }

function parseBrowserSession(ua?: string | null) {
  if (!ua) return { browser: "Web browser", os: "" };

  let browser = "Web browser";
  if (ua.includes("Edg/")) browser = "Microsoft Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("Chrome/")) browser = "Google Chrome";
  else if (ua.includes("Firefox/")) browser = "Mozilla Firefox";
  else if (ua.includes("Safari/")) browser = "Safari";

  let os = "";
  if (ua.includes("Windows NT 10.0") || ua.includes("Windows NT 11.0")) os = "Windows 10/11";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Macintosh") || ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return { browser, os };
}
