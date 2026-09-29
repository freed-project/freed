import { PwaRecoveryReachOutEditor } from "./PwaRecoveryReachOutEditor";
import { PwaRecoveryAccountEditor } from "./PwaRecoveryAccountEditor";
import { PwaRecoveryFriendEditor } from "./PwaRecoveryFriendEditor";
import { PwaRecoveryPersonEditor } from "./PwaRecoveryPersonEditor";
import { PwaRecoveryAccountLinkEditor } from "./PwaRecoveryAccountLinkEditor";
import { PwaRecoveryRssUpsertEditor } from "./PwaRecoveryRssUpsertEditor";
import { PwaRecoveryAnnotationEditor } from "./PwaRecoveryAnnotationEditor";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseLibraryCoreRecoveryIntentReviewRequestV1, type LibraryCoreRecoveryIntentReviewResponseV1, parseLibraryCoreRecoveryIntentPageRequestV1, type LibraryCoreRecoveryIntentPageResponseV1, parseLibraryCoreRecoveryArchivePageRequestV1, type LibraryCoreRecoveryArchivePageResponseV1, type LibraryCoreConsumerRecoveryStatusV1 } from "@freed/shared/library-core";
import { readPwaConsumerRecoveryStatus, queryPwaNormalizedLibrary } from "../lib/library-core-sqlite-runtime";
import { loadPwaRecoveryAccountRemovalDrafts, loadPwaRecoveryPersonRemovalDrafts, loadPwaRecoveryItemRemovalDrafts, type PwaRecoveryItemRemovalDraft, loadPwaRecoveryRssRemovalDrafts, type PwaRecoveryRssRemovalDraft, loadPwaRecoveryRssTitleDrafts, type PwaRecoveryRssTitleDraft } from "../lib/library-core-pwa-recovery-editors";
import { createPwaRecoveryAccountRemovalAction, createPwaRecoveryPersonRemovalAction, createPwaRecoveryItemRemovalAction, createPwaRecoveryRssRemovalAction, createPwaRecoveryRssTitleAction, createPwaRecoveryAssignmentAction } from "../lib/library-core-pwa-follower-mutations";
import { continuePwaConsumerRecovery } from "../lib/library-core-pwa-consumer-recovery";

