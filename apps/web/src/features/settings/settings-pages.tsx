import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Mail, Monitor, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Button, Input, Label, cn } from "@data-vault/ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { PageHeader } from "../../components/page";
import { Modal, useToast } from "../../components/feedback";
import { QueryState } from "../../components/data-state";

export function SettingsPage() {
  const { session, organization, api, setSession, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  const sessions = useQuery({ queryKey: ["extension-sessions"], queryFn: () => api.listExtensionSessions() });
  const credits = useQuery({ queryKey: ["ai-credits"], queryFn: () => api.aiCredits() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeExtensionSession(id), onSuccess: async () => { notify("Browser revoked"); await sessions.refetch(); } });
  const resendVerification = useMutation({
    mutationFn: () => api.resendVerificationEmail(session?.user.email ?? ""),
    onSuccess: () => notify("Confirmation email sent"),
    onError: (error) => notify(error instanceof Error ? error.message : "Could not send the email", "error"),
  });
  const verified = session?.user.emailVerified ?? false;

  return <>
    <PageHeader eyebrow="Workspace" title="Settings" description="Your account, your sign-in, and the browsers connected to this workspace." />
    <div className="grid gap-6 xl:grid-cols-[.75fr_1.25fr]">
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
              <p className="mt-1 text-sm text-[#6a6a6a]">
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
                    item.id === organization?.id ? "border-[#1a3a3a] bg-[#f5f0e0]" : "hover:bg-[#faf5e8]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-[#6a6a6a]">
                      {item.isPersonal ? "Personal" : "Workspace"} · {item.role.replaceAll("_", " ")}
                    </span>
                  </span>
                  {item.id === organization?.id ? <span className="shrink-0 text-xs font-semibold text-[#1a3a3a]">Current</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#f5f0e0]"><Mail className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Email address</h2>
              <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">Confirming your address unlocks your free AI credits. Everything else works without it.</p>
              <div className="mt-4">
                {verified ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-green-800"><ShieldCheck className="size-4" />Confirmed</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-amber-800">Not confirmed yet</p>
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
            <span className="grid size-10 place-items-center rounded-xl bg-[#f5f0e0]"><KeyRound className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Sign-in security</h2>
              <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">Your password is hashed with Argon2id, and passwords known to have appeared in data breaches are rejected.</p>
              <div className="mt-4">
                <Button size="sm" variant="secondary" onClick={() => navigate("/forgot-password")}>Change password</Button>
              </div>
            </div>
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#f5f0e0]"><Sparkles className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Free AI credits</h2>
              <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">
                {credits.data
                  ? `${credits.data.remaining} of ${credits.data.allowance} left today. Your allowance refreshes when the day rolls over.`
                  : "Checking your allowance…"}
              </p>
              {credits.data?.reason ? <p className="mt-2 text-sm font-medium text-amber-800">{credits.data.reason}</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-[#b8a4ed] p-6">
          <ShieldCheck className="size-7" />
          <h2 className="mt-5 text-lg font-semibold">Only you can see this</h2>
          <p className="mt-2 text-sm leading-6 text-black/75">Everything you save stays inside this workspace. Nobody else can read your saved items unless you share them.</p>
        </section>
        <Button variant="secondary" onClick={async () => { await api.logout(); setSession(null); navigate("/login"); }}><LogOut className="size-4" />Sign out</Button>
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#1a3a3a] text-white"><Monitor className="size-5" /></span>
            <div>
              <h2 className="text-lg font-semibold">Connected browsers</h2>
              <p className="mt-1 text-sm text-[#6a6a6a]">Revoke a browser to sign it out immediately.</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-[#eee8da]">
          {sessions.data?.length
            ? sessions.data.map((item) => (
              <div key={item.id} className="flex items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.userAgent ?? "Unknown browser"}</p>
                  <p className="mt-1 text-xs text-[#6a6a6a]">Connected {new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
                <Badge tone="teal">Active</Badge>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(item.id)} disabled={revoke.isPending}>Revoke</Button>
              </div>
            ))
            : <div className="p-8 text-center text-sm text-[#6a6a6a]">No browsers are connected to this workspace yet.</div>}
        </div>
      </section>
    </div>
  </>;
}

export function CategoriesPage() { const { api } = useAuth(); const client = useQueryClient(); const { notify } = useToast(); const [kind, setKind] = useState<"category" | "payment-method">("category"); const [open, setOpen] = useState(false); const query = useQuery({ queryKey: ["reference-data"], queryFn: () => api.referenceData() }); const items = kind === "category" ? query.data?.categories : query.data?.paymentMethods; return <><PageHeader eyebrow="Configuration" title="Categories & payment methods" description="Workspace-specific labels used by the web app and browser extension." actions={<Button onClick={() => setOpen(true)}><Plus className="size-4"/>Add item</Button>}/><div className="mb-5 flex gap-2"><Button variant={kind === "category" ? "primary" : "secondary"} onClick={() => setKind("category")}>Categories</Button><Button variant={kind === "payment-method" ? "primary" : "secondary"} onClick={() => setKind("payment-method")}>Payment methods</Button></div><section className="panel"><QueryState loading={query.isLoading} error={query.error}/><div className="grid gap-px overflow-hidden rounded-2xl bg-[#eee8da] sm:grid-cols-2 lg:grid-cols-3">{items?.map((item) => <div key={String(item.id)} className="flex items-center gap-3 bg-[#fffdf8] p-5"><i className="size-4 rounded-full" style={{ background: String(item.color ?? "#1a3a3a") }}/><div><p className="font-semibold">{String(item.name)}</p>{item.kind ? <p className="text-xs text-[#6a6a6a]">{String(item.kind)}</p> : null}</div></div>)}</div></section><ReferenceModal open={open} kind={kind} onClose={() => setOpen(false)} onSaved={async () => { notify("Reference item created"); await client.invalidateQueries({ queryKey: ["reference-data"] }); setOpen(false); }}/></>; }

function ReferenceModal({ open, kind, onClose, onSaved }: { open: boolean; kind: "category" | "payment-method"; onClose: () => void; onSaved: () => void }) { const { api } = useAuth(); const [name, setName] = useState(""); const [color, setColor] = useState("#b8a4ed"); const mutation = useMutation({ mutationFn: () => kind === "category" ? api.createCategory({ name, color }) : api.createPaymentMethod({ name, kind: name.toLowerCase().replaceAll(" ", "_") }), onSuccess: onSaved }); return <Modal open={open} onClose={onClose} title={`Add ${kind.replace("-", " ")}`}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><div><Label>Name</Label><Input required value={name} onChange={(event) => setName(event.target.value)}/></div>{kind === "category" ? <div><Label>Color</Label><Input type="color" value={color} onChange={(event) => setColor(event.target.value)}/></div> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending}>Create</Button></div></form></Modal>; }
function Field({ label, value, capitalize = true }: { label: string; value?: string | undefined; capitalize?: boolean }) { return <div><dt className="text-xs uppercase tracking-[.12em] text-[#6a6a6a]">{label}</dt><dd className={capitalize ? "mt-1 font-medium capitalize" : "mt-1 font-medium"}>{value ?? "—"}</dd></div>; }
