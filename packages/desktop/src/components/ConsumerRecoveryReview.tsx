import { ConsumerRecoveryReachOutEditor } from "./ConsumerRecoveryReachOutEditor";
import { ConsumerRecoveryAccountEditor } from "./ConsumerRecoveryAccountEditor";
import { ConsumerRecoveryFriendEditor } from "./ConsumerRecoveryFriendEditor";
import { ConsumerRecoveryPersonEditor } from "./ConsumerRecoveryPersonEditor";
import { ConsumerRecoveryAccountLinkEditor } from "./ConsumerRecoveryAccountLinkEditor";
import { ConsumerRecoveryRssUpsertEditor } from "./ConsumerRecoveryRssUpsertEditor";
import { ConsumerRecoveryItemRemovalEditor } from "./ConsumerRecoveryItemRemovalEditor";
import { ConsumerRecoveryAnnotationEditor } from "./ConsumerRecoveryAnnotationEditor";
import { ConsumerRecoveryRssEditor } from "./ConsumerRecoveryRssEditor";
import { useEffect, useRef, useState } from "react";
import type {
  LibraryCoreRecoveryArchivePageResponseV1,
  LibraryCoreRecoveryIntentPageResponseV1,
  LibraryCoreRecoveryIntentReviewResponseV1,
} from "@freed/shared/library-core";
import { createDesktopLibraryCoreOperationId, queryNormalizedLibrary } from "../lib/library-core-normalized-query-client";
import { reapplyArchivedAssignments, type RecoveryReissueReceipt } from "../lib/library-core-recovery-reissue";

type Edit = LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
function describeEdit(edit: Edit): string {
  switch (edit.operationType) {
    case "account_person_assignment": return "Change account link";
    case "friend_replace": return "Replace Friend and account selection";
    case "person_upsert": return "Replace person details";
    case "person_remove_and_accounts": return "Delete person and linked accounts";
    case "feed_item_remove": return "Delete item from Library";
    case "feed_item_annotations_replace": return "Replace notes, highlights and tags";
    case "rss_feed_remove_keep_items": return "Unsubscribe and keep articles";
    case "rss_feed_remove_with_items": return "Unsubscribe and remove articles";
    case "rss_feed_upsert": return "Replace RSS subscription settings";
    case "rss_feed_title_assignment": return "Rename RSS feed";
    case "feed_item_read_assignment": return "Mark as read";
    case "feed_item_saved_assignment": return edit.assigned ? "Save item and remove it from Archive" : "Remove item from Saved";
    case "feed_item_archive_assignment": return edit.assigned ? "Archive item and remove it from Saved" : "Remove item from Archive";
    case "feed_item_like_assignment": return edit.assigned ? "Mark as liked" : "Remove like";
    default: return "Other Library edit";
  }
}
function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("QUERY_DEADLINE")) return "Review took too long. Start again to retry.";
  if (message.includes("QUERY_CAPACITY")) return "The Library is busy. Try reviewing again shortly.";
  return message.includes("CURSOR_STALE")
    ? "The Library changed during review. Start again to read its current state."
    : "This archive could not be verified. Your stored edits remain preserved.";
}

