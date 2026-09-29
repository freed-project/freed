import { useEffect, useRef, useState } from "react";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { reapplyArchivedEditorTransaction, type RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";

/** Keep exact finalized bytes until this reviewed editor closes. Native linkage owns durability. */
export function useRecoveryEditorCommit(review: LibraryCoreRecoveryIntentReviewResponseV1,
  onReplacement: (receipt: RecoveryReissueReceipt) => void, onMutating: (value: boolean) => void) {
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frames = useRef<readonly string[] | null>(null);
  const busy = useRef(false), alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (busy.current) onMutating(false); };
  }, [onMutating]);
  const submit = async (prepare: () => Promise<readonly string[]>) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null); onMutating(true);
    try {
      frames.current ??= await prepare();
      if (alive.current) setLocked(true);
      const receipt = await reapplyArchivedEditorTransaction(review, frames.current);
      if (alive.current) onReplacement(receipt);
    } catch {
      if (alive.current) setError(frames.current ? "No replacement was confirmed. Retry checks the stored link using the same signed edit. If the Library changed, start again to review it." : "This edit could not be prepared. Check its values and size, or start again if the Library changed.");
    } finally {
      busy.current = false;
      if (alive.current) { setSaving(false); onMutating(false); }
    }
  };
  return { saving, locked, error, submit };
}
