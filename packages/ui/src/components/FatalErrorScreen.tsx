import { useState } from "react";
import type { RuntimeErrorSnapshot } from "@freed/shared";
import { ReportComposer } from "./report/ReportComposer.js";

interface FatalErrorSecondaryConfirmation {
  body: string;
  confirmLabel: string;
  title: string;
}

interface FatalErrorScreenProps {
  error: RuntimeErrorSnapshot | { message: string; fingerprint?: string } | null;
  onRetry: () => void;
  onSecondaryAction?: () => void | Promise<void>;
  productName: string;
  secondaryActionConfirmation?: FatalErrorSecondaryConfirmation;
  secondaryActionLabel?: string;
}

export function FatalErrorScreen({
  error,
  onRetry,
  onSecondaryAction,
  productName,
  secondaryActionConfirmation,
  secondaryActionLabel,
}: FatalErrorScreenProps) {
  const [confirmingSecondaryAction, setConfirmingSecondaryAction] =
    useState(false);
  const [secondaryActionPending, setSecondaryActionPending] = useState(false);

  const runSecondaryAction = () => {
    if (!onSecondaryAction || secondaryActionPending) return;
    setSecondaryActionPending(true);
    void Promise.resolve()
      .then(() => onSecondaryAction())
      .catch(() => undefined)
      .finally(() => {
        setSecondaryActionPending(false);
      });
  };

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
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={onRetry}
              className="theme-accent-button rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
            >
              Retry
            </button>
            {onSecondaryAction && secondaryActionLabel ? (
              <button
                onClick={() => {
                  if (secondaryActionConfirmation) {
                    setConfirmingSecondaryAction(true);
                    return;
                  }
                  runSecondaryAction();
                }}
                className="btn-secondary px-4 py-2.5 text-sm font-medium"
                disabled={secondaryActionPending}
              >
                {secondaryActionPending ? "Working..." : secondaryActionLabel}
              </button>
            ) : null}
          </div>
          {confirmingSecondaryAction && secondaryActionConfirmation ? (
            <div
              className="theme-feedback-panel-danger mt-4 rounded-2xl p-4"
              role="alertdialog"
              aria-labelledby="fatal-recovery-confirmation-title"
              aria-describedby="fatal-recovery-confirmation-body"
            >
              <p
                id="fatal-recovery-confirmation-title"
                className="text-sm font-semibold text-[var(--theme-text-primary)]"
              >
                {secondaryActionConfirmation.title}
              </p>
              <p
                id="fatal-recovery-confirmation-body"
                className="mt-2 text-sm text-[var(--theme-text-muted)]"
              >
                {secondaryActionConfirmation.body}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-primary px-4 py-2.5 text-sm font-medium"
                  disabled={secondaryActionPending}
                  onClick={runSecondaryAction}
                >
                  {secondaryActionPending
                    ? "Working..."
                    : secondaryActionConfirmation.confirmLabel}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-4 py-2.5 text-sm font-medium"
                  disabled={secondaryActionPending}
                  onClick={() => setConfirmingSecondaryAction(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {onSecondaryAction && secondaryActionLabel ? (
            <p className="mt-3 text-xs text-[var(--theme-text-muted)]">
              If recovery keeps failing, install the newest build over this one.
            </p>
          ) : null}
        </section>

        <section className="theme-dialog-shell p-6">
          <ReportComposer initialIssueType="crash" title="Export a crash report" />
        </section>
      </div>
    </div>
  );
}
