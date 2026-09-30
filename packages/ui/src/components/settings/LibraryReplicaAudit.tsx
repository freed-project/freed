import { useEffect, useRef, useState } from "react";
import type { LibraryCoreNormalizedReplicaAuditV1 } from "@freed/shared/library-core";
import { copyExactJsonToClipboard } from "../../lib/clipboard.js";
import { readBuildMetadata, type BuildMetadata } from "../../lib/build-info.js";

type Evidence = {
  client: "desktop" | "pwa";
  interfaceBuild: BuildMetadata;
  startedAt: string;
  completedAt: string;
  audit: LibraryCoreNormalizedReplicaAuditV1;
};

/** Explicit snapshot evidence shared by both client Settings surfaces. */
export function LibraryReplicaAudit({ audit, client }: {
  audit(signal: AbortSignal): Promise<LibraryCoreNormalizedReplicaAuditV1>;
  client: Evidence["client"];
}) {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [audit]);

  const run = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const startedAt = new Date().toISOString();
    setPending(true); setEvidence(null); setError(null); setCopied(false);
    try {
      const receipt = await audit(controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      setEvidence({ client, interfaceBuild: readBuildMetadata(), startedAt,
        completedAt: new Date().toISOString(), audit: receipt });
    } catch (cause) {
      if (active.current === controller && !controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Library audit failed.";
        setError(message === "AUDIT_DEADLINE" || message === "QUERY_DEADLINE"
          ? "The audit reached its time limit. No receipt was produced."
          : message);
      }
    } finally {
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  };
  const cancel = () => {
    active.current?.abort(); active.current = null; setPending(false);
    setError("Audit cancelled.");
  };
  const copy = async () => {
    if (!evidence) return;
    try { await copyExactJsonToClipboard(evidence); setCopied(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt could not be copied."); }
  };
  const tail = (value: string) => `...${value.slice(-8)}`;
  return <section data-testid="library-replica-audit" className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
    <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Library convergence receipt</h3>
    <p className="mt-1 text-xs text-[var(--theme-text-secondary)]">Sync each installation, then run this audit on each one. Compare receipts from the same Library epoch and revision. Later edits require a new audit.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs" disabled={pending} onClick={() => void run()}>{pending ? "Auditing Library…" : "Audit this Library"}</button>
      {pending && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs" onClick={cancel}>Cancel audit</button>}
      {evidence && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs" onClick={() => void copy()}>{copied ? "Receipt copied" : "Copy audit receipt"}</button>}
    </div>
    {evidence && <dl className="mt-3 space-y-1 text-xs text-[var(--theme-text-secondary)]">
      <div><dt className="inline">Revision: </dt><dd className="inline">{evidence.audit.snapshot.sourceRevision.toLocaleString()}</dd></div>
      <div><dt className="inline">State digest: </dt><dd className="inline font-mono" title={evidence.audit.checkpointDigest}>{tail(evidence.audit.checkpointDigest)}</dd></div>
      <div><dt className="inline">Actor frontier: </dt><dd className="inline font-mono" title={evidence.audit.snapshot.causalFrontierDigest}>{tail(evidence.audit.snapshot.causalFrontierDigest)}</dd></div>
    </dl>}
    {error && <p role="status" className="mt-2 text-xs text-[var(--theme-text-secondary)]">{error}</p>}
  </section>;
}
