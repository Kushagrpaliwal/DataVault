import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Button, LoadingState } from "@data-vault/ui";
import { AppShell } from "./components/app-shell";
import { useAuth } from "./lib/auth";
const authPages = () => import("./features/auth/auth-pages");
const LoginPage = lazy(() => authPages().then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => authPages().then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = lazy(() => authPages().then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => authPages().then((module) => ({ default: module.ResetPasswordPage })));
const SetPasswordPage = lazy(() => authPages().then((module) => ({ default: module.SetPasswordPage })));
const VerifiedPage = lazy(() => authPages().then((module) => ({ default: module.VerifiedPage })));
const OnboardingPage = lazy(() => authPages().then((module) => ({ default: module.OnboardingPage })));
const ExtensionAuthorizePage = lazy(() => authPages().then((module) => ({ default: module.ExtensionAuthorizePage })));
const DashboardPage = lazy(() => import("./features/dashboard/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const SavedPage = lazy(() => import("./features/records/saved-page").then((module) => ({ default: module.SavedPage })));
const DocsPage = lazy(() => import("./features/docs/docs-page").then((module) => ({ default: module.DocsPage })));
const OrganizePage = lazy(() => import("./features/records/organize-page").then((module) => ({ default: module.OrganizePage })));
const RecordDetailPage = lazy(() => import("./features/records/record-detail-page").then((module) => ({ default: module.RecordDetailPage })));
const SettingsPage = lazy(() => import("./features/settings/settings-pages").then((module) => ({ default: module.SettingsPage })));

function Protected() {
  const { session, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center"><LoadingState label="Opening DataVault…"/></div>;
  /**
   * DataVault could not be reached. This is not a signed-out state, so the
   * user is offered a retry instead of being sent back to the sign-in page.
   */
  if (error && !session) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf0] p-6">
        <div className="max-w-md rounded-3xl bg-[#f5f0e0] p-8 text-center">
          <h1 className="display text-3xl">Can’t reach DataVault</h1>
          <p className="mt-3 text-sm leading-6 text-[#6a6a6a]">{error}</p>
          <Button className="mt-6" onClick={() => void refresh()}>Retry</Button>
        </div>
      </main>
    );
  }
  if (!session) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace/>;
  if (!session.organizations.length) return <Navigate to="/onboarding" replace/>;
  return <AppShell/>;
}

function LegacySavedDetail() {
  const { id } = useParams();
  return <Navigate to={`/saved/${id ?? ""}`} replace/>;
}

function LegacyNoteDetail() {
  const { id } = useParams();
  return <Navigate to={`/docs/${id ?? ""}`} replace/>;
}

export function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState label="Loading DataVault…"/></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage/>}/>
          <Route path="/register" element={<RegisterPage/>}/>
          <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
          <Route path="/reset-password" element={<ResetPasswordPage/>}/>
          <Route path="/set-password" element={<SetPasswordPage/>}/>
          <Route path="/verified" element={<VerifiedPage/>}/>
          <Route path="/onboarding" element={<OnboardingPage/>}/>
          <Route path="/extension/authorize" element={<ExtensionAuthorizePage/>}/>
          <Route element={<Protected/>}>
            <Route index element={<DashboardPage/>}/>
            <Route path="saved" element={<SavedPage/>}/>
            <Route path="saved/:id" element={<RecordDetailPage/>}/>
            <Route path="docs" element={<DocsPage/>}/>
            <Route path="docs/:id" element={<DocsPage/>}/>
            <Route path="organize" element={<OrganizePage/>}/>
            <Route path="settings" element={<SettingsPage/>}/>
            {/* Legacy aliases. The financial-era paths were removed with their pages. */}
            <Route path="saved-data" element={<Navigate to="/saved" replace/>}/>
            <Route path="saved-data/:id" element={<LegacySavedDetail/>}/>
            <Route path="captures" element={<Navigate to="/saved" replace/>}/>
            <Route path="notes" element={<Navigate to="/docs" replace/>}/>
            <Route path="notes/:id" element={<LegacyNoteDetail/>}/>
            <Route path="vault" element={<Navigate to="/organize" replace/>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info); }
  override render() {
    if (this.state.error) return <main className="grid min-h-screen place-items-center bg-[#fffaf0] p-6"><div className="max-w-md rounded-3xl bg-[#ffb084] p-8 text-center"><h1 className="display text-3xl">Something went wrong</h1><p className="mt-3 text-sm">{this.state.error.message}</p><Button className="mt-6" onClick={() => window.location.reload()}>Reload DataVault</Button></div></main>;
    return this.props.children;
  }
}
