import type { RecoveryAccountDraft } from "@freed/ui/components/RecoveryAccountFields";
import { RecoveryAccountFields } from "@freed/ui/components/RecoveryAccountFields";
import { useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryAccountDrafts } from "../lib/library-core-recovery-account-upsert-editor";
import { prepareDesktopRecoveryAccountTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** One account per page; preserve the complete transaction and exact retry bytes. */
export function ConsumerRecoveryAccountEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryAccountDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryAccountDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete Account edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified accounts..."}</p>;
  return <RecoveryAccountFields drafts={drafts} onChange={setDrafts}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(accounts) => commit.submit(() => prepareDesktopRecoveryAccountTransaction(accounts, review, primary))} />;
}
