import { expect, it, vi } from "vitest";
import { readLibraryCoreRecoveryFriendDraftV1 } from "./recovery-friend-context.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";
it("retains one page for large link sets and refuses later stale or cancelled reads", async () => {
  const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
  const person = { id: "person:one", name: "Name", careLevel: 3, relationshipStatus: "friend", createdAt: 1, updatedAt: 2 };
  const account = (id: string) => ({ id, personId: person.id, kind: "social", provider: "instagram", externalId: id, discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 });
  let stale = false, cancelled = false;
  const query = vi.fn(async (r: any) => {
    const currentSource = stale ? { ...source, projectionRevision: 8 } : source;
    if (r.queryId === "person_root_v1") return { source, person };
    if (r.queryId === "account_root_v1") return { source: currentSource, account: account(r.accountId) };
    if (r.queryId !== "person_account_page_v1") throw new Error("Unexpected display query");
    const offset = Number(r.cursor ?? 0), end = Math.min(130, offset + r.limit);
    return { source: currentSource, rows: Array.from({ length: end - offset }, (_, i) => ({ accountId: `account:${String(offset + i).padStart(3, "0")}` })), nextCursor: end === 130 ? null : String(end) };
  });
  const draft = await readLibraryCoreRecoveryFriendDraftV1({ memberCount: 1, source } as LibraryCoreRecoveryIntentReviewResponseV1,
    { operationType: "friend_replace", entityId: person.id, personState: "present" } as LibraryCoreRecoveryIntentReviewResponseV1["rows"][number],
    { entity_type: "Person", blob_references: [], payload: { accounts: [], person } }, query as unknown as LibraryCoreNormalizedReaderRuntime["query"],
    () => { if (cancelled) throw new Error("QUERY_CANCELLED"); });
  expect(draft.accounts).toHaveLength(0);
  expect(draft.paged?.first.accounts).toHaveLength(8);
  expect(draft.paged?.first.accounts.every(row => !row.selected)).toBe(true);
  expect(query.mock.calls.filter(([r]) => r.queryId === "account_root_v1")).toHaveLength(8);
  const next = await draft.paged!.load(draft.paged!.first.nextCursor);
  expect(next.accounts.map(row => row.id)).toEqual(Array.from({ length: 8 }, (_, i) => `account:${String(i + 8).padStart(3, "0")}`));
  stale = true;
  await expect(draft.paged!.load(next.nextCursor)).rejects.toThrow("CURSOR_STALE");
  cancelled = true;
  const calls = query.mock.calls.length;
  await expect(draft.paged!.load(next.nextCursor)).rejects.toThrow("QUERY_CANCELLED");
  expect(query.mock.calls).toHaveLength(calls);
});
