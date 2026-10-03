import { readLibraryCoreRecoveryPreferenceCurrentV1 } from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "../lib/library-core-normalized-query-client";
import type { RecoveryPreferenceDraft } from "@freed/shared/library-core";
import { RecoveryPreferenceFields } from "@freed/ui/components/RecoveryPreferenceFields";
import { useCallback, useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryPreferenceDrafts } from "../lib/library-core-recovery-preference-editor";
import { prepareDesktopRecoveryPreferenceTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** Review exact preference assignments and retain finalized bytes for retry. */
export function ConsumerRecoveryPreferenceEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<{ review: LibraryCoreRecoveryIntentReviewResponseV1; drafts: readonly RecoveryPreferenceDraft[] } | null>(null);
  const drafts = loaded?.review === review ? loaded.drafts : null;
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryPreferenceDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setLoaded({ review, drafts: result.drafts });
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete preference edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const readCurrent = useCallback((path: readonly string[], signal: AbortSignal) =>
    readLibraryCoreRecoveryPreferenceCurrentV1(review, path, request => queryNormalizedLibrary(request, signal),
      () => { if (signal.aborted) throw new Error("QUERY_CANCELLED"); }), [review]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified settings..."}</p>;
  return <RecoveryPreferenceFields drafts={drafts} readCurrent={readCurrent}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(drafts) => commit.submit(() => prepareDesktopRecoveryPreferenceTransaction(drafts, primary))} />;
}
