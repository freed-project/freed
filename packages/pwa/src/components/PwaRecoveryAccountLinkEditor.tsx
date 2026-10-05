import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryCoreNormalizedQueryExecutor, LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoveryAccountLinkFields, type RecoveryAccountLinkDraft } from "@freed/ui/components/RecoveryAccountLinkFields";
import { loadPwaRecoveryAccountLinkDrafts } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryAccountLinkAction } from "../lib/library-core-pwa-follower-mutations";
import { queryPwaNormalizedLibrary } from "../lib/library-core-sqlite-runtime";

/** One explicit browser recovery action owns finalized bytes through ambiguous retries. */
export function PwaRecoveryAccountLinkEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryAccountLinkDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false), generation = useRef(0);
  const action = useRef<ReturnType<typeof createPwaRecoveryAccountLinkAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; if (pending.current) onMutating(false); };
  }, [onMutating]);
  const query = useCallback<LibraryCoreNormalizedQueryExecutor>(async request => {
    const owner = generation.current;
    const response = await queryPwaNormalizedLibrary(request);
    if (!alive.current || owner !== generation.current) throw new Error("Recovery editor closed.");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision) {
      setError("The Library changed. Start again to review its current links.");
      throw new Error("CURSOR_STALE");
    }
    return response;
  }, [review]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoveryAccountLinkDrafts(review, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDrafts(result.drafts);
    }).catch(() => { if (!controller.signal.aborted) setError("The complete account edit could not be verified. Start again to review it; all archived members remain preserved."); });
    return () => { controller.abort(); generation.current += 1; };
  }, [review, onReplacement]);
  const submit = async (assignments: readonly { accountId: string; personId: string | null }[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoveryAccountLinkAction(review, assignments);
      setLocked(true);
      const receipt = await action.current();
      if (alive.current) onReplacement(receipt);
    } catch {
      if (alive.current) setError("No replacement was confirmed. Retry uses the same action and signed edit. If the Library changed, start again to review it.");
    } finally {
      pending.current = false;
      if (alive.current) { setSaving(false); onMutating(false); }
    }
  };
  return <div className="mt-3 space-y-3">
    {error && <p role="alert" className="theme-feedback-text-danger">{error}</p>}
    {!drafts && !error && <p role="status">Loading verified account links...</p>}
    {drafts && (!error || locked) && <RecoveryAccountLinkFields drafts={drafts} query={query} sourceVersion={review.source.projectionRevision} saving={saving} locked={locked} onSubmit={submit} />}
  </div>;
}
