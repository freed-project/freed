import orderVector from "../../../shared/src/library-core/friend-account-order-vector-v1.json";
import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreRecoveryIntentReviewResponseV1,
} from "@freed/shared/library-core";
import type { Account, Person } from "@freed/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitFollowerIntent: vi.fn(),
  readFollowerMutationContext: vi.fn(),
  signFollowerOperation: vi.fn(),
  readRecovery: vi.fn(),
  query: vi.fn(),
  reapply: vi.fn(),
}));

vi.mock("./library-core-browser-key-vault", () => ({
  signPwaLibraryCoreFollowerOperation: mocks.signFollowerOperation,
}));

vi.mock("./library-core-sqlite-runtime", () => ({
  commitPwaFollowerIntent: mocks.commitFollowerIntent,
  queryPwaNormalizedLibrary: mocks.query,
  reapplyPwaConsumerIntent: mocks.reapply,
  readPwaFollowerMutationContext: mocks.readFollowerMutationContext,
  readPwaConsumerRecoveryStatus: mocks.readRecovery,
}));

import {
  createPwaRecoveryAccountAction,
  createPwaRecoveryPersonAction,
  createPwaRecoveryFriendAction,
  createPwaRecoveryAccountLinkAction,
  createPwaRecoveryAssignmentAction,
  createPwaRecoveryRssTitleAction,
  createPwaRecoveryRssUpsertAction,
  createPwaRecoveryAnnotationAction,
  createPwaRecoveryRssRemovalAction,
  createPwaRecoveryItemRemovalAction,
  createPwaRecoveryAccountRemovalAction,
  createPwaRecoveryPersonRemovalAction,
  commitPwaLibraryCoreAccountPersonAssignment,
  commitPwaLibraryCoreAccountRemove,
  commitPwaLibraryCoreAccountRemoves,
  commitPwaLibraryCoreAccountUpserts,
  commitPwaLibraryCoreFeedItemCaptures,
  commitPwaLibraryCoreFeedItemAnalysisSets,
  commitPwaLibraryCoreFeedItemAnnotationSets,
  commitPwaLibraryCoreFeedItemRemove,
  commitPwaLibraryCoreFeedItemRemoves,
  commitPwaLibraryCoreFriendReplace,
  commitPwaLibraryCorePersonRemove,
  commitPwaLibraryCorePersonRemoves,
  commitPwaLibraryCorePersonReachOutAppend,
  commitPwaLibraryCorePersonUpserts,
  commitPwaLibraryCorePreferencesPatch,
  commitPwaLibraryCoreReadAssignments,
  commitPwaLibraryCoreRssFeedRemove,
  commitPwaLibraryCoreRssFeedRemoves,
  commitPwaLibraryCoreRssFeedTitleAssignment,
  commitPwaLibraryCoreRssFeedUpsert,
  commitPwaLibraryCoreRssFeedUpserts,
  commitPwaLibraryCoreUserStateAssignments,
} from "./library-core-pwa-follower-mutations";
import { PwaLibraryCoreSqliteWorkerUnavailableError } from "./library-core-sqlite-client";

const HEX = {
  actor: "11".repeat(32),
  chain: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "55".repeat(64),
} as const;

function decodeCommit(commit: LibraryCoreFollowerIntentCommitV1) {
  return commit.envelopeBytes.map((bytes) => {
    const value = decodeLibraryCoreCanonicalValue(bytes);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("test follower envelope is not a record");
    }
    return value as Readonly<Record<string, unknown>>;
  });
}

function receiptFor(commit: LibraryCoreFollowerIntentCommitV1) {
  const envelopes = decodeCommit(commit);
  const first = envelopes[0]!;
  const last = envelopes.at(-1)!;
  return {
    actorId: first.actor_id,
    firstCounter: first.actor_sequence,
    lastCounter: last.actor_sequence,
    memberCount: envelopes.length,
    optimisticFieldCount: envelopes.length,
    state: "pending",
    transactionId: first.transaction_id,
  };
}

