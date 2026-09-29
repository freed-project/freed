import type { RecoveryPreferenceDraft } from "@freed/shared/library-core";
import { useEffect, useRef, useState } from "react";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoveryPreferenceFields } from "@freed/ui/components/RecoveryPreferenceFields";
import { loadPwaRecoveryPreferenceDrafts } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryPreferenceAction } from "../lib/library-core-pwa-follower-mutations";

/** Browser verification and signing remain outside the shared preference form. */
export function PwaRecoveryPreferenceEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryPreferenceDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryPreferenceAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (pending.current) onMutating(false); };
  }, [onMutating]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoveryPreferenceDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDrafts(result.drafts);
    }).catch(() => {
      if (!controller.signal.aborted) setError("The Library changed or the complete preference edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const submit = async (patches: readonly unknown[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoveryPreferenceAction(review, patches);
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
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified settings..."}</p>;
  return <RecoveryPreferenceFields drafts={drafts} saving={saving} locked={locked} error={error} onSubmit={submit} />;
}
