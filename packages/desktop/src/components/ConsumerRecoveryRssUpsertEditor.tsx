import { RecoveryRssSubscriptionFields } from "@freed/ui/components/RecoveryRssSubscriptionFields";
import { useEffect, useState } from "react";
import { type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryRssUpsertDrafts, type RecoveryRssUpsertDraft } from "../lib/library-core-recovery-rss-editor";
import { prepareDesktopRecoveryRssUpsertTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** One subscription per page; preserve the complete transaction and exact retry bytes. */
export function ConsumerRecoveryRssUpsertEditor({ primary = false, review, onReplacement, onMutating }: {
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryRssUpsertDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void loadRecoveryRssUpsertDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else setDrafts(result.drafts);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "This subscription was deleted. Recovery cannot restore it with an upsert."
        ? "A subscription in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed, a subscription is absent, or the complete edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified subscriptions..."}</p>;
  return <RecoveryRssSubscriptionFields drafts={drafts} onChange={setDrafts}
    saving={commit.saving} locked={commit.locked} error={error || commit.error}
    onSubmit={(feeds) => commit.submit(() => prepareDesktopRecoveryRssUpsertTransaction(feeds, primary))} />;
}
