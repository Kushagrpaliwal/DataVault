import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  forgotPasswordSchema, loginSchema, organizationCreateSchema, registerSchema, resetPasswordSchema, setPasswordSchema,
} from "@data-vault/schemas";
import { browserWorkspaceDefaults } from "@data-vault/config";
import { Button, Input, Label } from "@data-vault/ui";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import type { z } from "zod";
import type { AuthSession } from "@data-vault/types";
import { useAuth } from "../../lib/auth";
import { ErrorMessage } from "../../components/feedback";

function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="grid min-h-screen bg-canvas lg:grid-cols-[1fr_1.05fr]"><section className="flex items-center justify-center p-6 md:p-12"><div className="w-full max-w-md"><NavLink to="/" className="mb-12 flex items-center gap-2 text-lg font-semibold"><span className="grid size-9 place-items-center rounded-xl bg-black text-white">D</span>DataVault</NavLink><h1 className="display text-4xl">{title}</h1><p className="mt-3 text-muted">{description}</p><div className="mt-8">{children}</div></div></section><aside className="relative hidden overflow-hidden bg-deep p-12 text-white lg:block"><div className="relative z-10 flex h-full flex-col justify-between"><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#a4d4c5]">Save anything from the web</p><div className="grid items-center gap-6 xl:grid-cols-[1fr_.75fr]"><div><p className="display max-w-xl text-5xl">The detail you saved yesterday is the answer you need today.</p><p className="mt-6 max-w-lg text-lg text-white/75">Save text from any webpage, keep the link it came from, and find it again in seconds.</p></div><img src="/data-vault-clay.png" alt="Illustration of a vault holding saved items" className="mx-auto w-full max-w-sm drop-shadow-2xl"/></div><div className="grid grid-cols-3 gap-3"><div className="h-20 rounded-3xl bg-[#ff4d8b]"/><div className="mt-5 h-20 rounded-3xl bg-[#b8a4ed]"/><div className="h-20 rounded-3xl bg-[#e8b94a]"/></div></div></aside></main>;
}

function authDestination(location: ReturnType<typeof useLocation>, fallback: string) {
  const from = (location.state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : fallback;
}

export function LoginPage() {
  const { session, api, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /**
   * An account with two-factor authentication on gets a code instead of a
   * session, so the sign-in is finished in two steps.
   */
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  /**
   * A signed-in visitor keeps the page they were trying to reach. The
   * extension sends people here from its own sign-in, and losing that page
   * would leave the extension waiting for a connection that never happens.
   */
  if (session) return <Navigate to={authDestination(location, "/")} replace />;

  const finish = (result: AuthSession) => {
    setSession(result);
    navigate(authDestination(location, "/"));
  };

  if (needsCode) {
    return (
      <AuthFrame title="One more step" description="Enter the code from your authenticator app.">
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            finish(await api.verifyTwoFactor({ code: code.trim() }));
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "That code was not accepted.");
          }
        }}>
          {error ? <ErrorMessage message={error} /> : null}
          <div>
            <Label htmlFor="code">Authenticator code</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
            <p className="mt-1 text-xs text-muted">The six-digit code from your authenticator app.</p>
          </div>
          <Button className="w-full" type="submit">Sign in</Button>
          <button type="button" className="w-full text-center text-sm underline" onClick={() => { setNeedsCode(false); setCode(""); setError(""); }}>Use a different account</button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Welcome back" description="Sign in to see everything you have saved.">
      <form className="space-y-4" onSubmit={form.handleSubmit(async (input) => {
        setError("");
        try {
          const result = await api.login(input);
          if ("twoFactorRequired" in result && result.twoFactorRequired) {
            setNeedsCode(true);
            return;
          }
          finish(result as AuthSession);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Could not sign in.");
        }
      })}>
        {error ? <ErrorMessage message={error} /> : null}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" autoComplete="email" type="email" {...form.register("email")} />
          {form.formState.errors.email ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">{form.formState.errors.email.message}</p> : null}
        </div>
        <div>
          <div className="flex justify-between">
            <Label htmlFor="password">Password</Label>
            <NavLink to="/forgot-password" className="text-sm underline">Forgot password?</NavLink>
          </div>
          <div className="relative">
            <Input id="password" autoComplete="current-password" type={showPassword ? "text" : "password"} className="pr-11" {...form.register("password")} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
        </div>
        <Button className="w-full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Signing in…" : "Sign in"}</Button>
        <p className="text-center text-sm text-muted">New to DataVault? <NavLink to="/register" state={location.state} className="font-semibold text-ink underline">Create an account</NavLink></p>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { session, api, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema), defaultValues: { name: "", email: "", password: "" } });

  if (session) return <Navigate to={authDestination(location, "/")} replace />;
  return (
    <AuthFrame title="Create your account" description="One account for your saved items and the browser extension.">
      <form className="space-y-4" onSubmit={form.handleSubmit(async (input) => {
        setError("");
        try {
          const result = await api.register(input);
          setSession(result);
          navigate(authDestination(location, "/"));
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Could not create your account.");
        }
      })}>
        {error ? <ErrorMessage message={error} /> : null}
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" {...form.register("name")} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" autoComplete="email" type="email" {...form.register("email")} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input id="password" autoComplete="new-password" type={showPassword ? "text" : "password"} className="pr-11" {...form.register("password")} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
          <p className="mt-1 text-xs text-muted">10 or more characters, with upper-case, lower-case, and a number.</p>
        </div>
        <Button className="w-full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Creating…" : "Create account"}</Button>
        <p className="text-center text-sm text-muted">Already registered? <NavLink to="/login" state={location.state} className="font-semibold text-ink underline">Sign in</NavLink></p>
        <p className="rounded-xl bg-soft p-3 text-xs leading-5 text-muted">
          We will email you a confirmation link. You can use DataVault straight away, but you need to confirm your address before AI credits unlock.
        </p>
      </form>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { api } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  return (
    <AuthFrame title="Reset your password" description="We will send reset instructions if the address belongs to an account.">
      {sent ? (
        <div className="rounded-2xl bg-[#a4d4c5] p-5">
          <p className="font-semibold">Check your email</p>
          <p className="mt-1 text-sm">The link expires shortly for your security.</p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit(async ({ email }) => {
          setError("");
          try {
            await api.forgotPassword(email);
            setSent(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not send the reset link.");
          }
        })}>
          {error ? <ErrorMessage message={error} /> : null}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register("email")} />
          </div>
          <Button className="w-full">Send reset link</Button>
        </form>
      )}
      <NavLink to="/login" className="mt-6 block text-center text-sm underline">Back to sign in</NavLink>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { token: params.get("token") ?? "", password: "" } });
  return (
    <AuthFrame title="Choose a new password" description="Use a unique password you do not reuse elsewhere.">
      <form className="space-y-4" onSubmit={form.handleSubmit(async ({ token, password }) => {
        setError("");
        try {
          await api.resetPassword(token, password);
          navigate("/login");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Reset failed.");
        }
      })}>
        {error ? <ErrorMessage message={error} /> : null}
        <input type="hidden" {...form.register("token")} />
        <div>
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input id="password" autoComplete="new-password" type={showPassword ? "text" : "password"} className="pr-11" {...form.register("password")} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
        </div>
        <Button className="w-full">Update password</Button>
      </form>
    </AuthFrame>
  );
}

