import type { RecoveryReachOutDraft } from "@freed/ui/components/RecoveryReachOutFields";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoveryReachOutFields } from "@freed/ui/components/RecoveryReachOutFields";
import { loadPwaRecoveryReachOutDrafts, readPwaRecoveryReachOutHistory } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryReachOutAction } from "../lib/library-core-pwa-follower-mutations";

/** Browser verification and signing remain outside the shared ReachOut form. */
export function PwaRecoveryReachOutEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryReachOutDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryReachOutAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (pending.current) onMutating(false); };
  }, [onMutating]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoveryReachOutDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDrafts(result.drafts);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete reach-out edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const submit = async (drafts: readonly RecoveryReachOutDraft[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoveryReachOutAction(review, drafts);
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
  const readHistory = useCallback((personId: string, signal: AbortSignal) => readPwaRecoveryReachOutHistory(review, personId, signal), [review]);
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified events..."}</p>;
  return <RecoveryReachOutFields drafts={drafts} onChange={setDrafts} readHistory={readHistory} saving={saving} locked={locked} error={error} onSubmit={submit} />;
}
