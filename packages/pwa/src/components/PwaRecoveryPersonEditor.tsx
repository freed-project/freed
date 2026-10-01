import type { RecoveryPersonDraft } from "@freed/ui/components/RecoveryPersonFields";
import { useEffect, useRef, useState } from "react";
import type { Person } from "@freed/shared";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoveryPersonFields } from "@freed/ui/components/RecoveryPersonFields";
import { loadPwaRecoveryPersonDrafts } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryPersonAction } from "../lib/library-core-pwa-follower-mutations";

/** Browser verification and signing remain outside the shared subscription form. */
export function PwaRecoveryPersonEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly RecoveryPersonDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryPersonAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (pending.current) onMutating(false); };
  }, [onMutating]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPwaRecoveryPersonDrafts(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDrafts(result.drafts);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "A person in this edit was deleted. Recovery cannot recreate them."
        ? "A person in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed, Person state is unavailable, or the complete edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const submit = async (feeds: readonly Person[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoveryPersonAction(review, feeds);
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
  if (!drafts) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified people..."}</p>;
  return <RecoveryPersonFields drafts={drafts} onChange={setDrafts} saving={saving} locked={locked} error={error} onSubmit={submit} />;
}
