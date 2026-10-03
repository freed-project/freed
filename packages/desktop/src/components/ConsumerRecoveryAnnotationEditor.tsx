import { useEffect, useRef, useState } from "react";
import { RecoveryAnnotationFields } from "@freed/ui/components/RecoveryAnnotationFields";
import { canonicalizeFeedItemTagsV1, type LibraryCoreRecoveryIntentReviewResponseV1, type LibraryCoreItemAnnotationsResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryAnnotationDrafts, type RecoveryAnnotationDraft } from "../lib/library-core-recovery-annotation-editor";
import { queryNormalizedLibrary } from "../lib/library-core-normalized-query-client";
import { prepareDesktopRecoveryAnnotationTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";

/** Keep one current comparison and one transaction draft, never an item corpus. */
export function ConsumerRecoveryAnnotationEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryAnnotationDraft[] | null>(null);
  const [page, setPage] = useState(0), [seen, setSeen] = useState(0);
  const [current, setCurrent] = useState<LibraryCoreItemAnnotationsResponseV1 | null>(null);
  const sizes = useRef<number[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryAnnotationDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else { sizes.current = result.drafts.map((row) => new TextEncoder().encode(JSON.stringify(row)).length); setDrafts(result.drafts); }
    }).catch(() => { if (!controller.signal.aborted) setError("The complete edit could not be verified. Start again to review it."); });
    return () => controller.abort();
  }, [review, onReplacement]);
  const draft = drafts?.[page];
  const entityId = draft?.entityId;
  useEffect(() => {
    setCurrent(null);
    if (!entityId) return;
    const controller = new AbortController();
    void queryNormalizedLibrary({ queryId: "item_annotations_v1", schemaVersion: 1, globalId: entityId }, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.source.generationId !== review.source.generationId || value.source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
      setCurrent(value); setSeen((n) => Math.max(n, page + 1));
    }).catch(() => { if (!controller.signal.aborted) setError("The Library changed or its annotations could not be read. Start again to review it."); });
    return () => controller.abort();
  }, [entityId, page, review]);
  const update = (next: RecoveryAnnotationDraft) => {
    const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
    if (sizes.current.reduce((sum, size, i) => sum + (i === page ? bytes : size), 0) > 4194304) {
      setValidationError("The complete edit is too large. This change was not added."); return;
    }
    sizes.current[page] = bytes; setValidationError(null);
    setDrafts((rows) => rows!.map((row, i) => i === page ? next : row));
  };
  const contextReady = current?.globalId === entityId;
  const disabled = commit.saving || commit.locked;
  return <div className="mt-3 space-y-3" data-testid="recovery-annotation-editor">
    <p>This replaces the complete annotation set for each item, including its note, highlights and tags. Review the archived values below. Newer or queued annotations may be replaced.</p>
    {(error || validationError || commit.error) && <p role="alert" className="theme-feedback-text-danger">{error || validationError || commit.error}</p>}
    {!draft && !error && <p role="status">Loading verified annotations...</p>}
    {draft && <>
      <p className="font-semibold break-words">Item {(page + 1).toLocaleString()} of {drafts!.length.toLocaleString()}: {draft.label}</p>
      <RecoveryAnnotationFields value={draft} current={current} disabled={disabled} onChange={value => update({ ...draft, ...value })} />
      <div className="flex flex-wrap gap-2">
        {page > 0 && <button type="button" className={button} disabled={commit.saving} onClick={() => setPage(page - 1)}>Previous item</button>}
        {page + 1 < drafts!.length && <button type="button" className={button} disabled={commit.saving || !contextReady || !!error} onClick={() => setPage(page + 1)}>Next item</button>}
        <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={commit.saving || !contextReady || !!error || seen < drafts!.length} onClick={() => void commit.submit(() => prepareDesktopRecoveryAnnotationTransaction(drafts!.map((row) => ({ ...row, tags: canonicalizeFeedItemTagsV1(row.tags) })), primary))}>{commit.saving ? "Storing replacement..." : "Store revised annotations"}</button>
      </div>
    </>}
  </div>;
}
