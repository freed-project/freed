import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeLibraryCoreFeedPageCursorV1, parseLibraryCoreConsumerRecoveryStatusV1 } from "@freed/shared/library-core";
const calls = vi.hoisted(() => ({ read: vi.fn(), recover: vi.fn(), query: vi.fn(), action: vi.fn(), rss: vi.fn(), names: vi.fn(), removals: vi.fn(), unsubscribe: vi.fn(), items: vi.fn(), deleteItems: vi.fn(), subscriptions: vi.fn(), upsert: vi.fn(), accounts: vi.fn(), links: vi.fn() }));
vi.mock("../lib/library-core-sqlite-runtime", () => ({ readPwaConsumerRecoveryStatus: calls.read, queryPwaNormalizedLibrary: calls.query }));
vi.mock("../lib/library-core-pwa-consumer-recovery", () => ({ continuePwaConsumerRecovery: calls.recover }));
vi.mock("../lib/library-core-pwa-follower-mutations", () => ({ createPwaRecoveryAssignmentAction: calls.action, createPwaRecoveryRssTitleAction: calls.rss, createPwaRecoveryRssRemovalAction: calls.unsubscribe, createPwaRecoveryItemRemovalAction: calls.deleteItems, createPwaRecoveryAccountRemovalAction: calls.deleteItems, createPwaRecoveryPersonRemovalAction: calls.deleteItems, createPwaRecoveryAccountLinkAction: calls.links, createPwaRecoveryRssUpsertAction: calls.upsert }));
vi.mock("../lib/library-core-pwa-recovery-editors", () => ({ loadPwaRecoveryRssTitleDrafts: calls.names, loadPwaRecoveryRssRemovalDrafts: calls.removals, loadPwaRecoveryItemRemovalDrafts: calls.items, loadPwaRecoveryAccountRemovalDrafts: calls.items, loadPwaRecoveryPersonRemovalDrafts: calls.items, loadPwaRecoveryAccountLinkDrafts: calls.accounts, loadPwaRecoveryRssUpsertDrafts: calls.subscriptions }));
import { PwaConsumerRecovery } from "./PwaConsumerRecovery";
const id = "1".repeat(64), epoch = "2".repeat(64);
const required = parseLibraryCoreConsumerRecoveryStatusV1({ state: "required", pendingIntentCount: 1234, publishedIntentCount: 2,
  plan: { recoveryId: id, oldActorId: id, actorPublicKey: id, installationIncarnation: id, predecessorEpochId: id,
    authority: { library_id: id, epoch_id: epoch, epoch: 2, authority_key_id: id, authority_public_key: id, observed_frontier: [] }, preparedRequest: null } });
