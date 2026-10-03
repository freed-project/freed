import { useCallback, useEffect, useRef, useState } from "react";
import { RecoveryAccountLinkFields, type RecoveryAccountLinkDraft } from "@freed/ui/components/RecoveryAccountLinkFields";
import type { LibraryCoreNormalizedQueryExecutor, LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryAccountLinkDrafts } from "../lib/library-core-recovery-account-editor";
import { queryNormalizedLibrary } from "../lib/library-core-normalized-query-client";
import { prepareDesktopRecoveryAccountPersonTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** Recovery signs through the normal builder and commits only through native linkage. */
export function ConsumerRecoveryAccountLinkEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryAccountLinkDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  const searches = useRef(new Set<AbortController>());
  const query = useCallback<LibraryCoreNormalizedQueryExecutor>(async request => {
    const controller = new AbortController();
    searches.current.add(controller);
    try {
    const response = await queryNormalizedLibrary(request, controller.signal);
    if (controller.signal.aborted) throw new Error("QUERY_CANCELLED");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision) {
      setError("The Library changed. Start again to review its current links.");
      throw new Error("CURSOR_STALE");
    }
    return response;
    } finally { searches.current.delete(controller); }
  }, [review]);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryAccountLinkDrafts(review, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch(() => { if (!controller.signal.aborted) setError("The complete account edit could not be verified. Start again to review it; all archived members remain preserved."); });
    return () => { controller.abort(); for (const search of searches.current) search.abort(); searches.current.clear(); };
  }, [review, onReplacement]);
  return <div className="mt-3 space-y-3" data-testid="recovery-account-link-editor">
    {(error || commit.error) && <p role="alert" className="theme-feedback-text-danger">{error || commit.error}</p>}
    {!drafts && !error && <p role="status">Loading verified account links...</p>}
    {drafts && (!error || commit.locked) && <RecoveryAccountLinkFields drafts={drafts} query={query} sourceVersion={review.source.projectionRevision} saving={commit.saving} locked={commit.locked}
      onSubmit={assignments => void commit.submit(() => prepareDesktopRecoveryAccountPersonTransaction(assignments, primary))} />}
  </div>;
}
