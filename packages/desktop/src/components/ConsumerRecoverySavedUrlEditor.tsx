import type { RecoverySavedUrlDraft } from "@freed/shared/library-core";
import { RecoverySavedUrlFields } from "@freed/ui/components/RecoverySavedUrlFields";
import { useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoverySavedUrlDrafts } from "../lib/library-core-recovery-saved-url-editor";
import { prepareDesktopRecoverySavedUrlTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** One saved URL per page; preserve the complete transaction and exact retry bytes. */
export function ConsumerRecoverySavedUrlEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoverySavedUrlDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoverySavedUrlDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "This saved item was deleted. Recovery cannot recreate it."
        ? "An item in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed or the complete saved URL edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified saved URLs..."}</p>;
  return <RecoverySavedUrlFields drafts={drafts} onChange={setDrafts}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(feeds) => commit.submit(() => prepareDesktopRecoverySavedUrlTransaction(review, feeds))} />;
}