let root: Root | undefined, container: HTMLDivElement;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container?.remove(); vi.clearAllMocks(); });
async function render() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(PwaConsumerRecovery)); });
}
describe("PWA explicit recovery control", () => {
  it("waits for an explicit action, prevents duplicate actions and reports preserved edits", async () => {
    calls.read.mockResolvedValue(required);
    let finish!: (value: unknown) => void;
    calls.recover.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    expect(container.textContent).toContain((1236).toLocaleString());
    expect(calls.recover).not.toHaveBeenCalled();
    const button = container.querySelector("button")!;
    await act(async () => { button.click(); button.click(); });
    expect(calls.recover).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await act(async () => { finish({ ...required, state: "following" }); });
    expect(container.textContent).toContain("Previous edits preserved");
    expect(container.textContent).toContain("View archives");
  });
  it("does not infer a Primary change from a failed status read", async () => {
    calls.read.mockRejectedValue(new Error("worker unavailable")); await render();
    expect(container.textContent).toContain("Browser recovery unavailable");
    expect(container.textContent).not.toContain("Your Primary has changed");
    expect(calls.recover).not.toHaveBeenCalled();
  });
  it("loads one archive page on demand and discards a read after close", async () => {
    calls.read.mockResolvedValue({ ...required, state: "following" });
    let finish!: (value: unknown) => void;
    calls.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); expect(calls.query).not.toHaveBeenCalled();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); expect(calls.query).toHaveBeenCalledTimes(1);
    expect(calls.query.mock.calls[0]![0]).toMatchObject({ queryId: "recovery_archive_page_v1", cursor: null, limit: 8 });
    await click("Close archives");
    await act(async () => { finish({ rows: [{ recoveryId: "a".repeat(64), pendingEdits: 4, publishedEdits: 2 }], nextCursor: null }); });
    expect(container.textContent).not.toContain("...aaaaaaaa");
    await click("View archives");
    const next = encodeLibraryCoreFeedPageCursorV1({ generationId: "d".repeat(64) as never,
      globalId: `recovery_archive_page_v1:${"c".repeat(64)}:${"b".repeat(64)}` as never,
      sortAt: 0, projectionRevision: 1, transitionSequence: 1 });
    await act(async () => { finish({ rows: [{ recoveryId: "b".repeat(64), pendingEdits: 1234, publishedEdits: 2 }], nextCursor: next }); });
    expect(container.textContent).toContain("...bbbbbbbb"); expect(container.textContent).toContain((1234).toLocaleString());
    await click("Next archives"); expect(calls.query.mock.calls.at(-1)![0].cursor).toBe(next);
    expect(container.textContent).not.toContain("...bbbbbbbb");
    await act(async () => { finish({ rows: [], nextCursor: null }); });
  });

  it("replaces archive metadata with one explicit transaction page and discards a read on back", async () => {
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null });
    await render();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); await click("View archive ...11111111");
    expect(calls.query).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("1 pending");
    expect(container.textContent).toContain("check for acceptance or rejection evidence");
    let finish!: (value: unknown) => void;
    calls.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click("Load preserved edits");
    expect(calls.query.mock.calls.at(-1)![0]).toMatchObject({ queryId: "recovery_intent_page_v1", recoveryId: id, limit: 8, cursor: null });
    await act(async () => { finish({ rows: [{ transactionId: "old-edit-12345678", ordinal: 0 }], nextCursor: encodeLibraryCoreFeedPageCursorV1({ generationId: "d".repeat(64) as never, globalId: `recovery_intent_page_v1:${id}:${"a".repeat(64)}` as never, sortAt: 0, projectionRevision: 1, transitionSequence: 1 }) }); });
    expect(container.textContent).toContain("Review edit ...12345678");
    await click("Next edits");
    expect(container.textContent).not.toContain("Review edit ...12345678");
    expect(calls.query.mock.calls.at(-1)![0].cursor).not.toBeNull();
    await click("Back to archives");
    await act(async () => { finish({ rows: [{ transactionId: "late-edit-87654321", ordinal: 1 }], nextCursor: null }); });
    expect(container.textContent).not.toContain("87654321");
    expect(container.textContent).toContain("View archives");
  });

  it("shows verified outcome uncertainty and drops late review on return", async () => {
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: "edit-12345678", ordinal: 0 }], nextCursor: null });
    await render();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678");
    expect(calls.query).toHaveBeenCalledTimes(2);
    let finish!: (value: unknown) => void;
    calls.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click("Verify preserved edit");
    expect(calls.query.mock.calls.at(-1)![0]).toMatchObject({ queryId: "recovery_intent_review_v1", transactionId: "edit-12345678", recoveryId: id });
    await act(async () => { finish({ outcome: { state: "unresolved" }, memberCount: 1, rows: [], nextCursor: null, replacement: null }); });
    expect(container.textContent).toContain("Missing acceptance evidence does not mean this edit failed");
    await click("Verify again");
    await click("Back to edits");
    await act(async () => { finish({ outcome: { state: "confirmed_accepted", committed_revision: 1 }, memberCount: 1, rows: [], nextCursor: null, replacement: null }); });
    expect(container.textContent).not.toContain("Canonical receipts confirm");
    expect(calls.recover).not.toHaveBeenCalled();
  });

  it("requires every review page and retries the same explicit action after response loss", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, nextCursor: null, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0]!, entityId: `rss:item:${memberIndex + 1}`, memberIndex, itemPresent: true })), recoveryId: id, transactionId: "edit-12345678", outcome: { state: "unresolved" } };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: review.transactionId }], nextCursor: null })
      .mockResolvedValueOnce({ ...review, rows: [review.rows[0]], nextCursor: encodeLibraryCoreFeedPageCursorV1({
        generationId: review.source.generationId as never, projectionRevision: review.source.projectionRevision,
        transitionSequence: review.source.transitionSequence, sortAt: 0,
        globalId: `recovery_intent_review_v1:${id}:${review.archiveDigest}:${review.transactionDigest}` as never }) })
      .mockResolvedValueOnce({ ...review, rows: [review.rows[1]], nextCursor: null });
    let finish!: () => void;
    const apply = vi.fn().mockRejectedValueOnce(new Error("response lost"))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    calls.action.mockReturnValue(apply);
    await render();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit");
    expect(container.textContent).not.toContain("Apply again");
    await click("Next changes");
    expect(container.textContent).toContain("may override later changes");
    expect(apply).not.toHaveBeenCalled();
    await click("Apply again");
    expect(container.textContent).toContain("response lost");
    await act(async () => {
      const button = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry same replacement")!;
      button.click(); button.click();
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(calls.action).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
    expect(container.textContent).not.toContain("Apply again");
  });

  it("routes verified account links through explicit review before creating the action", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, recoveryId: id, transactionId: "edit-12345678", memberCount: 1, nextCursor: null,
      outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], operationType: "account_person_assignment", itemPresent: null }] };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: "edit-12345678" }], nextCursor: null }).mockResolvedValueOnce(review)
      .mockResolvedValue({ source: review.source, rows: [] });
    calls.accounts.mockResolvedValue({ replacement: null, drafts: [{ accountId: "account:fixed", label: "Account", current: { id: null, label: "Unlinked", present: true }, archived: { id: null, label: "Unlinked", present: true } }] });
    calls.links.mockReturnValue(vi.fn().mockResolvedValue({}));
    await render();
    const button = (label: string) => [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
    const click = (label: string) => act(async () => button(label).click());
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit");
    expect(calls.accounts).not.toHaveBeenCalled();
    await click("Review account links");
    expect(calls.links).not.toHaveBeenCalled();
    expect(button("Store account links").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Store account links");
    expect(calls.links).toHaveBeenCalledExactlyOnceWith(review, [{ accountId: "account:fixed", personId: null }]);
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
  });

  it("routes a verified full-record subscription to explicit settings recovery", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, recoveryId: id, transactionId: "edit-12345678", memberCount: 1, nextCursor: null,
      outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], operationType: "rss_feed_upsert", itemPresent: null }] };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: review.transactionId }], nextCursor: null }).mockResolvedValueOnce(review);
    const feed = { url: "https://example.com/feed", title: "Current", enabled: false, trackUnread: true, lastFetched: 900 };
    calls.subscriptions.mockResolvedValue({ replacement: null, drafts: [{ current: feed, feed, archived: { ...feed, title: "Archived" } }] });
    calls.upsert.mockReturnValue(vi.fn().mockResolvedValue({}));
    await render();
    const button = (label: string) => [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
    const click = (label: string) => act(async () => button(label).click());
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit");
    expect(calls.subscriptions).not.toHaveBeenCalled();
    await click("Review subscription settings");
    expect(calls.upsert).not.toHaveBeenCalled();
    expect(button("Store revised subscriptions").disabled).toBe(true);
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!.click());
    await click("Store revised subscriptions");
    expect(calls.upsert).toHaveBeenCalledExactlyOnceWith(review, [feed]);
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
  });

  it("opens the feed name editor explicitly and locks revised names across retry", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, recoveryId: id, transactionId: "edit-12345678", memberCount: 1, nextCursor: null,
      outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], operationType: "rss_feed_title_assignment", itemPresent: null }] };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: review.transactionId }], nextCursor: null }).mockResolvedValueOnce(review);
    const drafts = [{ url: "https://example.com/feed", title: "Recovered name", archivedTitle: "Recovered name", currentTitle: "Current name" }];
    calls.names.mockResolvedValue({ replacement: null, drafts });
    const apply = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({});
    calls.rss.mockReturnValue(apply);
    await render();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit");
    expect(calls.names).not.toHaveBeenCalled();
    await click("Review feed names");
    expect(container.textContent).toContain("Last synced: Current name");
    expect(container.textContent).toContain("does not include pending edits");
    expect(apply).not.toHaveBeenCalled();
    await click("Store revised names");
    expect(container.querySelector("input")!.disabled).toBe(true);
    await click("Retry same names");
    expect(calls.rss).toHaveBeenCalledTimes(1);
    expect(calls.rss).toHaveBeenCalledWith(review, drafts);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
  });

  it("allows read-only review of earlier archives while successor enrollment is required", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    calls.read.mockResolvedValue(required);
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: "edit-12345678" }], nextCursor: null })
      .mockResolvedValueOnce({ ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" } });
    await render();
    const click = async (label: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); };
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit");
    expect(container.textContent).toContain("Missing acceptance evidence does not mean this edit failed");
    expect(container.textContent).toContain("Finish enrollment with the new Primary");
    expect([...container.querySelectorAll("button")].some(button => /Apply again|Review feed names|Review annotations/.test(button.textContent ?? ""))).toBe(false);
    expect(calls.recover).not.toHaveBeenCalled(); expect(calls.action).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enroll with new Primary");
  });

  it("keeps enrollment available when this browser cannot read earlier archives", async () => {
    calls.read.mockResolvedValue(required); calls.query.mockRejectedValue(new Error("Recovery archives are unavailable in this storage version"));
    await render();
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "View archives")!.click());
    expect(container.textContent).toContain("Earlier archives are not available");
    expect(container.textContent).not.toContain("storage version");
    expect(container.textContent).toContain("Enroll with new Primary");
    expect(calls.recover).not.toHaveBeenCalled();
  });

  it("requires explicit deletion confirmation and retries the same unsubscribe", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, recoveryId: id, transactionId: "edit-12345678", memberCount: 1, nextCursor: null,
      outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], operationType: "rss_feed_remove_with_items", itemPresent: null }] };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: review.transactionId }], nextCursor: null }).mockResolvedValueOnce(review);
    calls.removals.mockResolvedValue({ replacement: null, drafts: [{ url: "https://example.com/feed", title: "Current feed", includeItems: true }] });
    const apply = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({});
    calls.unsubscribe.mockReturnValue(apply);
    await render();
    const button = (label: string) => [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
    const click = (label: string) => act(async () => button(label).click());
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit"); await click("Review unsubscribe");
    expect(container.textContent).toContain("including articles added since the original edit or before acceptance");
    expect(button("Store unsubscribe").disabled).toBe(true);
    expect(calls.unsubscribe).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Store unsubscribe");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    await click("Retry same unsubscribe");
    expect(calls.unsubscribe).toHaveBeenCalledOnce(); expect(calls.unsubscribe).toHaveBeenCalledWith(review, true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
  });

  it.each(["items", "people", "accounts"])("requires confirmation for archived %s deletion and retries the same action", async mode => {
    const people = mode === "people";
    const store = mode === "accounts" ? "Store account deletion" : people ? "Store people deletion" : "Store item deletion";
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, recoveryId: id, transactionId: "edit-12345678", memberCount: 1, nextCursor: null,
      outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], personState: people ? "deleted" : null, operationType: mode === "accounts" ? "account_remove" : people ? "person_remove_and_accounts" : "feed_item_remove", itemPresent: false }] };
    calls.read.mockResolvedValue({ ...required, state: "following" });
    calls.query.mockResolvedValueOnce({ rows: [{ recoveryId: id, pendingEdits: 1, publishedEdits: 0 }], nextCursor: null })
      .mockResolvedValueOnce({ rows: [{ transactionId: review.transactionId }], nextCursor: null }).mockResolvedValueOnce(review);
    calls.items.mockResolvedValue({ replacement: null, drafts: [{ entityId: "rss:absent", label: "Archived item", present: false }] });
    const apply = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({});
    calls.deleteItems.mockReturnValue(apply);
    await render();
    const button = (label: string) => [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
    const click = (label: string) => act(async () => button(label).click());
    await click("View archives"); await click("View archive ...11111111"); await click("Load preserved edits");
    await click("Review edit ...12345678"); await click("Verify preserved edit"); await click(mode === "accounts" ? "Review account deletion" : people ? "Review people deletion" : "Review item deletion");
    expect(container.textContent).toContain("Currently absent. This target remains in the deletion.");
    if (people) { expect(container.textContent).toContain("including links added since this review"); expect(container.textContent).toContain("Person was deleted. Recovery cannot recreate it."); }
    expect(button(store).disabled).toBe(true);
    expect(calls.deleteItems).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click(store);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    await click("Retry same deletion");
    expect(calls.deleteItems).toHaveBeenCalledOnce(); expect(calls.deleteItems).toHaveBeenCalledWith(review, true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Replacement preserved for the new Primary");
  });

});
