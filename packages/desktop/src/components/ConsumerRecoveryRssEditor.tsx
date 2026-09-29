import { useRecoveryEditorCommit } from "../hooks/useRecoveryEditorCommit";
import { useEffect, useRef, useState } from "react";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { loadRecoveryRssTitleDrafts, loadRecoveryRssRemovalDrafts, type RecoveryRssRemovalDraft, type RecoveryRssTitleDraft } from "../lib/library-core-recovery-rss-editor";
import { prepareDesktopRecoveryRssTitleTransaction, prepareDesktopRecoveryRssRemovalTransaction } from "../lib/sqlite-library";
import { type RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";

/** One bounded transaction draft; render at most eight fields at a time. */
export function ConsumerRecoveryRssEditor({ review, onReplacement, onMutating, mode = "title" }: {
  mode?: "title" | "remove";
  review: LibraryCoreRecoveryIntentReviewResponseV1;
  onReplacement: (receipt: RecoveryReissueReceipt) => void;
  onMutating: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<readonly (RecoveryRssTitleDraft | RecoveryRssRemovalDraft)[] | null>(null);
  const [confirmedDeleteItems, setConfirmedDeleteItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState(0);
  const commit = useRecoveryEditorCommit(review, onReplacement, onMutating);
  const { saving } = commit;
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const load = mode === "remove" ? loadRecoveryRssRemovalDrafts : loadRecoveryRssTitleDrafts;
    void load(review, controller.signal).then((result) => {
      if (controller.signal.aborted || !alive.current) return;
      if (result.replacement) onReplacement(result.replacement);
      else { setDrafts(result.drafts); setSeen(Math.min(8, result.drafts.length)); }
    }).catch(() => {
      if (!controller.signal.aborted && alive.current) setError("The Library changed or this edit could not be verified. Start again to review it.");
    });
    return () => { alive.current = false; controller.abort(); };
  }, [review, onReplacement, onMutating, mode]);
  const includeItems = drafts?.some((row) => "includeItems" in row && row.includeItems) ?? false;
  const submit = async () => {
    if (!drafts || saving || seen < drafts.length) return;
    if (mode === "remove") {
      if (includeItems && !confirmedDeleteItems) return;
      setError(null);
      await commit.submit(() => prepareDesktopRecoveryRssRemovalTransaction(drafts.map((row) => row.url), includeItems, confirmedDeleteItems));
      return;
    }
    const assignments = drafts.map((row) => ({ url: row.url, title: row.title.trim() }));
    if (assignments.some((row) => !row.title || new TextEncoder().encode(row.title).length > 4096)) {
      setError(`Each name must contain text and be ${Number(4096).toLocaleString()} bytes or fewer.`); return;
    }
    setError(null);
    await commit.submit(() => prepareDesktopRecoveryRssTitleTransaction(assignments));
  };
  return <div className="mt-3 space-y-3" data-testid="recovery-rss-editor">
    <p>{mode === "remove"
      ? "Review every subscription before storing this unsubscribe. The original outcome is unknown unless rejection was verified. Primary acceptance will stop future polls to these feeds."
      : "Review every feed name before storing this replacement. It may override newer or queued names. Nothing is fetched from these URLs."}</p>
    {(error || commit.error) && <p role="alert" className="theme-feedback-text-danger">{error || commit.error}</p>}
    {!drafts && !error && <p role="status">Loading verified subscriptions...</p>}
    {drafts?.slice(page * 8, page * 8 + 8).map((row, offset) => {
      const index = page * 8 + offset;
      return <label key={index} className="block space-y-1">
        <span className="block break-all">{row.url}</span>
        {"includeItems" in row ? <span className="block">Last synced: {row.title}. {row.includeItems ? "Remove subscription and articles" : "Remove subscription; keep articles"}.</span> : <>
        <span className="block">Archived: {row.archivedTitle}</span>
        <span className="block">Last synced: {row.currentTitle}</span>
        <input aria-label={`Feed name ${(index + 1).toLocaleString()}`} type="text" maxLength={4096} value={row.title}
          disabled={saving || commit.locked}
          onChange={(event) => setDrafts((current) => current!.map((value, n) => n === index ? { ...value, title: event.target.value } : value))}
          className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2" /></>}
      </label>;
    })}
    {mode === "remove" && includeItems && <label className="flex items-start gap-2">
      <input type="checkbox" checked={confirmedDeleteItems} disabled={saving || commit.locked} onChange={(event) => setConfirmedDeleteItems(event.target.checked)} />
      <span>Delete all Library articles and their history from these feeds, including articles added after the original edit or before Primary acceptance.</span>
    </label>}
    {drafts && <div className="flex flex-wrap gap-2">
      {page > 0 && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => setPage(page - 1)}>{mode === "remove" ? "Previous subscriptions" : "Previous names"}</button>}
      {(page + 1) * 8 < drafts.length && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5" disabled={saving} onClick={() => { setPage(page + 1); setSeen(Math.max(seen, Math.min((page + 2) * 8, drafts.length))); }}>{mode === "remove" ? "Next subscriptions" : "Next names"}</button>}
      <button type="button" className="btn-primary rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={saving || seen < drafts.length || (includeItems && !confirmedDeleteItems)} onClick={() => void submit()}>{saving ? "Storing replacement..." : mode === "remove" ? "Store unsubscribe" : "Store revised names"}</button>
    </div>}
  </div>;
}
