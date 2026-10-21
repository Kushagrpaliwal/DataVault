import { Button, EmptyState, LoadingState } from "@data-vault/ui";

export function QueryState({ loading, error, empty, onRetry }: { loading: boolean; error?: Error | null; empty?: boolean; onRetry?: () => void }) {
  if (loading) return <LoadingState label="Loading your workspace…" />;
  if (error) return <EmptyState title="Couldn’t load this data" description={error.message} action={onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : undefined} />;
  if (empty) return <EmptyState title="Nothing here yet" description="Create your first item or change the active filters." />;
  return null;
}
