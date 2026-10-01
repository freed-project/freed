import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumerRecoveryReview } from "./ConsumerRecoveryReview";

const query = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../lib/library-core-normalized-query-client", () => ({
  queryNormalizedLibrary: query, createDesktopLibraryCoreOperationId: (prefix: string) => `${prefix}-test`,
}));
const recoveryId = "a".repeat(64);
const page = { rows: [{ ordinal: 0, transactionId: "private-transaction-12345678" }], nextCursor: "next-page" };
const detail = {
  transactionId: page.rows[0].transactionId, memberCount: 2, nextCursor: null,
  outcome: { state: "unresolved" }, replacement: null,
  rows: [{ memberIndex: 0, authorName: "Author", itemPresent: true, itemText: "Recognizable article", entityId: "private-item-abcdefgh", operationType: "feed_item_saved_assignment", assigned: true },
    { memberIndex: 1, authorName: null, itemPresent: false, itemState: "deleted", itemText: null, entityId: "private-item-ijklmnop", operationType: "feed_item_archive_assignment", assigned: false }],
};
let root: Root, container: HTMLDivElement;
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
beforeEach(async () => {
  query.mockReset(); invoke.mockReset();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<ConsumerRecoveryReview recoveryId={recoveryId} />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("consumer archive review", () => {
  it("reads bounded pages, shows explicit unknown outcomes and keeps full identities out of labels", async () => {
    query.mockResolvedValueOnce(page).mockResolvedValueOnce(detail).mockResolvedValueOnce({ rows: [], nextCursor: null });
    await click("Review archived edits");
    expect(query.mock.calls[0][0]).toMatchObject({ queryId: "recovery_intent_page_v1", recoveryId, limit: 16, cursor: null });
    expect(container.textContent).not.toContain("private-transaction");
    await click("Review edit ...12345678");
    expect(query.mock.calls[1][0]).toMatchObject({ queryId: "recovery_intent_review_v1", transactionId: page.rows[0].transactionId, limit: 8 });
    expect(container.textContent).toContain("original outcome has not been established");
    expect(container.textContent).toContain("Save item and remove it from Archive");
    expect(container.textContent).toContain("Remove item from Archive");
    expect(container.textContent).toContain("Recognizable article");
    expect(container.textContent).toContain("Item was deleted. Recovery cannot recreate it.");
    expect(container.textContent).not.toContain("private-item");
    expect(container.textContent).toContain("Reviewing does not resend");
    await click("Next archived edits");
    expect(query.mock.calls[2][0]).toMatchObject({ cursor: "next-page" });
    expect(container.textContent).not.toContain("12345678");
    expect(container.textContent).toContain("No archived edits");
    expect(query.mock.calls.every(([request]) => ["recovery_intent_page_v1", "recovery_intent_review_v1"].includes(request.queryId))).toBe(true);
  });
  it("drops late results after close and clears stale proof on a failed continuation", async () => {
    let resolve: (value: unknown) => void = () => {};
    query.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await click("Review archived edits");
    const signal = query.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await click("Close review");
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(page));
    expect(container.textContent).not.toContain("12345678");
    query.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...detail, outcome: { state: "confirmed_accepted", committed_revision: 7 }, nextCursor: "detail-next" })
      .mockRejectedValueOnce(new Error("CURSOR_STALE"));
    await click("Review archived edits"); await click("Review edit ...12345678");
    expect(container.textContent).toContain("Acceptance confirmed");
    await click("Next changes");
    expect(container.textContent).not.toContain("Acceptance confirmed");
    expect(container.textContent).toContain("Library changed during review");
  });
  it("requires full review and explicit action, and retries the same archive request after response loss", async () => {
    const source = { generationId: "b".repeat(64), projectionRevision: 4, transitionSequence: 6 };
    const first = { ...detail, recoveryId, archiveDigest: "c".repeat(64), transactionDigest: "d".repeat(64), source,
      rows: [detail.rows[0]], nextCursor: "review-next" };
    const last = { ...first, rows: [{ ...detail.rows[0], memberIndex: 1 }], nextCursor: null };
    query.mockResolvedValueOnce(page).mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    await click("Review archived edits"); await click("Review edit ...12345678");
    expect(container.textContent).not.toContain("Apply again");
    expect(invoke).not.toHaveBeenCalled();
    await click("Next changes");
    expect(container.textContent).toContain("can replace newer Saved");
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce(new Error("response lost"));
    await click("Apply again");
    expect(container.textContent).toContain("No replacement was confirmed");
    const receipt = { schemaVersion: 1, recoveryId, originalTransactionId: detail.transactionId,
      replacementTransactionId: "recovery:12345678", replacementTransactionDigest: "e".repeat(64),
      replacementEpochId: "f".repeat(64), replacementActorId: "1".repeat(64), firstCounter: 1, lastCounter: 2,
      memberCount: 2, createdAt: 5000 };
    invoke.mockResolvedValueOnce(receipt);
    await click("Apply again");
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1]);
    expect(invoke.mock.calls[0]).toEqual(["reapply_normalized_library_archived_assignments", { request: {
      schemaVersion: 1, recoveryId, archiveDigest: first.archiveDigest, transactionId: detail.transactionId,
      transactionDigest: first.transactionDigest, reviewedGenerationId: source.generationId,
      reviewedRevision: 4, reviewedLocalSequence: 6, memberCount: 2,
    } }]);
    expect(container.textContent).toContain("Replacement ...12345678 was stored");
    expect(container.textContent).not.toContain("Apply again");
    await click("Close review");
    query.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...last, rows: [{ ...detail.rows[0], memberIndex: 0 }, last.rows[0]], replacement: receipt });
    await click("Review archived edits"); await click("Review edit ...12345678");
    expect(container.textContent).toContain("Replacement ...12345678 was stored");
    expect(container.textContent).not.toContain("Apply again");
    expect(invoke).toHaveBeenCalledTimes(2);

  });

});