/** Keep one archive page and one verified transaction page in renderer memory. */
export function ConsumerRecoveryReview({ recoveryId: currentRecoveryId = null, readOnly = false }: {
  recoveryId?: string | null;
  readOnly?: boolean;
}) {
  const [recoveryId, setRecoveryId] = useState(currentRecoveryId);
  const [archives, setArchives] = useState<LibraryCoreRecoveryArchivePageResponseV1 | null>(null);
  const [page, setPage] = useState<LibraryCoreRecoveryIntentPageResponseV1 | null>(null);
  const [review, setReview] = useState<LibraryCoreRecoveryIntentReviewResponseV1 | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<RecoveryReissueReceipt | null>(null);
  const [applying, setApplying] = useState(false);
  const [editingOriginal, setEditingOriginal] = useState(false);
  const coverage = useRef({ count: 0, eligible: false, identity: "", cursor: null as string | null });
  const generation = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current += 1;
    activeRead.current?.abort();
    setRecoveryId(currentRecoveryId); setArchives(null);
    setPage(null); setReview(null); setOpened(false); setBusy(false); setError(null); setReplacement(null); setApplying(false);
    setEditingOriginal(false);
    coverage.current = { count: 0, eligible: false, identity: "", cursor: null };
    return () => { generation.current += 1; activeRead.current?.abort(); };
  }, [currentRecoveryId, readOnly]);

  const loadPage = async (cursor: string | null = null, selectedId = recoveryId) => {
    if (selectedId === null) return loadArchives();
    setRecoveryId(selectedId); setArchives(null);
    const owner = ++generation.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setOpened(true); setBusy(true); setReview(null); setPage(null); setError(null); setReplacement(null);
    setEditingOriginal(false);
    coverage.current = { count: 0, eligible: false, identity: "", cursor: null };
    try {
      const response = await queryNormalizedLibrary({
        queryId: "recovery_intent_page_v1", schemaVersion: 1, recoveryId: selectedId, cursor, limit: 16,
        cancellationId: createDesktopLibraryCoreOperationId("recovery-page-cancel"),
        readerSessionId: createDesktopLibraryCoreOperationId("recovery-page-reader"),
      }, controller.signal);
      if (generation.current === owner) setPage(response);
    } catch (error) {
      if (generation.current === owner) setError(failureMessage(error));
    } finally {
      if (generation.current === owner) setBusy(false);
    }
  };
  const loadArchives = async (cursor: string | null = null) => {
    const owner = ++generation.current;
    activeRead.current?.abort();
    const controller = new AbortController(); activeRead.current = controller;
    setOpened(true); setBusy(true); setError(null); setArchives(null); setPage(null); setReview(null); setReplacement(null);
    setEditingOriginal(false);
    coverage.current = { count: 0, eligible: false, identity: "", cursor: null };
    try {
      const response = await queryNormalizedLibrary({ queryId: "recovery_archive_page_v1", schemaVersion: 1,
        cursor, limit: 16, cancellationId: createDesktopLibraryCoreOperationId("archive-list-cancel"),
        readerSessionId: createDesktopLibraryCoreOperationId("archive-list-reader") }, controller.signal);
      if (generation.current === owner) setArchives(response);
    } catch (error) {
      if (generation.current === owner) setError(failureMessage(error));
    } finally { if (generation.current === owner) setBusy(false); }
  };
  const loadReview = async (transactionId: string, cursor: string | null = null) => {
    if (recoveryId === null) return;
    const owner = ++generation.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setEditingOriginal(false);
    setBusy(true); setError(null); setReview(null); setReplacement(null);
    try {
      const response = await queryNormalizedLibrary({
        queryId: "recovery_intent_review_v1", schemaVersion: 1, recoveryId, transactionId, cursor, limit: 8,
        cancellationId: createDesktopLibraryCoreOperationId("recovery-review-cancel"),
        readerSessionId: createDesktopLibraryCoreOperationId("recovery-review-reader"),
      }, controller.signal);
      if (generation.current === owner) {
        const identity = JSON.stringify([response.transactionId, response.transactionDigest, response.archiveDigest, response.source]);
        const previous = coverage.current;
        const continued = cursor !== null && previous.cursor === cursor && previous.identity === identity;
        const start = continued ? previous.count : 0;
        const eligible = (cursor === null || continued && previous.eligible) && response.rows.every((edit, index) =>
          edit.memberIndex === start + index && edit.itemPresent === true &&
          ["feed_item_read_assignment", "feed_item_saved_assignment", "feed_item_archive_assignment", "feed_item_like_assignment"].includes(edit.operationType));
        coverage.current = { count: start + response.rows.length, eligible, identity, cursor: response.nextCursor };
        setReplacement(response.replacement);
        setReview(response);
      }
    } catch (error) {
      if (generation.current === owner) setError(failureMessage(error));
    } finally {
      if (generation.current === owner) setBusy(false);
    }
  };
  const close = () => {
    if (applying) return;
    generation.current += 1;
    activeRead.current?.abort();
    activeRead.current = null;
    setEditingOriginal(false);
    setArchives(null); setOpened(false); setPage(null); setReview(null); setBusy(false); setError(null);
  };
  const applyAgain = async () => {
    if (readOnly || !review || applying || replacement || !coverage.current.eligible || coverage.current.count !== review.memberCount) return;
    const owner = generation.current;
    setApplying(true); setError(null);
    try {
      const receipt = await reapplyArchivedAssignments(review);
      if (generation.current === owner) setReplacement(receipt);
    } catch (error) {
      if (generation.current === owner) setError(String(error).includes("RECOVERY_REVIEW_STALE")
        ? "The Library changed. Start again to review it before applying."
        : "No replacement was confirmed. Your archived edit is preserved. Retrying checks for an existing replacement first.");
    } finally {
      if (generation.current === owner) setApplying(false);
    }
  };
  return <div className="mt-3" data-testid="consumer-recovery-review">
    <button type="button" className="btn-secondary mr-2 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy || applying} onClick={() => void loadArchives()}>Browse recovery archives</button>
    {readOnly && <p className="mb-2 text-xs">Archived edits remain available for review. Applying them again is unavailable in this installation's current role.</p>}
    {!opened ? currentRecoveryId && <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs" onClick={() => void loadPage()}>
      Review archived edits
    </button> : <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy || applying} onClick={() => void loadPage()}>Start again</button>
        <button type="button" disabled={applying} className="btn-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" onClick={close}>Close review</button>
      </div>
      {busy && <p role="status" className="mt-2">Verifying archived edits...</p>}
      {error && <p role="alert" className="theme-feedback-text-danger mt-2">{error}</p>}
      {archives && <>
        <p className="mt-2 text-xs">Archives preserve edits from previous transfers. Counts describe stored edits, not Primary acceptance.</p>
        <ul className="mt-2 space-y-2">{archives.rows.map((archive) => <li key={archive.recoveryId}>
          <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-xs" onClick={() => void loadPage(null, archive.recoveryId)}>
            Review archive ...{archive.recoveryId.slice(-8)}
          </button>
          <p className="text-xs">Epoch ...{archive.predecessorEpochId.slice(-8)} to ...{archive.successorEpochId.slice(-8)}. {archive.pendingEdits.toLocaleString()} pending, {archive.publishedEdits.toLocaleString()} published.</p>
        </li>)}</ul>
        {archives.rows.length === 0 && <p className="mt-2">No recovery archives found.</p>}
        {archives.nextCursor && <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" onClick={() => void loadArchives(archives.nextCursor)}>Next recovery archives</button>}
      </>}
      {page && <>
        {page.rows.length === 0 ? <p className="mt-2">No archived edits in this recovery.</p> : <ul className="mt-2 space-y-1">
          {page.rows.map((row) => <li key={row.transactionId}>
            <button type="button" disabled={busy || applying} onClick={() => void loadReview(row.transactionId)}
              className="w-full rounded px-2 py-1 text-left hover:bg-[var(--theme-bg-elevated)] disabled:opacity-50">
              Review edit ...{row.transactionId.slice(-8)}
            </button>
          </li>)}
        </ul>}
        {page.nextCursor && <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy || applying} onClick={() => void loadPage(page.nextCursor)}>Next archived edits</button>}
      </>}
      {review && <div className="mt-3 rounded-lg border border-[var(--theme-border-subtle)] p-3" data-testid="consumer-recovery-detail">
        <p className="font-semibold">Edit ...{review.transactionId.slice(-8)}: {review.memberCount.toLocaleString()} {review.memberCount === 1 ? "change" : "changes"}</p>
        <p role="status" className="mt-2">
          {review.outcome.state === "confirmed_accepted" ? "Acceptance confirmed in the Library."
            : review.outcome.state === "reported_rejected" ? "The previous Primary reported a rejection."
            : "The original outcome has not been established."}
        </p>
        <ul className="mt-2 space-y-2">
          {review.rows.map((edit) => <li key={edit.memberIndex}>
            <p>{describeEdit(edit)} <span className="break-all">(...{edit.entityId.slice(-8)})</span></p>
            {edit.personState && <p className="mt-1 text-[var(--theme-text-muted)]">{edit.personState === "deleted" ? "Person was deleted. Recovery cannot recreate it." : edit.personState === "absent" ? "Person is currently absent. This does not prove whether the original edit was accepted." : "Person is currently present."}</p>}
            {edit.itemPresent === false ? <p className="mt-1 text-[var(--theme-text-muted)]">Item no longer available in this Library.</p>
              : edit.itemPresent === true ? <p className="mt-1 break-words text-[var(--theme-text-muted)]">
                Current item: {edit.authorName && <span>{edit.authorName}: </span>}{edit.itemText || "No text available locally."}
              </p> : <p className="mt-1 text-[var(--theme-text-muted)]">Review this edit in its original editor.</p>}
          </li>)}
        </ul>
        <p className="mt-2">Reviewing does not resend or change an edit.</p>
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.memberCount === 1 && review.rows.length === 1 && review.rows[0]?.operationType === "friend_replace" && (
          editingOriginal ? <ConsumerRecoveryFriendEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review Friend and accounts</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every(row => row.operationType === "person_upsert") && (
          editingOriginal ? <ConsumerRecoveryPersonEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review people</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every(row => row.operationType === "account_person_assignment") && (
          editingOriginal ? <ConsumerRecoveryAccountLinkEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review account links</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every((row) => row.operationType === "rss_feed_upsert") && (
          editingOriginal ? <ConsumerRecoveryRssUpsertEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review subscription settings</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every(row => row.operationType === "person_reach_out_append") && (
          editingOriginal ? <ConsumerRecoveryReachOutEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review reach-out history</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every(row => row.operationType === "account_upsert") && (
          editingOriginal ? <ConsumerRecoveryAccountEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review account details</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every(row => row.operationType === "account_remove") && (
          editingOriginal ? <ConsumerRecoveryItemRemovalEditor key={review.transactionDigest} mode="accounts" review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review account deletion</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every((row) => row.operationType === "person_remove_and_accounts") && (
          editingOriginal ? <ConsumerRecoveryItemRemovalEditor key={review.transactionDigest} mode="people" review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review people deletion</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every((row) => row.operationType === "feed_item_remove") && (
          editingOriginal ? <ConsumerRecoveryItemRemovalEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review item deletion</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.length > 0 && review.rows.every((row) => ["rss_feed_remove_keep_items", "rss_feed_remove_with_items"].includes(row.operationType)) && (
          editingOriginal ? <ConsumerRecoveryRssEditor key={review.transactionDigest} mode="remove" review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review unsubscribe</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.every((row) => row.operationType === "rss_feed_title_assignment") && (
          editingOriginal ? <ConsumerRecoveryRssEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review feed names</button>
        )}
        {!readOnly && !replacement && review.outcome.state !== "confirmed_accepted" && review.rows.every((row) => row.operationType === "feed_item_annotations_replace") && (
          editingOriginal ? <ConsumerRecoveryAnnotationEditor key={review.transactionDigest} review={review} onReplacement={setReplacement} onMutating={setApplying} />
            : <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs" disabled={busy || applying} onClick={() => setEditingOriginal(true)}>Review notes, highlights and tags</button>
        )}
        {replacement ? <p role="status" className="mt-2">Replacement ...{replacement.replacementTransactionId.slice(-8)} was stored. Check sync status for Primary acceptance. If it belongs to an earlier Primary, browse the archive starting at epoch ...{replacement.replacementEpochId.slice(-8)} and review that replacement edit. This original edit will not create another replacement.</p>
          : !readOnly && review.outcome.state !== "confirmed_accepted" && coverage.current.eligible && coverage.current.count === review.memberCount && <div className="mt-3">
            <p>Applying again creates fresh assignments for every change in this edit. It can replace newer Saved, Archive or liked choices. An unknown original outcome does not mean the edit failed.</p>
            <button type="button" disabled={busy || applying} className="btn-primary mt-2 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" onClick={() => void applyAgain()}>{applying ? "Storing replacement..." : "Apply again"}</button>
          </div>}
        {review.nextCursor && <button type="button" className="btn-secondary mt-2 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy || applying} onClick={() => void loadReview(review.transactionId, review.nextCursor)}>Next changes</button>}
      </div>}
    </>}
  </div>;
}