describe("PWA SQLite follower mutations", () => {
  beforeEach(() => {
    mocks.query.mockReset(); mocks.reapply.mockReset();
    mocks.readRecovery.mockResolvedValue({ state: "none" });
    mocks.commitFollowerIntent.mockReset();
    mocks.readFollowerMutationContext.mockReset();
    mocks.signFollowerOperation.mockReset();
    mocks.readFollowerMutationContext.mockResolvedValue({
      actor_id: HEX.actor,
      actor_public_key: HEX.publicKey,
      epoch: 2,
      epoch_id: HEX.epoch,
      library_id: HEX.library,
      next_actor_sequence: 4,
      observed_frontier: [],
      previous_actor_chain_digest: HEX.chain,
      previous_actor_operation_id: "operation:actor:3",
      schema_version: 1,
    });
    mocks.signFollowerOperation.mockResolvedValue(HEX.signature);
    mocks.commitFollowerIntent.mockImplementation(
      async (commit: LibraryCoreFollowerIntentCommitV1) => receiptFor(commit),
    );
  });

  it("keeps replacement bytes after response loss and checks a durable link before signing", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, nextCursor: null, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0]!, entityId: `rss:item:${memberIndex + 1}`, memberIndex, itemPresent: true })), outcome: { state: "unresolved" } } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockResolvedValue(review);
    mocks.reapply.mockReset();
    mocks.reapply.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ replacementTransactionId: "replacement" });
    const apply = createPwaRecoveryAssignmentAction(review);
    await expect(apply()).rejects.toThrow("response lost");
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
    const prepared = mocks.reapply.mock.calls[0]![0];
    const envelopes = decodeCommit(prepared.intent);
    expect(envelopes.map(row => row.entity_id)).toEqual(review.rows.map(row => row.entityId));
    expect(envelopes.map(row => row.actor_sequence)).toEqual([4, 5]);
    expect(envelopes[0]!.transaction_id).not.toBe(review.transactionId);
    const signatures = mocks.signFollowerOperation.mock.calls.length;
    await apply();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(prepared);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(signatures);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    mocks.signFollowerOperation.mockClear(); mocks.readFollowerMutationContext.mockClear();
    mocks.query.mockResolvedValue({ ...review, source: { ...review.source, projectionRevision: 999 }, replacement: { replacementTransactionId: "durable" } });
    expect(await createPwaRecoveryAssignmentAction(review)()).toEqual({ replacementTransactionId: "durable" });
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    expect(mocks.readFollowerMutationContext).not.toHaveBeenCalled();
  });

  it("refuses accepted, stale and unsupported whole transactions before signing", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, nextCursor: null, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0]!, entityId: `rss:item:${memberIndex + 1}`, memberIndex, itemPresent: true })), outcome: { state: "unresolved" } } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    for (const altered of [
      { ...review, outcome: { state: "confirmed_accepted" } },
      { ...review, source: { ...review.source, transitionSequence: 99 } },
      { ...review, rows: review.rows.map((row, index) => index ? { ...row, operationType: "feed_item_annotations_replace" } : row) },
    ]) {
      mocks.query.mockResolvedValue(altered);
      await expect(createPwaRecoveryAssignmentAction(review)()).rejects.toThrow();
    }
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("snapshots ordered account links, rechecks people before signing and retries one durable replacement", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const review = { ...fixture.response, memberCount: 2, nextCursor: null, outcome: { state: "unresolved" }, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0], memberIndex,
      entityId: "account:fixed", operationType: "account_person_assignment", itemPresent: null,
      originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { assigned_at_ms: 100, person_id: null } })),
    })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    const respond = async (request: { queryId: string; personId?: string }) => request.queryId === "account_detail_v1" ? { source: review.source, account: { id: "account:fixed", personId: null, displayName: "Account" } }
      : request.queryId === "person_detail_v1" ? { source: review.source, person: { id: request.personId, name: "Chosen" } } : review;
    mocks.query.mockImplementation(respond);
    const selected = [{ accountId: "account:fixed", personId: "person:chosen" as string | null }, { accountId: "account:fixed", personId: null }];
    const action = createPwaRecoveryAccountLinkAction(review, selected);
    selected[0]!.personId = "person:changed-later";
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    expect(decodeCommit(request.intent).map(e => [e.entity_id, e.payload])).toEqual([
      ["account:fixed", { assigned_at_ms: expect.any(Number), person_id: "person:chosen" }], ["account:fixed", { assigned_at_ms: expect.any(Number), person_id: null }],
    ]);
    mocks.query.mockRejectedValue(new Error("Library changed after signing"));
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
    mocks.signFollowerOperation.mockClear(); mocks.readFollowerMutationContext.mockClear();
    mocks.query.mockImplementation(async request => request.queryId === "person_detail_v1" ? { source: review.source, person: null } : respond(request));
    await expect(createPwaRecoveryAccountLinkAction(review, selected)()).rejects.toThrow("selected person");
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    expect(mocks.readFollowerMutationContext).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ ...review, replacement: { replacementTransactionId: "already-linked" }, source: { ...review.source, projectionRevision: 999 } });
    expect(await createPwaRecoveryAccountLinkAction(review, selected)()).toEqual({ replacementTransactionId: "already-linked" });
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
  });

  it("retains complete ordered Person roots and exact signed bytes after response loss", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const person = { id: "person:one", name: "Archived", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 1, updatedAt: 2, tags: ["retained"] };
    const review = { ...fixture.response, memberCount: 2, nextCursor: null, outcome: { state: "unresolved" }, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0], memberIndex, entityId: person.id, operationType: "person_upsert", personState: "absent", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { person } })) })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "person_root_v1" ? { source: review.source, person: null } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const action = createPwaRecoveryPersonAction(review, [person, { ...person, name: "Second" }]);
    person.tags.push("late mutation");
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const envelopes = decodeCommit(request.intent);
    expect(envelopes.map(e => e.entity_id)).toEqual([person.id, person.id]);
    expect(envelopes.map(e => (e.payload as { person: Person }).person)).toEqual([
      { ...person, tags: ["retained"], updatedAt: expect.any(Number) },
      { ...person, name: "Second", tags: ["retained"], updatedAt: expect.any(Number) },
    ]);
    mocks.query.mockRejectedValue(new Error("source changed"));
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("retains complete ordered Account roots and exact signed bytes after response loss", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const account = { id: "account:one", displayName: "Archived", kind: "social" as const, provider: "x" as const, externalId: "external:one", discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, address: "a".repeat(20000) };
    const review = { ...fixture.response, memberCount: 2, nextCursor: null, outcome: { state: "unresolved" }, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0], memberIndex, entityId: account.id, operationType: "account_upsert", personState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { account } })) })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "account_root_v1" ? { source: review.source, account: null } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const action = createPwaRecoveryAccountAction(review, [account, { ...account, displayName: "Second" }]);
    account.displayName = "Changed later";
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const envelopes = decodeCommit(request.intent);
    expect(envelopes.map(e => e.entity_id)).toEqual([account.id, account.id]);
    expect(envelopes.map(e => (e.payload as { account: typeof account }).account)).toEqual([
      { ...account, displayName: "Archived", updatedAt: expect.any(Number) },
      { ...account, displayName: "Second", updatedAt: expect.any(Number) },
    ]);
    mocks.query.mockRejectedValue(new Error("source changed"));
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
    mocks.signFollowerOperation.mockClear(); mocks.readFollowerMutationContext.mockClear();
    mocks.query.mockImplementation(async request => request.queryId === "account_root_v1" ? { source: review.source, account: null }
      : request.queryId === "person_detail_v1" ? { source: review.source, person: null } : review);
    await expect(createPwaRecoveryAccountAction(review, [{ ...account, personId: "person:missing" }, account])()).rejects.toThrow("selected person");
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    expect(mocks.readFollowerMutationContext).not.toHaveBeenCalled();

  });

  it("snapshots complete subscription replacements, fixes current history and retries without signing again", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const url = "https://example.com/feed.xml";
    const archived = { url, title: "Archived", enabled: true, trackUnread: false, lastFetched: 1 };
    const review = { ...fixture.response, memberCount: 2, nextCursor: null, outcome: { state: "unresolved" }, rows: [0, 1].map(memberIndex => ({ ...fixture.response.rows[0], memberIndex,
      entityId: url, operationType: "rss_feed_upsert", itemPresent: null,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { feed: archived } })),
    })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    const current = { ...archived, lastFetched: 900, pollInterval: 60, siteUrl: null, imageUrl: null, folder: null, sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null };
    mocks.query.mockImplementation(async request => request.queryId === "rss_feed_detail_v1" ? { source: review.source, feed: current } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const selected = [{ ...archived, title: "First", enabled: false }, { ...archived, title: "Second", pollInterval: 120 }];
    const action = createPwaRecoveryRssUpsertAction(review, selected);
    selected[0]!.title = "Changed later";
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const envelopes = decodeCommit(request.intent);
    expect(envelopes.map(e => e.entity_id)).toEqual([url, url]);
    expect(envelopes.map(e => e.payload)).toEqual([
      { feed: { ...archived, title: "First", enabled: false, lastFetched: 900 } },
      { feed: { ...archived, title: "Second", pollInterval: 120, lastFetched: 900 } },
    ]);
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
    const absentReview = { ...review, rows: review.rows.map(row => ({ ...row, personState: null, rssFeedState: "absent" as const })) };
    mocks.query.mockImplementation(async request => request.queryId === "rss_feed_detail_v1" ? { source: review.source, feed: null } : absentReview);
    mocks.reapply.mockResolvedValue({ replacementTransactionId: "fresh" });
    await createPwaRecoveryRssUpsertAction(review, selected)();
    const fresh = decodeCommit(mocks.reapply.mock.calls[2]![0].intent);
    expect(fresh).toHaveLength(2);
    for (const member of fresh) expect((member.payload as { feed: object }).feed).not.toHaveProperty("lastFetched");

  });

  it("stores revised RSS names through recovery and retains exact bytes after ambiguity", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const url = "https://example.com/feed.xml";
    const review = { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0],
      entityId: url, operationType: "rss_feed_title_assignment", itemPresent: null,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { title: "Archived", assigned_at_ms: 1000 } })),
    }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "rss_feed_detail_v1" ? { source: review.source, feed: { title: "Last synced" } } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const selected = [{ url, title: " Revised " }];
    const action = createPwaRecoveryRssTitleAction(review, selected);
    selected[0]!.title = "Later input must not alter this action";
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    expect(decodeCommit(request.intent)[0]).toMatchObject({ operation_type: "rss_feed_title_assignment", entity_id: url, payload: { title: "Revised" } });
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce();
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("signs a revised complete annotation set once, preserving unloaded quotes across retry", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const highlights = [{ text: null, textBlobDigest: "b".repeat(64), note: "Original note", createdAt: 500 }];
    const review = { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0],
      entityId: "rss:item:1", operationType: "feed_item_annotations_replace", itemPresent: true,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: [], payload: { highlights, tags: ["old"], assigned_at_ms: 1000 } })),
    }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockResolvedValue(review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const selected = [{ entityId: "rss:item:1", highlights, tags: ["revised"] }];
    const action = createPwaRecoveryAnnotationAction(review, selected);
    highlights[0]!.note = "Later input";
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    expect(decodeCommit(request.intent)[0]).toMatchObject({ operation_type: "feed_item_annotations_replace", payload: {
      highlights: [{ text: null, textBlobDigest: "b".repeat(64), note: "Original note", createdAt: 500 }], tags: ["revised"],
    } });
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce(); expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("requires deletion confirmation before signing and preserves unsubscribe scope across retry", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const url = "https://example.com/feed.xml";
    const review = { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0],
      entityId: url, operationType: "rss_feed_remove_with_items", itemPresent: null,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { removed_at_ms: 1000 } })),
    }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "rss_feed_detail_v1" ? { source: review.source, feed: { title: "Current feed" } } : review);
    await expect(createPwaRecoveryRssRemovalAction(review, false)()).rejects.toThrow("Confirm deletion");
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled(); expect(mocks.reapply).not.toHaveBeenCalled();
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const apply = createPwaRecoveryRssRemovalAction(review, true);
    await expect(apply()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    expect(decodeCommit(request.intent)[0]).toMatchObject({ operation_type: "rss_feed_remove_with_items", entity_id: url });
    expect((decodeCommit(request.intent)[0]!.payload as { removed_at_ms: number }).removed_at_ms).toBeGreaterThan(1000);
    await apply();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce(); expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it.each(["items", "people", "accounts"])("retains absent and duplicate %s deletion targets and reuses one signed replacement", async mode => {
    const operation = mode === "accounts" ? "account_remove" : mode === "people" ? "person_remove_and_accounts" : "feed_item_remove";
    const createAction = mode === "accounts" ? createPwaRecoveryAccountRemovalAction : mode === "people" ? createPwaRecoveryPersonRemovalAction : createPwaRecoveryItemRemovalAction;
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const ids = ["rss:first", "rss:absent", "rss:first"];
    const review = { ...fixture.response, memberCount: 3, nextCursor: null, outcome: { state: "unresolved" }, rows: ids.map((entityId, memberIndex) => ({
      ...fixture.response.rows[0], entityId, memberIndex, operationType: operation, itemPresent: memberIndex !== 1,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: mode === "accounts" ? "Account" : mode === "people" ? "Person" : "FeedItem", blob_references: [], payload: { removed_at_ms: 1000 } })),
    })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "account_detail_v1" ? { source: review.source, account: null } : request.queryId === "person_detail_v1" ? { source: review.source, person: null } : review);
    await expect(createAction(review, false)()).rejects.toThrow("Confirm deletion");
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const apply = createAction(review, true);
    await expect(apply()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const members = decodeCommit(request.intent);
    expect(members.map(value => value.entity_id)).toEqual(ids);
    expect(members.every(value => value.operation_type === operation && value.transaction_member_count === 3)).toBe(true);
    mocks.query.mockRejectedValue(new Error("later queries unavailable"));
    await apply();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(3);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("uses the committed recovery incarnation and refuses a stale recovery epoch", async () => {
    const plan = { recoveryId: "7".repeat(64), actorPublicKey: HEX.publicKey,
      authority: { library_id: HEX.library, epoch_id: HEX.epoch } };
    mocks.readRecovery.mockResolvedValue({ state: "following", plan });
    await commitPwaLibraryCoreReadAssignments(["item:1"], 1000);
    expect(mocks.signFollowerOperation.mock.calls[0]![2]).toBe(plan.recoveryId);
    mocks.signFollowerOperation.mockClear(); mocks.commitFollowerIntent.mockClear();
    mocks.readRecovery.mockResolvedValue({ state: "following", plan: { ...plan, authority: { ...plan.authority, epoch_id: "8".repeat(64) } } });
    await expect(commitPwaLibraryCoreReadAssignments(["item:1"], 1001)).rejects.toThrow(/recovery enrollment changed/);
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled(); expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });
  it("constructs one signed SQLite transaction for deduplicated reads", async () => {
    await commitPwaLibraryCoreReadAssignments(
      ["item:1", "item:1", "item:2"],
      1_000,
    );

    expect(mocks.readFollowerMutationContext).toHaveBeenCalledOnce();
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).toHaveBeenCalledOnce();
    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelopes = decodeCommit(commit);
    expect(envelopes.map((envelope) => envelope.entity_id)).toEqual([
      "item:1",
      "item:2",
    ]);
    expect(envelopes.map((envelope) => envelope.actor_sequence)).toEqual([
      4, 5,
    ]);
    expect(envelopes.map((envelope) => envelope.operation_type)).toEqual([
      "feed_item_read_assignment",
      "feed_item_read_assignment",
    ]);
  });

  it("retries exact canonical bytes once after a lost SQLite response", async () => {
    mocks.commitFollowerIntent
      .mockRejectedValueOnce(
        new PwaLibraryCoreSqliteWorkerUnavailableError(
          "PWA Library SQLite worker stopped unexpectedly",
        ),
      )
      .mockImplementationOnce(
        async (commit: LibraryCoreFollowerIntentCommitV1) => receiptFor(commit),
      );

    await commitPwaLibraryCoreUserStateAssignments(
      ["item:1", "item:2"],
      "saved",
      true,
      2_000,
    );

    expect(mocks.commitFollowerIntent).toHaveBeenCalledTimes(2);
    const first = mocks.commitFollowerIntent.mock.calls[0]![0];
    const second = mocks.commitFollowerIntent.mock.calls[1]![0];
    expect(second.envelopeBytes).toEqual(first.envelopeBytes);
    expect(decodeCommit(second).map((envelope) => envelope.payload)).toEqual([
      { assigned: true, assigned_at_ms: 2_000 },
      { assigned: true, assigned_at_ms: 2_000 },
    ]);
  });

  it("rejects a receipt that does not identify the committed transaction", async () => {
    mocks.commitFollowerIntent.mockResolvedValue({
      actorId: HEX.actor,
      firstCounter: 4,
      lastCounter: 4,
      memberCount: 1,
      optimisticFieldCount: 1,
      state: "pending",
      transactionId: "transaction:wrong",
    });

    await expect(
      commitPwaLibraryCoreUserStateAssignments(
        ["item:1"],
        "liked",
        true,
        3_000,
      ),
    ).rejects.toThrow(/receipt does not match/);
  });

  it("commits bounded FeedItem captures with canonical fractional values", async () => {
    await commitPwaLibraryCoreFeedItemCaptures(
      [
        {
          globalId: "item:1",
          platform: "rss",
          contentType: "article",
          capturedAt: 1_000,
          publishedAt: 900,
          author: {
            id: "author:1",
            handle: "author",
            displayName: "Author",
          },
          content: { text: "Text", mediaUrls: [], mediaTypes: [] },
          location: {
            name: "Somewhere",
            source: "geo_tag",
            coordinates: { lat: 1.5, lng: -2.25 },
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: [],
        },
      ],
      4_000,
    );

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelope = decodeCommit(commit)[0]!;
    expect(envelope.operation_type).toBe("feed_item_capture_upsert");
    expect(envelope.payload).toMatchObject({
      item: {
        location: {
          coordinates: {
            lat: { codec: "ieee754_binary64_hex_v1" },
            lng: { codec: "ieee754_binary64_hex_v1" },
          },
        },
      },
    });
  });

  it("commits FeedItem tombstones through the same SQLite transaction path", async () => {
    await commitPwaLibraryCoreFeedItemRemove("item:1", 5_000);

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    expect(decodeCommit(commit)[0]).toMatchObject({
      entity_id: "item:1",
      operation_type: "feed_item_remove",
      payload: { removed_at_ms: 5_000 },
    });
  });

  it("batches removal tombstones into bounded signed transactions", async () => {
    await commitPwaLibraryCoreFeedItemRemoves(["item:1", "item:2"], 5_001);
    await commitPwaLibraryCorePersonRemoves(["person:1", "person:2"], 5_002);
    await commitPwaLibraryCoreAccountRemoves(["account:1", "account:2"], 5_003);

    const commits = mocks.commitFollowerIntent.mock.calls.map(([commit]) =>
      decodeCommit(commit),
    );
    expect(
      commits.map((envelopes) =>
        envelopes.map((envelope) => envelope.entity_id),
      ),
    ).toEqual([
      ["item:1", "item:2"],
      ["person:1", "person:2"],
      ["account:1", "account:2"],
    ]);
    expect(
      commits.map((envelopes) =>
        envelopes.map((envelope) => envelope.transaction_member_count),
      ),
    ).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
  });

  it("commits annotations and analysis as distinct closed child sets", async () => {
    await commitPwaLibraryCoreFeedItemAnnotationSets(
      [
        {
          entityId: "item:1",
          highlights: [
            {
              createdAt: 5_000,
              note: "Remember",
              text: "Bounded passage",
              textBlobDigest: null,
            },
          ],
          tags: ["alpha", "research"],
        },
      ],
      5_100,
    );
    await commitPwaLibraryCoreFeedItemAnalysisSets(
      [
        {
          analysis: {
            content_signals: {
              inferred_at_ms: 5_000,
              method: "rules",
              scores: [
                {
                  score_basis_points: 8_750,
                  signal: "event",
                  tagged: true,
                },
              ],
              version: 1,
            },
            event_candidate: null,
          },
          entityId: "item:1",
        },
      ],
      5_200,
    );

    expect(mocks.commitFollowerIntent).toHaveBeenCalledTimes(2);
    expect(
      decodeCommit(mocks.commitFollowerIntent.mock.calls[0]![0])[0],
    ).toMatchObject({
      entity_id: "item:1",
      operation_type: "feed_item_annotations_replace",
      payload: {
        assigned_at_ms: 5_100,
        tags: ["alpha", "research"],
      },
    });
    expect(
      decodeCommit(mocks.commitFollowerIntent.mock.calls[1]![0])[0],
    ).toMatchObject({
      entity_id: "item:1",
      operation_type: "feed_item_analysis_replace",
      payload: {
        assigned_at_ms: 5_200,
        content_signals: {
          scores: [
            {
              score_basis_points: 8_750,
              signal: "event",
              tagged: true,
            },
          ],
        },
      },
    });
  });

  it("uses registered SQLite intents for remaining normalized record writes", async () => {
    await commitPwaLibraryCoreRssFeedUpsert(
      {
        url: "https://example.test/feed",
        title: "Example",
        enabled: true,
        trackUnread: true,
      },
      6_000,
    );
    await commitPwaLibraryCoreRssFeedRemove(
      "https://example.test/feed",
      true,
      6_001,
    );
    await commitPwaLibraryCoreRssFeedTitleAssignment(
      "https://example.test/feed",
      "Renamed",
      6_002,
    );
    await commitPwaLibraryCorePreferencesPatch(
      { display: { archivePruneDays: 14 } } as never,
      6_003,
    );
    await commitPwaLibraryCorePersonUpserts(
      [
        {
          id: "person:1",
          name: "Person",
          relationshipStatus: "friend",
          careLevel: 3,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      6_004,
    );
    await commitPwaLibraryCorePersonRemove("person:1", 6_005);
    await commitPwaLibraryCoreAccountUpserts(
      [
        {
          id: "account:1",
          kind: "social",
          provider: "instagram",
          externalId: "one",
          discoveredFrom: "manual_entry",
          firstSeenAt: 1,
          lastSeenAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      6_006,
    );
    await commitPwaLibraryCoreAccountRemove("account:1", 6_007);

    expect(
      mocks.commitFollowerIntent.mock.calls.map(
        ([commit]) => decodeCommit(commit)[0]!.operation_type,
      ),
    ).toEqual([
      "rss_feed_upsert",
      "rss_feed_remove_with_items",
      "rss_feed_title_assignment",
      "preferences_leaf_assignment",
      "person_upsert",
      "person_remove_and_accounts",
      "account_upsert",
      "account_remove",
    ]);
  });

  it("commits multiple RSS feeds as one homogeneous transaction", async () => {
    await commitPwaLibraryCoreRssFeedUpserts(
      [
        {
          url: "https://example.test/one",
          title: "One",
          enabled: true,
          trackUnread: true,
        },
        {
          url: "https://example.test/two",
          title: "Two",
          enabled: true,
          trackUnread: true,
        },
      ],
      7_000,
    );

    expect(mocks.commitFollowerIntent).toHaveBeenCalledOnce();
    expect(decodeCommit(mocks.commitFollowerIntent.mock.calls[0]![0])).toMatchObject([
      {
        entity_id: "https://example.test/one",
        operation_type: "rss_feed_upsert",
        transaction_member_count: 2,
        transaction_member_index: 0,
      },
      {
        entity_id: "https://example.test/two",
        operation_type: "rss_feed_upsert",
        transaction_member_count: 2,
        transaction_member_index: 1,
      },
    ]);
  });

  it("commits a bounded RSS removal page as one signed transaction", async () => {
    await commitPwaLibraryCoreRssFeedRemoves(
      ["https://a.example/feed", "https://b.example/feed"],
      false,
      7_000,
    );

    const commit = mocks.commitFollowerIntent.mock.calls[0]![0];
    const envelopes = decodeCommit(commit);
    expect(envelopes.map((envelope) => envelope.entity_id)).toEqual([
      "https://a.example/feed",
      "https://b.example/feed",
    ]);
    expect(envelopes.map((envelope) => envelope.operation_type)).toEqual([
      "rss_feed_remove_keep_items",
      "rss_feed_remove_keep_items",
    ]);
    expect(envelopes.map((envelope) => envelope.actor_sequence)).toEqual([
      4, 5,
    ]);
  });

  it("snapshots a whole Friend recovery and retries the same signed request after ambiguity", async () => {
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const person = { id: "person:one", name: "Selected", relationshipStatus: "friend" as const, careLevel: 3 as const, createdAt: 1, updatedAt: 2 };
    const account = { id: "account:one", personId: person.id, kind: "social" as const, provider: "instagram" as const, externalId: "one", discoveredFrom: "manual_entry" as const, firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 };
    const review = { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], entityId: person.id, operationType: "friend_replace", itemPresent: null, personState: "absent", rssFeedState: null,
      originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { accounts: [account], person } })) }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => {
      if (request.queryId === "person_root_v1") return { source: review.source, person: null };
      if (request.queryId === "person_account_page_v1") return { source: review.source, rows: [], nextCursor: null };
      if (request.queryId === "account_root_v1") return { source: review.source, account: null };
      return review;
    });
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const action = createPwaRecoveryFriendAction(review, person, [account]);
    person.name = "Changed later"; account.externalId = "Changed later";
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    expect(decodeCommit(request.intent)[0]).toMatchObject({ operation_type: "friend_replace", transaction_member_count: 1,
      payload: { person: { name: "Selected", createdAt: 1 }, accounts: [{ externalId: "one", createdAt: 1 }] } });
    await action();
    expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce();
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("commits one signed Friend replacement instead of partial Person and Account writes", async () => {
    const person = {
      id: "person:friend",
      name: "Friend",
      relationshipStatus: "friend" as const,
      careLevel: 3,
      createdAt: 1,
      updatedAt: 2,
    } satisfies Person;
    const account = {
      id: "account:friend",
      personId: person.id,
      kind: "social" as const,
      provider: "instagram" as const,
      externalId: "friend",
      discoveredFrom: "manual_entry" as const,
      firstSeenAt: 1,
      lastSeenAt: 2,
      createdAt: 1,
      updatedAt: 2,
    } satisfies Account;
    const inputAccounts = [...orderVector.binaryOrder].reverse().map(id => ({ ...account, id }));
    await commitPwaLibraryCoreFriendReplace(person, inputAccounts, 8_000);

    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce();
    const [envelope] = decodeCommit(
      mocks.commitFollowerIntent.mock.calls[0]![0],
    );
    expect(envelope).toMatchObject({
      entity_id: person.id,
      entity_type: "Person",
      operation_type: "friend_replace",
      payload: { accounts: orderVector.binaryOrder.map(id => ({ ...account, id })), person },
      transaction_member_count: 1,
    });
  });

  it("snapshots and encodes fractional preference weights before key access", async () => {
    const updates = { weights: { topics: { alpha: 0.125 } } };
    const pending = commitPwaLibraryCorePreferencesPatch(updates as never, 6000);
    updates.weights.topics.alpha = 0.5;
    await pending;
    expect(decodeCommit(mocks.commitFollowerIntent.mock.calls[0]![0])[0]).toMatchObject({
      operation_type: "preferences_leaf_assignment", payload: { updates: { weights: { topics: { alpha: { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } } },
    });
  });

  it("retries one ordered preference replacement without resigning or ordinary enqueue", async () => {
    const { createPwaRecoveryPreferenceAction } = await import("./library-core-pwa-follower-mutations");
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const patches: { display: Record<string, LibraryCoreCanonicalValue> }[] = [{ display: { reading: {}, showEngagementCounts: false } }, { display: { showEngagementCounts: true } }];
    const review = { ...fixture.response, memberCount: 2, nextCursor: null, outcome: { state: "unresolved" }, rows: patches.map((updates, index) => ({ ...fixture.response.rows[0], memberIndex: index,
      entityId: "preferences", operationType: "preferences_leaf_assignment", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "UserPreferences", blob_references: [], payload: { updates } })) })) } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "preferences_snapshot_v1" ? { source: review.source, rows: [] } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const action = createPwaRecoveryPreferenceAction(review, patches);
    patches[0]!.display.showEngagementCounts = true;
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const values = decodeCommit(request.intent);
    expect(values.map(value => value.payload)).toEqual([{ updates: { display: { reading: {}, showEngagementCounts: false } } }, { updates: { display: { showEngagementCounts: true } } }]);
    expect(values.map(value => value.transaction_member_index)).toEqual([0, 1]);
    await action(); expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledTimes(2);
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
    mocks.signFollowerOperation.mockClear();
    await expect(createPwaRecoveryPreferenceAction(review, [{ display: { showEngagementCounts: false } }, patches[1]])()).rejects.toThrow("without adding or dropping");
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ ...review, replacement: { replacementTransactionId: "existing" } });
    expect(await createPwaRecoveryPreferenceAction(review, patches)()).toEqual({ replacementTransactionId: "existing" });
    expect(mocks.signFollowerOperation).not.toHaveBeenCalled();
  });

  it("preserves historical reach-out times and retries one fresh signed transaction", async () => {
    const { createPwaRecoveryReachOutAction } = await import("./library-core-pwa-follower-mutations");
    const fixture = (await import("../../../shared/src/library-core/recovery-review-vector-v1.json")).default;
    const event = { channel: "email" as const, logged_at_ms: 1000, notes: "Historical" };
    const review = { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0], entityId: "person:event", operationType: "person_reach_out_append",
      originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", operation_id: "old:event", blob_references: [], payload: event })) }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
    mocks.query.mockImplementation(async request => request.queryId === "person_detail_v1" ? { source: review.source, person: { id: "person:event", name: "Current", reachOuts: [] } } : review);
    mocks.reapply.mockRejectedValueOnce(new Error("ambiguous")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
    const action = createPwaRecoveryReachOutAction(review, [{ personId: "person:event", originalOperationId: "old:event", archived: event, event }]);
    event.notes = "Changed later"; event.logged_at_ms = 9999;
    await expect(action()).rejects.toThrow("ambiguous");
    const request = mocks.reapply.mock.calls[0]![0];
    const envelope = decodeCommit(request.intent)[0];
    expect(envelope).toMatchObject({ operation_type: "person_reach_out_append", payload: { channel: "email", logged_at_ms: 1000, notes: "Historical" } });
    expect(envelope!.created_at_ms).toBeGreaterThan(1000);
    await action(); expect(mocks.reapply.mock.calls[1]![0]).toBe(request);
    expect(mocks.signFollowerOperation).toHaveBeenCalledOnce();
    expect(mocks.commitFollowerIntent).not.toHaveBeenCalled();
  });

  it("commits closed Person relationship mutations without rewriting a shell", async () => {
    await commitPwaLibraryCorePersonReachOutAppend(
      "person:friend",
      { channel: "email", loggedAt: 8_100, notes: "Follow up" },
      8_101,
    );
    let [envelope] = decodeCommit(mocks.commitFollowerIntent.mock.calls[0]![0]);
    expect(envelope).toMatchObject({
      entity_id: "person:friend",
      operation_type: "person_reach_out_append",
      payload: {
        channel: "email",
        logged_at_ms: 8_100,
        notes: "Follow up",
      },
    });

    mocks.commitFollowerIntent.mockClear();
    await commitPwaLibraryCoreAccountPersonAssignment(
      "account:friend",
      "person:friend",
      8_102,
    );
    [envelope] = decodeCommit(mocks.commitFollowerIntent.mock.calls[0]![0]);
    expect(envelope).toMatchObject({
      entity_id: "account:friend",
      operation_type: "account_person_assignment",
      payload: {
        assigned_at_ms: 8_102,
        person_id: "person:friend",
      },
    });
  });
});
