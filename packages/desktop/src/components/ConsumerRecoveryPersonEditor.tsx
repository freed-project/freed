import type { RecoveryPersonDraft } from "@freed/ui/components/RecoveryPersonFields";
import { RecoveryPersonFields } from "@freed/ui/components/RecoveryPersonFields";
import { useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryPersonDrafts } from "../lib/library-core-recovery-person-editor";
import { prepareDesktopRecoveryPersonTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** One person per page; preserve the complete transaction and exact retry bytes. */
export function ConsumerRecoveryPersonEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryPersonDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryPersonDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "A person in this edit was deleted. Recovery cannot recreate them."
        ? "A person in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed, Person state is unavailable, or the complete edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified people..."}</p>;
  return <RecoveryPersonFields drafts={drafts} onChange={setDrafts}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(feeds) => commit.submit(() => prepareDesktopRecoveryPersonTransaction(feeds))} />;
}
