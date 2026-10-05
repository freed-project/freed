import { useEffect, useRef, useState } from "react";
import { RecoveryAnnotationFields } from "@freed/ui/components/RecoveryAnnotationFields";
import { type LibraryCoreRecoveryIntentReviewResponseV1, type LibraryCoreItemAnnotationsResponseV1 } from "@freed/shared/library-core";
import { loadPwaRecoveryAnnotationDrafts, type PwaRecoveryAnnotationDraft } from "../lib/library-core-pwa-recovery-editors";
import { queryPwaNormalizedLibrary } from "../lib/library-core-sqlite-runtime";
import { createPwaRecoveryAnnotationAction } from "../lib/library-core-pwa-follower-mutations";
import type { LibraryCoreRecoveryReissueReceiptV1 as RecoveryReissueReceipt } from "@freed/shared/library-core";

const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";

/** Keep one current comparison and one transaction draft, never an item corpus. */
export function PwaRecoveryAnnotationEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly PwaRecoveryAnnotationDraft[] | null>(null);
  const [page, setPage] = useState(0), [seen, setSeen] = useState(0);
  const [current, setCurrent] = useState<LibraryCoreItemAnnotationsResponseV1 | null>(null);
  const sizes = useRef<number[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const pending = useRef(false), alive = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryAnnotationAction> | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit() {
    if (!drafts || pending.current || seen < drafts.length) return;
    pending.current = true; setSaving(true); onMutating(true); setCommitError(null);
    try {
      action.current ??= createPwaRecoveryAnnotationAction(review, drafts);
      setLocked(true);
      const receipt = await action.current();
      if (alive.current) onReplacement(receipt);
    } catch (failure) {
      if (alive.current) setCommitError(failure instanceof Error ? failure.message : "Replacement could not be confirmed.");
    } finally {
      pending.current = false;
      if (alive.current) { setSaving(false); onMutating(false); }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoveryAnnotationDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else { sizes.current = result.drafts.map((row) => new TextEncoder().encode(JSON.stringify(row)).length); setDrafts(result.drafts); }
    }).catch(() => { if (!controller.signal.aborted) setError("The complete edit could not be verified. Start again to review it."); });
    return () => controller.abort();
  }, [review, onReplacement]);
  const draft = drafts?.[page];
  const entityId = draft?.entityId;
  useEffect(() => {
    if (!entityId) return;
    const controller = new AbortController();
    void queryPwaNormalizedLibrary({ queryId: "item_annotations_v1", schemaVersion: 1, globalId: entityId }).then((value) => {
      if (controller.signal.aborted) return;
      if (value.source.generationId !== review.source.generationId || value.source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
      setCurrent(value); setSeen((n) => Math.max(n, page + 1));
    }).catch(() => { if (!controller.signal.aborted) setError("The Library changed or its annotations could not be read. Start again to review it."); });
    return () => controller.abort();
  }, [entityId, page, review]);
  const update = (next: PwaRecoveryAnnotationDraft) => {
    const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
    if (sizes.current.reduce((sum, size, i) => sum + (i === page ? bytes : size), 0) > 4194304) {
      setValidationError("The complete edit is too large. This change was not added."); return;
    }
    sizes.current[page] = bytes; setValidationError(null);
    setDrafts((rows) => rows!.map((row, i) => i === page ? next : row));
  };
  const selectedCurrent = current?.globalId === entityId ? current : null;
  const contextReady = selectedCurrent !== null;
  const disabled = saving || locked;
  return <div className="mt-3 space-y-3 text-xs" data-testid="recovery-annotation-editor">
    <p>This replaces the complete annotation set for each item, including its note, highlights and tags. Review the archived values below. Last-synced values omit pending edits. Newer or queued annotations may be replaced.</p>
    {(error || validationError || commitError) && <p role="alert" className="theme-feedback-text-danger">{error || validationError || commitError}</p>}
    {!draft && !error && <p role="status">Loading verified annotations...</p>}
    {draft && <>
      <p className="font-semibold break-words">Item {(page + 1).toLocaleString()} of {drafts!.length.toLocaleString()}: {draft.label}</p>
      <RecoveryAnnotationFields value={draft} current={selectedCurrent} disabled={disabled} onChange={value => update({ ...draft, ...value })} />
      <div className="flex flex-wrap gap-2">
        {page > 0 && <button type="button" className={button} disabled={saving} onClick={() => setPage(page - 1)}>Previous item</button>}
        {page + 1 < drafts!.length && <button type="button" className={button} disabled={saving || !contextReady || !!error} onClick={() => setPage(page + 1)}>Next item</button>}
        <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || !contextReady || !!error || seen < drafts!.length} onClick={() => void submit()}>{saving ? "Storing replacement..." : locked ? "Retry same annotations" : "Store revised annotations"}</button>
      </div>
    </>}
  </div>;
}