/**
 * Set a password for an account that was created through a provider we no
 * longer support, so nobody is locked out by the change.
 */
export function SetPasswordPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof setPasswordSchema>>({ resolver: zodResolver(setPasswordSchema), defaultValues: { token: params.get("token") ?? "", password: "" } });
  const token = params.get("token") ?? "";

  return (
    <AuthFrame title="Set your password" description="Choose a password so you can sign in to DataVault.">
      {done ? (
        <>
          <div className="rounded-2xl bg-[#a4d4c5] p-5">
            <p className="font-semibold">Your password is set</p>
            <p className="mt-1 text-sm">You can now sign in with your email address and this password.</p>
          </div>
          <Button className="mt-5 w-full" onClick={() => navigate("/login")}>Go to sign in</Button>
        </>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit(async ({ token: value, password }) => {
          setError("");
          try {
            await api.setPassword(value, password);
            setDone(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not set your password.");
          }
        })}>
          {error ? <ErrorMessage message={error} /> : null}
          {!token ? (
            <div className="rounded-2xl bg-soft p-5 text-sm leading-6 text-strong">
              This link is missing its code. Request a new one from the sign-in page.
            </div>
          ) : null}
          <input type="hidden" {...form.register("token")} />
          <div>
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input id="password" autoComplete="new-password" type={showPassword ? "text" : "password"} className="pr-11" {...form.register("password")} />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </div>
            <p className="mt-1 text-xs text-muted">10 or more characters, with upper-case, lower-case, and a number.</p>
          </div>
          <Button className="w-full" disabled={form.formState.isSubmitting || !token}>{form.formState.isSubmitting ? "Setting…" : "Set password"}</Button>
        </form>
      )}
    </AuthFrame>
  );
}

/**
 * Where the confirmation link lands.
 *
 * The API verifies the token and then sends the browser here, so this page
 * only has to say what happened and where to go next.
 */
