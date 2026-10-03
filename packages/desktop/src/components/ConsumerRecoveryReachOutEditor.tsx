import type { RecoveryReachOutDraft } from "@freed/ui/components/RecoveryReachOutFields";
import { RecoveryReachOutFields } from "@freed/ui/components/RecoveryReachOutFields";
import { useCallback, useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryReachOutDrafts, readRecoveryReachOutHistory } from "../lib/library-core-recovery-reach-out-editor";
import { prepareDesktopRecoveryReachOutTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** One event per page; preserve the complete transaction and exact retry bytes. */
export function ConsumerRecoveryReachOutEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryReachOutDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryReachOutDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete reach-out edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const readHistory = useCallback((personId: string, signal: AbortSignal) => readRecoveryReachOutHistory(review, personId, signal), [review]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified events..."}</p>;
  return <RecoveryReachOutFields drafts={drafts} onChange={setDrafts}
    readHistory={readHistory} saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(drafts) => commit.submit(() => prepareDesktopRecoveryReachOutTransaction(drafts, primary))} />;
}