export function PwaConsumerRecovery() {
  const [status, setStatus] = useState<LibraryCoreConsumerRecoveryStatusV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), actionPending = useRef(false), mounted = useRef(false);
  const refreshStatus = useCallback(() => {
    const token = ++generation.current;
    return readPwaConsumerRecoveryStatus().then(
      value => {
        if (mounted.current && token === generation.current) { setStatus(value); setError(null); }
      },
      failure => {
        if (mounted.current && token === generation.current) setError(failure instanceof Error ? failure.message : "Recovery status is unavailable.");
      },
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => { mounted.current = false; };
  }, [refreshStatus]);
  async function continueRecovery() {
    if (actionPending.current) return;
    actionPending.current = true; setBusy(true); setError(null);
    const token = ++generation.current;
    try {
      const value = await continuePwaConsumerRecovery();
      if (mounted.current && token === generation.current) { setStatus(value); setError(null); }
    } catch (failure) {
      if (mounted.current && token === generation.current) setError(failure instanceof Error ? failure.message : "Recovery could not continue.");
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!error && (!status || status.state === "none")) return null;
  const following = status?.state === "following";
  const count = status && status.state !== "none" ? status.pendingIntentCount + status.publishedIntentCount : 0;
  return <section className="theme-card-soft rounded-xl p-4" aria-label="Browser recovery">
    <p className="text-sm font-semibold">{!status ? "Browser recovery unavailable" : following ? "Previous edits preserved" : "Your Primary has changed"}</p>
    <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">
      {!status ? "Check this browser’s recovery status again before continuing." : following ? "Your previous edits are archived. They will not be sent automatically." :
        "Enroll this browser with the new Primary to continue editing. Your previous edits will be archived, without sending them again."}
    </p>
    {status && status.state !== "none" && <p className="mt-2 text-xs text-[var(--theme-text-muted)]">
      {count.toLocaleString()} pending or published edits {following ? "preserved" : "to preserve"}.
    </p>}
    {error && <p role="alert" className="theme-feedback-text-danger mt-2 break-words text-xs">{error}</p>}
    {!status && error && <button type="button" onClick={() => void refreshStatus()} className="btn-secondary mt-3 rounded-lg px-3 py-2 text-sm">Check again</button>}
    {!following && status && status.state !== "none" && <button type="button" disabled={busy}
      className="btn-secondary mt-3 w-full rounded-lg px-3 py-2 text-sm disabled:opacity-50"
      onClick={() => void continueRecovery()}>
      {busy ? "Preserving edits" : status.state === "prepared" ? "Continue enrollment" : "Enroll with new Primary"}
    </button>}
    {status && status.state !== "none" && <PwaRecoveryArchives key={`${status.plan.recoveryId}:${status.state}`} allowReapply={following} />}
  </section>;
}

function PwaRecoveryArchives({ allowReapply }: { allowReapply: boolean }) {
  const [page, setPage] = useState<LibraryCoreRecoveryArchivePageResponseV1 | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<string | null>(null);
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  async function load(cursor: string | null) {
    const token = ++generation.current;
    setOpened(true); setBusy(true); setError(null); setPage(null);
    try {
      const request = parseLibraryCoreRecoveryArchivePageRequestV1({ queryId: "recovery_archive_page_v1", schemaVersion: 1,
        cursor, limit: 8, cancellationId: crypto.randomUUID(), readerSessionId: crypto.randomUUID() });
      if (!request.ok) throw new Error(request.error);
      const result = await queryPwaNormalizedLibrary(request.value);
      if (token === generation.current) setPage(result);
    } catch {
      if (token === generation.current) setError("Earlier archives are not available to read right now. Enrollment can continue separately.");
    } finally { if (token === generation.current) setBusy(false); }
  }
  function close() { generation.current += 1; setOpened(false); setPage(null); setError(null); setBusy(false); }
  if (selectedArchive) return <PwaRecoveryIntents key={selectedArchive} recoveryId={selectedArchive} allowReapply={allowReapply} onBack={() => setSelectedArchive(null)} />;
  if (!opened) return <button type="button" className="btn-secondary mt-3 rounded-lg px-3 py-2 text-sm" onClick={() => void load(null)}>View archives</button>;
  return <div className="mt-3 border-t border-[var(--theme-border)] pt-3" aria-label="Previous edit archives">
    <p className="text-xs text-[var(--theme-text-secondary)]">These counts identify preserved work. They do not show whether the Primary accepted it.</p>
    {busy && <p role="status" className="mt-2 text-xs">Loading archives</p>}
    {error && <p role="alert" className="theme-feedback-text-danger mt-2 break-words text-xs">{error}</p>}
    {page && <ul className="mt-2 space-y-2 text-xs">{page.rows.map(row => <li key={row.recoveryId}>
      <button type="button" className="btn-secondary rounded-lg px-3 py-2" onClick={() => { generation.current += 1; setPage(null); setOpened(false); setSelectedArchive(row.recoveryId); }}>View archive ...{row.recoveryId.slice(-8)}</button>
      <p className="text-[var(--theme-text-muted)]">{row.pendingEdits.toLocaleString()} pending, {row.publishedEdits.toLocaleString()} published</p>
    </li>)}</ul>}
    {page?.rows.length === 0 && <p className="mt-2 text-xs">No archives found.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {page?.nextCursor && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(page.nextCursor)}>Next archives</button>}
      <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(null)}>Start again</button>
      <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={close}>Close archives</button>
    </div>
  </div>;
}