export function VerifiedPage() {
  const { session, refresh } = useAuth();

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const confirmed = session?.user.emailVerified ?? false;

  return (
    <AuthFrame title={confirmed ? "Email confirmed" : "Almost there"} description={confirmed ? "Your free AI credits are now unlocked." : "We could not confirm that address just now."}>
      {confirmed ? (
        <>
          <div className="rounded-2xl bg-[#a4d4c5] p-5">
            <p className="font-semibold">Your AI credits are ready</p>
            <p className="mt-1 text-sm">You can now use the AI actions on any saved item.</p>
          </div>
          <NavLink to="/" className="mt-5 block w-full"><Button className="w-full">Go to DataVault</Button></NavLink>
        </>
      ) : (
        <>
          <p className="text-sm leading-6 text-strong">
            If the link has expired, request a new one from Settings. You can keep using DataVault either way, and your credits unlock as soon as the address is confirmed.
          </p>
          <NavLink to="/settings" className="mt-5 block w-full"><Button className="w-full" variant="secondary">Open settings</Button></NavLink>
        </>
      )}
    </AuthFrame>
  );
}

export function OnboardingPage() {
  const { session, api, refresh, loading, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  /**
   * A new workspace takes its locale, its time zone and its currency from
   * the browser, so it feels like it belongs to the person who made it.
   */
  const defaults = browserWorkspaceDefaults();
  const form = useForm<z.input<typeof organizationCreateSchema>, unknown, z.output<typeof organizationCreateSchema>>({ resolver: zodResolver(organizationCreateSchema), defaultValues: { name: "", slug: "", ...defaults } });
  /**
   * The page the user was heading for is kept through the whole journey, so
   * an extension waiting to be connected still finds its way back.
   */
  const destination = (location.state as { from?: string } | null)?.from ?? "/";
  /**
   * The page is also used to add another workspace to an account that
   * already has one. Every account is given a personal workspace, so the
   * first one is always there and this is the only way to make a second.
   */
  const addingAnother = searchParams.get("new") === "1";
  if (loading) {
    return (
      <AuthFrame title="Create your workspace" description="A workspace keeps your saved items separate from anyone else you share with.">
        <p className="rounded-2xl bg-soft p-5 text-sm text-muted">Checking your sign-in…</p>
      </AuthFrame>
    );
  }
  if (!session) return <Navigate to="/login" state={{ from: destination }} replace />;
  if (session.organizations.length && !addingAnother) return <Navigate to={destination} replace />;
  return (
    <AuthFrame
      title={addingAnother ? "Add another workspace" : "Create your workspace"}
      description="A workspace keeps your saved items separate from anyone else you share with."
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(async (input) => {
        setError("");
        try {
          const created = await api.createOrganization(input);
          await refresh();
          selectOrganization(created.id);
          navigate(destination);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Workspace could not be created.");
        }
      })}>
        {error ? <ErrorMessage message={error} /> : null}
        <div>
          <Label htmlFor="name">Workspace name</Label>
          <Input id="name" {...form.register("name", { onChange: (event) => form.setValue("slug", String(event.target.value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) })} />
        </div>
        <div>
          <Label htmlFor="slug">Workspace URL key</Label>
          <Input id="slug" {...form.register("slug")} />
        </div>
        <Button className="w-full">Create workspace</Button>
      </form>
    </AuthFrame>
  );
}

export function ExtensionAuthorizePage() {
  const { session, organization, api, loading } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const started = useRef(false);
  const redirectUri = params.get("redirectUri");
  const codeChallenge = params.get("codeChallenge");
  const state = params.get("state");
  useEffect(() => {
    if (!session || !organization || started.current) return;
    started.current = true;
    void api.extensionApprove({ organizationId: organization.id, redirectUri, codeChallenge, state })
      .then((result) => window.location.assign(result.redirectUrl))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Extension authorization failed."));
  }, [api, codeChallenge, organization, redirectUri, session, state]);
  /**
   * The session is read in the background, so it is empty for a moment even
   * for a signed-in user. Redirecting during that moment would send a
   * signed-in user to the sign-in page, which is what made the extension ask
   * for a sign-in again and again.
   */
  if (loading) {
    return (
      <AuthFrame title="Connecting the extension" description="This browser is connecting to your workspace. You can close this tab once it is done.">
        <p className="rounded-2xl bg-soft p-5 text-sm text-muted">Checking your sign-in…</p>
      </AuthFrame>
    );
  }
  if (!session) return <Navigate to="/login" state={{ from: `/extension/authorize?${params.toString()}` }} replace />;
  if (!session.organizations.length) return <Navigate to="/onboarding" state={{ from: `/extension/authorize?${params.toString()}` }} replace />;
  return (
    <AuthFrame title="Connecting the extension" description="This browser is connecting to your workspace. You can close this tab once it is done.">
      <div className="rounded-2xl bg-soft p-5">
        <p className="text-sm text-muted">Workspace</p>
        <p className="mt-1 font-semibold">{organization?.name}</p>
        <p className="mt-5 flex items-center gap-2 text-sm text-strong"><MailCheck className="size-4" />Finishing secure connection…</p>
      </div>
      {error ? <div className="mt-4"><ErrorMessage message={error} /></div> : null}
      <Button className="mt-5 w-full" variant="secondary" onClick={() => window.close()}>Cancel</Button>
    </AuthFrame>
  );
}
