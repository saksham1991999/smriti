import { Component, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, EmptyState, Spinner, Text } from "@smriti/ui-web";
import { useT } from "../lib/i18n";

/** Shown while a lazy screen or its data loads. */
export function RouteLoading() {
  const t = useT();
  return (
    <div className="grid min-h-[50dvh] place-items-center" data-testid="route-loading">
      <Spinner label={t("learn:WEB-01.loading")} />
    </div>
  );
}

export function NotFound() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4" data-testid="not-found">
      <Text variant="title" heading as="h1" align="center">
        {t("learn:WEB-01.not_found_title")}
      </Text>
      <EmptyState illustration="ui-search-empty" text={t("learn:WEB-01.not_found_body")} action={{ label: t("learn:WEB-01.not_found_action"), onPress: () => void navigate({ to: "/" }) }} />
    </main>
  );
}

/** A friendly error with a reload; the details go to the logger as a code only, never to the screen. */
export function ErrorView({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <main id="main" role="alert" className="mx-auto flex min-h-[60dvh] max-w-[480px] flex-col justify-center gap-4 px-4" data-testid="error-view">
      <Text variant="title" heading as="h1" align="center">
        {t("learn:WEB-01.error_title")}
      </Text>
      <EmptyState illustration="scene-maintenance" text={t("learn:WEB-01.error_body")} action={{ label: t("learn:WEB-01.error_action"), onPress: onRetry ?? (() => location.reload()) }} />
    </main>
  );
}

export function RouteError() {
  return <ErrorView />;
}

/** "That didn't load" with Try again, for a query that failed. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 py-8" role="alert" data-testid="load-error">
      <Text tone="muted" align="center">
        {t("learn:WEB-01.load_error")}
      </Text>
      <Button label={t("learn:WEB-01.retry")} variant="secondary" size="sm" onPress={onRetry} />
    </div>
  );
}

interface BoundaryState {
  failed: boolean;
}

/** Catches render errors anywhere below the root layout. */
export class ErrorBoundary extends Component<{ children: ReactNode; onError?: (code: string) => void }, BoundaryState> {
  override state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error.name || "render_error");
  }
  override render() {
    return this.state.failed ? <ErrorView /> : this.props.children;
  }
}