it("selects an older archive without replay and cancels a pending archive page on close", async () => {
  const older = "b".repeat(64);
  query.mockResolvedValueOnce({ rows: [{ recoveryId: older, predecessorEpochId: "c".repeat(64), successorEpochId: "d".repeat(64), pendingEdits: 1234, publishedEdits: 0 }], nextCursor: "archive-next" })
    .mockResolvedValueOnce(page);
  await click("Browse recovery archives");
  expect(query.mock.calls[0][0]).toMatchObject({ queryId: "recovery_archive_page_v1", limit: 16 });
  expect(container.textContent).toContain((1234).toLocaleString());
  expect(container.textContent).not.toContain(older);
  await click("Review archive ...bbbbbbbb");
  expect(query.mock.calls[1][0]).toMatchObject({ queryId: "recovery_intent_page_v1", recoveryId: older });
  expect(invoke).not.toHaveBeenCalled();
  query.mockImplementationOnce(() => new Promise(() => {}));
  await click("Browse recovery archives");
  const signal = query.mock.calls[2][1] as AbortSignal;
  await click("Close review");
  expect(signal.aborted).toBe(true);
});


it("reapplies an explicitly reviewed older edit and displays the replacement epoch", async () => {
  const older = "b".repeat(64);
  const reviewed = { ...detail, recoveryId: older, archiveDigest: "c".repeat(64), transactionDigest: "d".repeat(64),
    source: { generationId: "e".repeat(64), projectionRevision: 1, transitionSequence: 2 },
    rows: detail.rows.map((row) => ({ ...row, itemPresent: true })) };
  query.mockResolvedValueOnce({ rows: [{ recoveryId: older, predecessorEpochId: "c".repeat(64), successorEpochId: "d".repeat(64), pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
    .mockResolvedValueOnce(page).mockResolvedValueOnce(reviewed);
  await click("Browse recovery archives"); await click("Review archive ...bbbbbbbb"); await click("Review edit ...12345678");
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValueOnce({ schemaVersion: 1, recoveryId: older, originalTransactionId: detail.transactionId,
    replacementTransactionId: "recovery:87654321", replacementTransactionDigest: "e".repeat(64), replacementEpochId: "f".repeat(64),
    replacementActorId: "1".repeat(64), firstCounter: 1, lastCounter: 2, memberCount: 2, createdAt: 5000 });
  await click("Apply again");
  expect(invoke.mock.calls[0][1].request.recoveryId).toBe(older);
  expect(container.textContent).toContain("epoch ...ffffffff");
  expect(container.textContent).toContain("will not create another replacement");
});

it.each(["feed_item_saved_assignment", "rss_feed_title_assignment", "feed_item_annotations_replace", "feed_item_remove"])("reviews %s across roles without offering reapplication", async operationType => {
  await act(async () => root.render(<ConsumerRecoveryReview readOnly />));
  expect(query).not.toHaveBeenCalled();
  query.mockResolvedValueOnce({ rows: [{ recoveryId, predecessorEpochId: "b".repeat(64), successorEpochId: "c".repeat(64), pendingEdits: 1, publishedEdits: 0 }], nextCursor: null });
  await click("Browse recovery archives");
  query.mockResolvedValueOnce(page);
  await click("Review archive ...aaaaaaaa");
  query.mockResolvedValueOnce({ ...detail, memberCount: 1, rows: [{ ...detail.rows[0], memberIndex: 0, operationType }] });
  await click("Review edit ...12345678");
  expect(container.textContent).toContain("The original outcome has not been established.");
  expect(container.textContent).toContain("Recognizable article");
  const actions = Array.from(container.querySelectorAll("button")).map(button => button.textContent);
  expect(actions).not.toContain("Apply again");
  expect(actions).not.toContain("Review feed names");
  expect(actions).not.toContain("Review item deletion");
  expect(actions).not.toContain("Review notes, highlights and tags");
  expect(invoke).not.toHaveBeenCalled();
  expect(query.mock.calls.every(([request]) => request.queryId.startsWith("recovery_"))).toBe(true);
});

it("cancels an in-flight archive read when the view changes to read-only", async () => {
  let complete: (value: unknown) => void = () => {};
  query.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await click("Review archived edits");
  const signal = query.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(<ConsumerRecoveryReview readOnly />));
  expect(signal.aborted).toBe(true);
  await act(async () => complete(page));
  expect(container.textContent).not.toContain("Review edit ...12345678");
  expect(invoke).not.toHaveBeenCalled();
});