/** Metadata only until original signatures and outcome evidence have been verified. */
function PwaRecoveryIntents({ recoveryId, onBack, allowReapply }: { recoveryId: string; onBack: () => void; allowReapply: boolean }) {
  const [page, setPage] = useState<LibraryCoreRecoveryIntentPageResponseV1 | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  async function load(cursor: string | null) {
    const token = ++generation.current;
    setBusy(true); setError(null); setPage(null);
    try {
      const request = parseLibraryCoreRecoveryIntentPageRequestV1({ queryId: "recovery_intent_page_v1", schemaVersion: 1,
        recoveryId, cursor, limit: 8, cancellationId: crypto.randomUUID(), readerSessionId: crypto.randomUUID() });
      if (!request.ok) throw new Error(request.error);
      const result = await queryPwaNormalizedLibrary(request.value);
      if (token === generation.current) setPage(result);
    } catch (failure) {
      if (token === generation.current) setError(failure instanceof Error ? failure.message : "Preserved edits could not be loaded.");
    } finally { if (token === generation.current) setBusy(false); }
  }
  if (transactionId) return <PwaRecoveryReview key={transactionId} recoveryId={recoveryId} transactionId={transactionId} allowReapply={allowReapply} onBack={() => setTransactionId(null)} />;
  return <div className="mt-3 border-t border-[var(--theme-border)] pt-3" aria-label="Preserved edit identities">
    <p className="text-xs font-semibold">Archive ...{recoveryId.slice(-8)}</p>
    <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">Select a preserved edit to verify its original signature and check for acceptance or rejection evidence. No edits will be sent.</p>
    {busy && <p role="status" className="mt-2 text-xs">Loading preserved edits</p>}
    {error && <p role="alert" className="theme-feedback-text-danger mt-2 break-words text-xs">{error}</p>}
    {page && <ul className="mt-2 space-y-2 text-xs">{page.rows.map(row => <li key={row.transactionId}><button type="button" className="btn-secondary rounded-lg px-3 py-2" onClick={() => { generation.current += 1; setPage(null); setTransactionId(row.transactionId); }}>Review edit ...{row.transactionId.slice(-8)}</button></li>)}</ul>}
    {page?.rows.length === 0 && <p className="mt-2 text-xs">No preserved transactions found.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {page?.nextCursor && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(page.nextCursor)}>Next edits</button>}
      <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(null)}>{page ? "Start again" : "Load preserved edits"}</button>
      <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { generation.current += 1; onBack(); }}>Back to archives</button>
    </div>
  </div>;
}

