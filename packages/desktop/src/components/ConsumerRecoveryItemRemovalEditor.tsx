import { useEffect, useState } from "react";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryAccountRemovalDrafts, loadRecoveryItemRemovalDrafts, loadRecoveryPersonRemovalDrafts, type RecoveryItemRemovalDraft } from "../lib/library-core-recovery-item-editor";
import { prepareDesktopRecoveryAccountRemovalTransaction, prepareDesktopRecoveryItemRemovalTransaction, prepareDesktopRecoveryPersonRemovalTransaction } from "../lib/sqlite-library";
import type { RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";
import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";

/** Review the fixed original target set in bounded pages before signing deletion. */
export function ConsumerRecoveryItemRemovalEditor({ primary = false, review, onReplacement, onMutating, mode = "items" }: {
  mode?: "items" | "people" | "accounts";
  primary?: boolean;
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const people = mode === "people", accounts = mode === "accounts";
  const load = accounts ? loadRecoveryAccountRemovalDrafts : people ? loadRecoveryPersonRemovalDrafts : loadRecoveryItemRemovalDrafts;
  const prepare = accounts ? prepareDesktopRecoveryAccountRemovalTransaction : people ? prepareDesktopRecoveryPersonRemovalTransaction : prepareDesktopRecoveryItemRemovalTransaction;
  const [drafts, setDrafts] = useState<readonly RecoveryItemRemovalDraft[] | null>(null);
  const [page, setPage] = useState(0), [seen, setSeen] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating, primary);
  useEffect(() => {
    const controller = new AbortController();
    void load(review, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement(result.replacement);
      else { setDrafts(result.drafts); setSeen(Math.min(8, result.drafts.length)); setError(null); }
    }).catch(() => { if (!controller.signal.aborted) setError("The complete deletion could not be verified. Start again to review it."); });
    return () => controller.abort();
  }, [review, onReplacement, load]);
  const button = "btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50";
  return <div className="mt-3 space-y-3" data-testid="recovery-item-removal-editor">
    <p>{accounts ? "This removes only the original accounts listed below from the Library, including their current links and account details. It does not delete the linked people or accounts at their providers. An absent account does not prove that the original edit was accepted." : people
      ? "This deletes the original people listed below and accounts linked to them when the Primary accepts the edit, including links added since this review. It also removes their notes and reach-out history. An absent person does not prove that the original edit was accepted."
      : "This deletes only the original items listed below, including their current notes and saved state. Later additions to the Library are not included. An absent item does not prove that the original edit was accepted."}</p>
    {(error || commit.error) && <p role="alert" className="theme-feedback-text-danger">{error || commit.error}</p>}
    {!drafts && !error && <p role="status">Loading verified deletion targets...</p>}
    {drafts && <>
      <p>{drafts.length.toLocaleString()} original {accounts ? (drafts.length === 1 ? "account" : "accounts") : people ? (drafts.length === 1 ? "person" : "people") : (drafts.length === 1 ? "item" : "items")}</p>
      <ul className="space-y-2">{drafts.slice(page * 8, (page + 1) * 8).map((draft, index) => <li key={page * 8 + index} className="break-words">
        {draft.label} (...{draft.entityId.slice(-8)}){!draft.present && <p className="text-[var(--theme-text-muted)]">Currently absent. This target remains in the deletion.</p>}
      </li>)}</ul>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={commit.saving || commit.locked} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>{accounts ? "Delete these original accounts from the Library, including account details and links changed before Primary acceptance." : people ? "Delete these original people, their notes and reach-out history, and accounts linked to them at Primary acceptance." : "Delete these original items and their current annotations, including changes made before Primary acceptance."}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {page > 0 && <button type="button" className={button} disabled={commit.saving} onClick={() => setPage(page - 1)}>{accounts ? "Previous accounts" : people ? "Previous people" : "Previous items"}</button>}
        {(page + 1) * 8 < drafts.length && <button type="button" className={button} disabled={commit.saving} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, Math.min((page + 2) * 8, drafts.length))); }}>{accounts ? "Next accounts" : people ? "Next people" : "Next items"}</button>}
        <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={commit.saving || !!error || !confirmed || seen < drafts.length || drafts.length === 0}
          onClick={() => void commit.submit(() => prepare(drafts.map((draft) => draft.entityId), confirmed, primary))}>{commit.saving ? "Storing replacement..." : accounts ? "Store account deletion" : people ? "Store people deletion" : "Store item deletion"}</button>
      </div>
    </>}
  </div>;
}
