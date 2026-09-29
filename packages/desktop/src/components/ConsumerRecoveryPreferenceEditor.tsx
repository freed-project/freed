import type { RecoveryPreferenceDraft } from "@freed/shared/library-core";
import { RecoveryPreferenceFields } from "@freed/ui/components/RecoveryPreferenceFields";
import { useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryPreferenceDrafts } from "../lib/library-core-recovery-preference-editor";
import { prepareDesktopRecoveryPreferenceTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** Review exact preference assignments and retain finalized bytes for retry. */
export function ConsumerRecoveryPreferenceEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryPreferenceDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryPreferenceDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete preference edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified settings..."}</p>;
  return <RecoveryPreferenceFields drafts={drafts}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(drafts) => commit.submit(() => prepareDesktopRecoveryPreferenceTransaction(drafts))} />;
}
