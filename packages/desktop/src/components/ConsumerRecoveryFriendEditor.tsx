import { useEffect, useState } from "react";
import { RecoveryFriendFields, type RecoveryFriendDraft } from "@freed/ui/components/RecoveryFriendFields";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryFriendDraft } from "../lib/library-core-recovery-friend-editor";
import { prepareDesktopRecoveryFriendTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

export function ConsumerRecoveryFriendEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<RecoveryFriendDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    setDraft(null); setError(null);
    void loadRecoveryFriendDraft(review, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDraft(result.draft);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The complete Friend edit could not be loaded. The Library may have changed, the Person may have been deleted, or the account set may exceed this editor's limit. The archive is preserved.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!draft) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified Friend and accounts..."}</p>;
  return <RecoveryFriendFields draft={draft} onChange={setDraft} saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(person, accounts) => commit.submit(() => prepareDesktopRecoveryFriendTransaction(person, accounts, primary))} />;
}
