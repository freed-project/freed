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
    <div className="h-screen min-h-screen overflow-y-auto bg-freed-black px-4 py-8 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-300">
            Recover
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white">
            {productName} hit a fatal error
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[#d4d4d8]">
            You can try reloading now. If it happens again, export a report so we can diagnose it from the field.
          </p>
          <div className="mt-5 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-black/20 p-4">
            <p className="text-sm text-white">{error?.message ?? "Unknown fatal error"}</p>
            {"fingerprint" in (error ?? {}) && error?.fingerprint ? (
              <p className="mt-2 text-xs text-[#a1a1aa]">Crash fingerprint: {error.fingerprint}</p>
            ) : null}
          </div>
          <button
            onClick={onRetry}
            className="mt-5 rounded-xl bg-[#8b5cf6] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#7c3aed]"
          >
            Retry
          </button>
        </div>

        <div className="rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[#141414] p-6">
          <ReportComposer initialIssueType="crash" title="Export a crash report" />
        </div>
      </div>
    </div>
  );
}