function PwaRecoveryReview({ recoveryId, transactionId, onBack, allowReapply }: { recoveryId: string; transactionId: string; onBack: () => void; allowReapply: boolean }) {
  const [page, setPage] = useState<LibraryCoreRecoveryIntentReviewResponseV1 | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reviewed = useRef({ count: 0, eligible: true, rss: true, accounts: true, persons: true, subscriptions: true, removal: true, items: true, people: true, accountRemoval: true, reachOuts: true, accountRecords: true, annotations: true, source: "" });
  const action = useRef<ReturnType<typeof createPwaRecoveryAssignmentAction> | null>(null);
  const actionPending = useRef(false);
  const [applied, setApplied] = useState(false), [retry, setRetry] = useState(false);
  const [complete, setComplete] = useState(false);
  const [rssComplete, setRssComplete] = useState(false), [rssOpened, setRssOpened] = useState(false);
  const [annotationsComplete, setAnnotationsComplete] = useState(false), [annotationsOpened, setAnnotationsOpened] = useState(false);
  const [accountsComplete, setAccountsComplete] = useState(false), [accountsOpened, setAccountsOpened] = useState(false);
  const [friendsOpened, setFriendsOpened] = useState(false);
  const [personsComplete, setPersonsComplete] = useState(false), [personsOpened, setPersonsOpened] = useState(false);
  const [subscriptionsComplete, setSubscriptionsComplete] = useState(false), [subscriptionsOpened, setSubscriptionsOpened] = useState(false);
  const [itemsComplete, setItemsComplete] = useState(false);
  const [reachOutsComplete, setReachOutsComplete] = useState(false), [reachOutsOpened, setReachOutsOpened] = useState(false);
  const [accountRecordsComplete, setAccountRecordsComplete] = useState(false), [accountRecordsOpened, setAccountRecordsOpened] = useState(false);
  const [accountRemovalComplete, setAccountRemovalComplete] = useState(false);
  const [peopleComplete, setPeopleComplete] = useState(false);
  const [removalComplete, setRemovalComplete] = useState(false), [rssMode, setRssMode] = useState<"title" | "remove" | "items" | "people" | "accounts">("title");
  const replaced = useCallback(() => { setApplied(true); setPersonsOpened(false); setAccountsOpened(false); setSubscriptionsOpened(false); setRssOpened(false); setAnnotationsOpened(false); }, []);
  useEffect(() => () => { generation.current += 1; }, []);
  async function load(cursor: string | null) {
    if (actionPending.current) return;
    if (cursor === null) { reviewed.current = { count: 0, eligible: true, rss: true, accounts: true, persons: true, subscriptions: true, removal: true, items: true, people: true, accountRemoval: true, reachOuts: true, accountRecords: true, annotations: true, source: "" }; action.current = null; setRetry(false); }
    setReachOutsComplete(false); setReachOutsOpened(false); setFriendsOpened(false); setPersonsComplete(false); setPersonsOpened(false); setAccountRecordsComplete(false); setAccountRecordsOpened(false); setPeopleComplete(false); setAccountRemovalComplete(false); setAccountsComplete(false); setAccountsOpened(false); setSubscriptionsComplete(false); setSubscriptionsOpened(false); setComplete(false); setRssComplete(false); setRssOpened(false); setAnnotationsComplete(false); setAnnotationsOpened(false); setRemovalComplete(false); setItemsComplete(false);
    const token = ++generation.current;
    setBusy(true); setError(null); setPage(null);
    try {
      const request = parseLibraryCoreRecoveryIntentReviewRequestV1({ queryId: "recovery_intent_review_v1", schemaVersion: 1,
        recoveryId, transactionId, cursor, limit: 8, cancellationId: crypto.randomUUID(), readerSessionId: crypto.randomUUID() });
      if (!request.ok) throw new Error(request.error);
      const result = await queryPwaNormalizedLibrary(request.value);
      if (token === generation.current) {
        const source = JSON.stringify([result.archiveDigest, result.transactionDigest, result.source]);
        const previous = reviewed.current;
        if (previous.count > 0 && previous.source !== source) throw new Error("The Library changed. Verify this edit again.");
        for (const row of result.rows) {
          if (row.memberIndex !== previous.count) throw new Error("Review every change before applying this edit again.");
          previous.count += 1;
          previous.reachOuts &&= row.operationType === "person_reach_out_append";
          previous.accountRecords &&= row.operationType === "account_upsert";
          previous.accountRemoval &&= row.operationType === "account_remove";
          previous.people &&= row.operationType === "person_remove_and_accounts";
          previous.items &&= row.operationType === "feed_item_remove";
          previous.removal &&= ["rss_feed_remove_keep_items", "rss_feed_remove_with_items"].includes(row.operationType);
          previous.annotations &&= row.operationType === "feed_item_annotations_replace" && row.itemPresent === true;
          previous.accounts &&= row.operationType === "account_person_assignment";
          previous.persons &&= row.operationType === "person_upsert";
          previous.subscriptions &&= row.operationType === "rss_feed_upsert";
          previous.rss &&= row.operationType === "rss_feed_title_assignment";
          previous.eligible &&= row.itemPresent === true && ["feed_item_read_assignment", "feed_item_saved_assignment", "feed_item_archive_assignment", "feed_item_like_assignment"].includes(row.operationType);
        }
        previous.source = source;
        setComplete(previous.eligible && previous.count === result.memberCount && result.nextCursor === null);
        setAnnotationsComplete(previous.annotations && previous.count === result.memberCount && result.nextCursor === null);
        setItemsComplete(previous.items && previous.count === result.memberCount && result.nextCursor === null);
        setReachOutsComplete(previous.reachOuts && previous.count === result.memberCount && result.nextCursor === null);
        setAccountRecordsComplete(previous.accountRecords && previous.count === result.memberCount && result.nextCursor === null);
        setAccountRemovalComplete(previous.accountRemoval && previous.count === result.memberCount && result.nextCursor === null);
        setPeopleComplete(previous.people && previous.count === result.memberCount && result.nextCursor === null);
        setRemovalComplete(previous.removal && previous.count === result.memberCount && result.nextCursor === null);
        setAccountsComplete(previous.accounts && previous.count === result.memberCount && result.nextCursor === null);
        setPersonsComplete(previous.persons && previous.count === result.memberCount && result.nextCursor === null);
        setSubscriptionsComplete(previous.subscriptions && previous.count === result.memberCount && result.nextCursor === null);
        setRssComplete(previous.rss && previous.count === result.memberCount && result.nextCursor === null);
        setPage(result);
      }
    } catch (failure) {
      if (token === generation.current) setError(failure instanceof Error ? failure.message : "This edit could not be verified.");
    } finally { if (token === generation.current) setBusy(false); }
  }
  async function applyAgain() {
    if (!page || actionPending.current) return;
    actionPending.current = true;
    const token = ++generation.current;
    setBusy(true); setError(null);
    action.current ??= createPwaRecoveryAssignmentAction(page);
    try {
      await action.current();
      if (token === generation.current) { setApplied(true); setRetry(false); }
    } catch (failure) {
      if (token === generation.current) { setRetry(true); setError(failure instanceof Error ? failure.message : "Replacement could not be confirmed."); }
    } finally {
      actionPending.current = false;
      if (token === generation.current) setBusy(false);
    }
  }
  const outcome = page?.outcome;
  const canApply = allowReapply && complete && outcome?.state !== "confirmed_accepted" && !page?.replacement && !applied;
  return <div className="mt-3 border-t border-[var(--theme-border)] pt-3" aria-label="Verified edit review">
    <p className="text-xs font-semibold">Edit ...{transactionId.slice(-8)}</p>
    {busy && <p role="status" className="mt-2 text-xs">Verifying preserved edit</p>}
    {error && <p role="alert" className="theme-feedback-text-danger mt-2 break-words text-xs">{error}</p>}
    {outcome && <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">{outcome.state === "confirmed_accepted" ?
      "Canonical receipts confirm that the Primary accepted this edit." : outcome.state === "reported_rejected" ?
      "The original Primary signed a rejection of this edit." : "Its outcome is unresolved. Missing acceptance evidence does not mean this edit failed."}</p>}
    {page?.replacement && <p className="mt-2 text-xs">A replacement edit was already preserved. This does not confirm its acceptance.</p>}
    {page && <>
      <p className="mt-2 text-xs">{page.memberCount.toLocaleString()} changes in this preserved edit.</p>
      <ul className="mt-2 space-y-2 text-xs">{page.rows.map(row => <li key={row.memberIndex}>
        <p>{row.operationType === "feed_item_read_assignment" ? "Marked as read" :
          row.operationType === "feed_item_saved_assignment" ? row.assigned ? "Saved" : "Unsaved" :
          row.operationType === "feed_item_archive_assignment" ? row.assigned ? "Archived" : "Unarchived" :
          row.operationType === "feed_item_like_assignment" ? row.assigned ? "Liked" : "Unliked" :
          row.operationType === "person_remove_and_accounts" ? "Delete person and linked accounts" : row.operationType === "feed_item_remove" ? "Delete item from Library" : "Preserved change"} · ...{row.entityId.slice(-8)}</p>
        {row.personState && <p className="text-[var(--theme-text-muted)]">{row.personState === "deleted" ? "Person was deleted. Recovery cannot recreate it." : row.personState === "absent" ? "Person is currently absent. This does not prove whether the original edit was accepted." : "Person is currently present."}</p>}
        {row.authorName && <p className="break-words text-[var(--theme-text-muted)]">{row.authorName}</p>}
        {row.itemText && <p className="break-words text-[var(--theme-text-muted)]">{row.itemText}</p>}
        {row.itemPresent === false && <p className="text-[var(--theme-text-muted)]">This item is no longer in the current Library.</p>}
      </li>)}</ul>
    </>}
    {applied && <p role="status" className="mt-2 text-xs">Replacement preserved for the new Primary. This does not confirm acceptance.</p>}
    {canApply && <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">Applying again creates a new edit and may override later changes. An unresolved original may already have been accepted.</p>}
    {page && page.rows[0]?.operationType !== "friend_replace" && !complete && !accountsComplete && !personsComplete && !subscriptionsComplete && !rssComplete && !annotationsComplete && !removalComplete && !peopleComplete && !accountRemovalComplete && !reachOutsComplete && !accountRecordsComplete && !itemsComplete && !page.nextCursor && !applied && <p className="mt-2 text-xs text-[var(--theme-text-muted)]">Other edit types need their original editors. Missing items cannot be reapplied here.</p>}
    {!allowReapply && <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">You can review earlier archives now. Finish enrollment with the new Primary before applying edits again.</p>}
    {page && annotationsOpened && !applied && <PwaRecoveryAnnotationEditor review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && accountsOpened && !applied && <PwaRecoveryAccountLinkEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && friendsOpened && !applied && <PwaRecoveryFriendEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && reachOutsOpened && !applied && <PwaRecoveryReachOutEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && accountRecordsOpened && !applied && <PwaRecoveryAccountEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && personsOpened && !applied && <PwaRecoveryPersonEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && subscriptionsOpened && !applied && <PwaRecoveryRssUpsertEditor key={page.transactionDigest} review={page} onReplacement={replaced} onMutating={setBusy} />}
    {page && rssOpened && !applied && <PwaRecoveryTargetEditor key={rssMode} mode={rssMode} review={page} onReplacement={replaced} onMutating={setBusy} />}
    <p className="mt-2 text-xs text-[var(--theme-text-muted)]">Reviewing an edit does not send it again.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {allowReapply && page?.memberCount === 1 && page.rows.length === 1 && page.rows[0]?.operationType === "friend_replace" && !friendsOpened && !applied && !page.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setFriendsOpened(true)}>Review Friend and accounts</button>}
      {allowReapply && annotationsComplete && !annotationsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setAnnotationsOpened(true)}>Review annotations</button>}
      {allowReapply && accountsComplete && !accountsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setAccountsOpened(true)}>Review account links</button>}
      {allowReapply && personsComplete && !personsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setPersonsOpened(true)}>Review people</button>}
      {allowReapply && subscriptionsComplete && !subscriptionsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setSubscriptionsOpened(true)}>Review subscription settings</button>}
      {allowReapply && reachOutsComplete && !reachOutsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setReachOutsOpened(true)}>Review reach-out history</button>}
      {allowReapply && accountRecordsComplete && !accountRecordsOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => setAccountRecordsOpened(true)}>Review account details</button>}
      {allowReapply && accountRemovalComplete && !rssOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { setRssMode("accounts"); setRssOpened(true); }}>Review account deletion</button>}
      {allowReapply && peopleComplete && !rssOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { setRssMode("people"); setRssOpened(true); }}>Review people deletion</button>}
      {allowReapply && itemsComplete && !rssOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { setRssMode("items"); setRssOpened(true); }}>Review item deletion</button>}
      {allowReapply && removalComplete && !rssOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { setRssMode("remove"); setRssOpened(true); }}>Review unsubscribe</button>}
      {allowReapply && rssComplete && !rssOpened && !applied && !page?.replacement && outcome?.state !== "confirmed_accepted" && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { setRssMode("title"); setRssOpened(true); }}>Review feed names</button>}
      {canApply && <button type="button" disabled={busy} className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50" onClick={() => void applyAgain()}>{retry ? "Retry same replacement" : "Apply again"}</button>}
      {page?.nextCursor && <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(page.nextCursor)}>Next changes</button>}
      <button type="button" disabled={busy} className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => void load(null)}>{page ? "Verify again" : "Verify preserved edit"}</button>
      <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={() => { generation.current += 1; onBack(); }}>Back to edits</button>
    </div>
  </div>;
}

