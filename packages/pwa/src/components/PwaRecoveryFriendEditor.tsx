import type { RecoveryFriendDraft } from "@freed/ui/components/RecoveryFriendFields";
import { useEffect, useRef, useState } from "react";
import type { Account, Person } from "@freed/shared";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import { RecoveryFriendFields } from "@freed/ui/components/RecoveryFriendFields";
import { loadPwaRecoveryFriendDraft } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryFriendAction } from "../lib/library-core-pwa-follower-mutations";

/** Browser verification and signing remain outside the shared Friend form. */
export function PwaRecoveryFriendEditor({ review, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: LibraryCoreRecoveryReissueReceiptV1) => void;
  onMutating: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<RecoveryFriendDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryFriendAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (pending.current) onMutating(false); };
  }, [onMutating]);
  useEffect(() => {
    const controller = new AbortController();
    // The parent unmounts during review reload and keys each edit by its digest.
    void loadPwaRecoveryFriendDraft(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement); else setDraft(result.draft);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "A person in this edit was deleted. Recovery cannot recreate them."
        ? "A person in this edit was deleted. This action cannot restore it. The entire archived edit is preserved."
        : "The Library changed, Person state is unavailable, or the complete edit could not be verified. Its archive is preserved. Start again to review it.");
    });
    return () => controller.abort();
  }, [review, onReplacement]);
  const submit = async (person: Person, accounts: readonly Account[]) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); onMutating(true); setError(null);
    try {
      action.current ??= createPwaRecoveryFriendAction(review, person, accounts);
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
  if (!draft) return <p role={error ? "alert" : "status"}>{error ?? "Loading verified Friend and accounts..."}</p>;
  return <RecoveryFriendFields draft={draft} onChange={setDraft} saving={saving} locked={locked} error={error} onSubmit={submit} />;
}
