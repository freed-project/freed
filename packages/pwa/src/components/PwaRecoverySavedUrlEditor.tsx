import type { RecoverySavedUrlDraft } from "@freed/shared/library-core";
import { useEffect, useRef, useState } from "react";
import type { RecoverySavedUrlEdit } from "@freed/shared/library-core";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoverySavedUrlFields } from "@freed/ui/components/RecoverySavedUrlFields";
import { loadPwaRecoverySavedUrlDrafts } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoverySavedUrlAction } from "../lib/library-core-pwa-follower-mutations";

/** Browser verification and signing remain outside the shared saved URL form. */
export function PwaRecoverySavedUrlEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoverySavedUrlDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoverySavedUrlAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (pending.current) onMutating(false); };
  }, [onMutating]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoverySavedUrlDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDrafts(result.drafts);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "This saved item was deleted. Recovery cannot recreate it."
        ? "An item in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed or the complete saved URL edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const submit = async (feeds: readonly RecoverySavedUrlEdit[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoverySavedUrlAction(review, feeds);
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
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified saved URLs..."}</p>;
  return <RecoverySavedUrlFields drafts={drafts} onChange={setDrafts} saving={saving} locked={locked} error={error} onSubmit={submit} />;
}