type RecoveryTargetDrafts = { kind: "title"; rows: readonly PwaRecoveryRssTitleDraft[] } | { kind: "remove"; rows: readonly PwaRecoveryRssRemovalDraft[] } | { kind: "items" | "people" | "accounts"; rows: readonly PwaRecoveryItemRemovalDraft[] };

/** Display eight targets at a time and preserve one complete transaction draft. */
function PwaRecoveryTargetEditor({ review, mode, onReplacement, onMutating }: {
  review: LibraryCoreRecoveryIntentReviewResponseV1; mode: "title" | "remove" | "items" | "people" | "accounts";
  onReplacement: () => void; onMutating: (busy: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<RecoveryTargetDrafts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0), [seen, setSeen] = useState(0);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(false), pending = useRef(false);
  const action = useRef<ReturnType<typeof createPwaRecoveryRssTitleAction> | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    async function load() {
      const result = mode === "accounts" ? await loadPwaRecoveryAccountRemovalDrafts(review, controller.signal) : mode === "people" ? await loadPwaRecoveryPersonRemovalDrafts(review, controller.signal) : mode === "title" ? await loadPwaRecoveryRssTitleDrafts(review, controller.signal) : mode === "items" ? await loadPwaRecoveryItemRemovalDrafts(review, controller.signal) : await loadPwaRecoveryRssRemovalDrafts(review, controller.signal);
      if (controller.signal.aborted) return;
      if (result.replacement) onReplacement();
      else {
        // The selected loader fixes the row type for this mounted editor.
        setDrafts(mode === "title" ? { kind: "title", rows: result.drafts as readonly PwaRecoveryRssTitleDraft[] } : (mode === "items" || mode === "people" || mode === "accounts") ? { kind: mode, rows: result.drafts as readonly PwaRecoveryItemRemovalDraft[] } : { kind: "remove", rows: result.drafts as readonly PwaRecoveryRssRemovalDraft[] });
        setSeen(Math.min(8, result.drafts.length));
      }
    }
    void load().catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Targets could not be verified."); });
    return () => { alive.current = false; controller.abort(); };
  }, [review, mode, onReplacement]);
  const requiresDeletionConfirmation = drafts?.kind === "accounts" || drafts?.kind === "people" || drafts?.kind === "items" || drafts?.kind === "remove" && drafts.rows.some(row => row.includeItems);
  async function submit() {
    if (!drafts || pending.current || seen < drafts.rows.length || (requiresDeletionConfirmation && !confirmed)) return;
    pending.current = true; setSaving(true); setError(null); onMutating(true);
    try {
      action.current ??= drafts.kind === "accounts" ? createPwaRecoveryAccountRemovalAction(review, confirmed) : drafts.kind === "people" ? createPwaRecoveryPersonRemovalAction(review, confirmed) : drafts.kind === "title" ? createPwaRecoveryRssTitleAction(review, drafts.rows) : drafts.kind === "items" ? createPwaRecoveryItemRemovalAction(review, confirmed) : createPwaRecoveryRssRemovalAction(review, confirmed);
      setLocked(true);
      await action.current();
      if (alive.current) onReplacement();
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Replacement could not be confirmed.");
    } finally {
      pending.current = false;
      if (alive.current) { setSaving(false); onMutating(false); }
    }
  }
  return <div className="mt-3 space-y-2 text-xs" aria-label={mode === "accounts" ? "Recover account deletion" : mode === "people" ? "Recover people deletion" : mode === "title" ? "Recover feed names" : mode === "items" ? "Recover item deletion" : "Recover unsubscribe"}>
    <p>{mode === "accounts" ? "This removes only the original accounts from the Library, including their current links and account details. It does not delete the linked people or accounts at their providers. An absent account does not prove the original edit was accepted." : mode === "people" ? "This deletes the original people and accounts linked to them when the Primary accepts the edit, including links added since this review. It also removes their notes and reach-out history. An absent person does not prove that the original edit was accepted." : mode === "title" ? "Review every name. This may override newer or queued names. The last-synced name does not include pending edits. No feed URLs are fetched." : mode === "items" ? "Review every original item before deleting it again. Later additions to the Library are not included. An absent item does not prove the original edit was accepted." :
      "Review every subscription before creating a new unsubscribe. If accepted, the Primary will stop future polling for these feeds. This review does not fetch their URLs."}</p>
    {requiresDeletionConfirmation && mode === "remove" && <p>This also deletes all articles and reading history for these feeds, including articles added since the original edit or before acceptance. This cannot be undone here.</p>}
    {error && <p role="alert" className="theme-feedback-text-danger break-words">{error}</p>}
    {!drafts && !error && <p role="status">Loading verified targets</p>}
    {drafts?.kind === "title" && drafts.rows.slice(offset, offset + 8).map((row, n) => <label key={offset + n} className="block space-y-1">
      <span className="block break-all">{row.url}</span>
      <span className="block break-words">Archived: {row.archivedTitle}</span>
      <span className="block break-words">Last synced: {row.currentTitle}</span>
      <input aria-label={`Feed name ${(offset + n + 1).toLocaleString()}`} value={row.title} maxLength={4096} disabled={locked || saving}
        className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2"
        onChange={event => setDrafts(current => current?.kind === "title" ? { ...current, rows: current.rows.map((value, index) => index === offset + n ? { ...value, title: event.target.value } : value) } : current)} />
    </label>)}
    {drafts?.kind === "remove" && <ul className="space-y-2">{drafts.rows.slice(offset, offset + 8).map((row, n) => <li key={offset + n}>
      <p className="break-words">{row.title}</p><p className="break-all">{row.url}</p>
      <p>{row.includeItems ? "Unsubscribe and delete articles and reading history" : "Unsubscribe and keep articles and reading history"}</p>
    </li>)}</ul>}
    {(drafts?.kind === "items" || drafts?.kind === "people" || drafts?.kind === "accounts") && <ul className="space-y-2">{drafts.rows.slice(offset, offset + 8).map((row, n) => <li key={offset + n} className="break-words">
      {row.label} (...{row.entityId.slice(-8)}){!row.present && <p>Currently absent. This target remains in the deletion.</p>}
    </li>)}</ul>}
    {requiresDeletionConfirmation && <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={locked || saving} onChange={event => setConfirmed(event.target.checked)} />
      <span>{mode === "accounts" ? "Delete these original accounts from the Library, including account details and links changed before Primary acceptance." : mode === "people" ? "Delete these original people, their notes and reach-out history, and accounts linked to them at Primary acceptance." : mode === "items" ? "Delete these original items and their current annotations, including changes made before Primary acceptance." : "I confirm deletion of all articles and reading history for these feeds."}</span></label>}
    {drafts && <div className="flex flex-wrap gap-2">
      {offset > 0 && <button type="button" disabled={saving} className="btn-secondary rounded-lg px-3 py-2" onClick={() => setOffset(offset - 8)}>{mode === "accounts" ? "Previous accounts" : mode === "people" ? "Previous people" : mode === "title" ? "Previous names" : mode === "items" ? "Previous items" : "Previous feeds"}</button>}
      {offset + 8 < drafts.rows.length && <button type="button" disabled={saving} className="btn-secondary rounded-lg px-3 py-2" onClick={() => { setOffset(offset + 8); setSeen(Math.max(seen, Math.min(offset + 16, drafts.rows.length))); }}>{mode === "accounts" ? "Next accounts" : mode === "people" ? "Next people" : mode === "title" ? "Next names" : mode === "items" ? "Next items" : "Next feeds"}</button>}
      <button type="button" disabled={saving || seen < drafts.rows.length || (requiresDeletionConfirmation && !confirmed)} className="btn-primary rounded-lg px-3 py-2 disabled:opacity-50" onClick={() => void submit()}>{mode === "accounts" ? locked ? "Retry same deletion" : "Store account deletion" : mode === "people" ? locked ? "Retry same deletion" : "Store people deletion" : mode === "title" ? locked ? "Retry same names" : "Store revised names" : mode === "items" ? locked ? "Retry same deletion" : "Store item deletion" : locked ? "Retry same unsubscribe" : "Store unsubscribe"}</button>
    </div>}
  </div>;
}
