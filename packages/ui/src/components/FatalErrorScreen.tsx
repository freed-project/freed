import type { RuntimeErrorSnapshot } from "@freed/shared";
import { ReportComposer } from "./report/ReportComposer.js";

interface FatalErrorScreenProps {
  error: RuntimeErrorSnapshot | { message: string; fingerprint?: string } | null;
  onRetry: () => void;
  productName: string;
}

export function FatalErrorScreen({
  error,
  onRetry,
  productName,
}: FatalErrorScreenProps) {
  return (
    <div className="app-theme-shell h-screen min-h-screen overflow-y-auto px-4 py-8 text-[var(--theme-text-primary)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <section className="theme-dialog-shell p-6">
          <p className="theme-feedback-text-danger text-xs font-semibold uppercase tracking-[0.2em]">
            Recover
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-[var(--theme-text-primary)]">
            {productName} hit a fatal error
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--theme-text-muted)]">
            You can try reloading now. If it happens again, export a report so we can diagnose it from the field.
          </p>
          <div className="theme-feedback-panel-danger mt-5 rounded-2xl p-4">
            <p className="text-sm text-[var(--theme-text-primary)]">{error?.message ?? "Unknown fatal error"}</p>
            {"fingerprint" in (error ?? {}) && error?.fingerprint ? (
              <p className="mt-2 text-xs text-[var(--theme-text-muted)]">Crash fingerprint: {error.fingerprint}</p>
            ) : null}
          </div>
          <button
            onClick={onRetry}
            className="theme-accent-button mt-5 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </section>

        <section className="theme-dialog-shell p-6">
          <ReportComposer initialIssueType="crash" title="Export a crash report" />
        </section>
      </div>
    </div>
  );
}
