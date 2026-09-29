import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { encodeLibraryCoreCanonicalValue, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const query = vi.hoisted(() => vi.fn());
vi.mock("./library-core-normalized-query-client", () => ({ queryNormalizedLibrary: query, createDesktopLibraryCoreOperationId: () => "editor-operation" }));
import { loadRecoveryRssTitleDrafts, loadRecoveryRssRemovalDrafts, loadRecoveryRssUpsertDrafts } from "./library-core-recovery-rss-editor";
// jsdom and Node expose different Uint8Array realms. Match browser encoding.
const NativeTextEncoder = TextEncoder;
beforeAll(() => vi.stubGlobal("TextEncoder", class extends NativeTextEncoder {
  override encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(super.encode(input)); }
}));
afterAll(() => vi.unstubAllGlobals());
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const review = { recoveryId: "b".repeat(64), transactionId: "archived:titles", archiveDigest: "c".repeat(64), transactionDigest: "d".repeat(64), memberCount: 2,
  replacement: null, outcome: { state: "unresolved" }, source } as LibraryCoreRecoveryIntentReviewResponseV1;
const row = (index: number) => ({ memberIndex: index, operationType: "rss_feed_title_assignment", entityId: `https://example.com/${index}`,
  personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { title: `Old ${index}`, assigned_at_ms: 100 } })) });
beforeEach(() => { query.mockReset(); });
it("keeps complete ordered title drafts and canonical current context across payload pages", async () => {
  query.mockResolvedValueOnce({ ...review, rows: [row(0)], nextCursor: "next" })
    .mockResolvedValueOnce({ source: { ...source, transitionSequence: 7 }, feed: { title: "Current zero" } })
    .mockResolvedValueOnce({ ...review, rows: [row(1)], nextCursor: null })
    .mockResolvedValueOnce({ source, feed: { title: "Current one" } });
  const loaded = await loadRecoveryRssTitleDrafts(review, new AbortController().signal);
  expect(loaded.drafts?.map((draft) => [draft.archivedTitle, draft.currentTitle])).toEqual([["Old 0", "Current zero"], ["Old 1", "Current one"]]);
  expect(query.mock.calls[0][0]).toMatchObject({ includeOriginal: true });
  expect(query.mock.calls[2][0]).toMatchObject({ cursor: "next" });
  expect(query.mock.calls.every(([request]) => ["recovery_intent_review_v1", "rss_feed_detail_v1"].includes(request.queryId))).toBe(true);
});
it("rejects changed sources, missing feeds and mixed transactions without dropping members", async () => {
  for (const changed of [{ ...review, source: { ...source, transitionSequence: 10 }, rows: [row(0)] },
    { ...review, rows: [{ ...row(0), operationType: "feed_item_remove" }] }]) {
    query.mockResolvedValueOnce(changed);
    await expect(loadRecoveryRssTitleDrafts(review, new AbortController().signal)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...review, rows: [row(0)], nextCursor: null }).mockResolvedValueOnce({ source, feed: null });
  await expect(loadRecoveryRssTitleDrafts(review, new AbortController().signal)).rejects.toThrow("no longer exists");
  const controller = new AbortController(); controller.abort();
  query.mockResolvedValueOnce({ ...review, rows: [row(0)], nextCursor: null });
  await expect(loadRecoveryRssTitleDrafts(review, controller.signal)).rejects.toThrow("QUERY_CANCELLED");
});

it("preserves every annotation, tag and blob locator and refuses missing or mixed members", async () => {
  const { loadRecoveryAnnotationDrafts } = await import("./library-core-recovery-annotation-editor");
  const highlights = [
    { createdAt: 1, note: "Item note", text: "\u2063", textBlobDigest: null },
    { createdAt: 2, note: "Quote note", text: "Quotation", textBlobDigest: null },
    { createdAt: 3, note: null, text: null, textBlobDigest: "e".repeat(64) },
  ];
  const member = { ...row(0), operationType: "feed_item_annotations_replace", itemPresent: true, itemText: "An article",
    personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: [], payload: { assigned_at_ms: 10, highlights, tags: ["alpha", "zebra"] } })) };
  const one = { ...review, memberCount: 1 };
  query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null });
  const loaded = await loadRecoveryAnnotationDrafts(one, new AbortController().signal);
  expect(loaded.drafts?.[0]).toMatchObject({ highlights, tags: ["alpha", "zebra"] });
  expect(query).toHaveBeenCalledTimes(1); // Current context is read only for the selected item.
  for (const invalid of [{ ...member, itemPresent: false }, { ...member, operationType: "feed_item_remove" }]) {
    query.mockResolvedValueOnce({ ...one, rows: [invalid], nextCursor: null });
    await expect(loadRecoveryAnnotationDrafts(one, new AbortController().signal)).rejects.toThrow();
  }
});

it("retains unsubscribe scope and refuses missing feeds without claiming original acceptance", async () => {
  const one = { ...review, memberCount: 1 };
  for (const includeItems of [false, true]) {
    const member = { ...row(0), operationType: includeItems ? "rss_feed_remove_with_items" : "rss_feed_remove_keep_items",
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { removed_at_ms: 10 } })) };
    query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce({ source, feed: { title: "Current feed" } });
    const loaded = await loadRecoveryRssRemovalDrafts(one, new AbortController().signal);
    expect(loaded.drafts).toEqual([{ url: member.entityId, title: "Current feed", includeItems }]);
    query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce({ source, feed: null });
    await expect(loadRecoveryRssRemovalDrafts(one, new AbortController().signal)).rejects.toThrow("does not prove");
  }
});

it("retains ordered item deletion targets including absent items and refuses mixed scope", async () => {
  const { loadRecoveryItemRemovalDrafts } = await import("./library-core-recovery-item-editor");
  const member = (index: number, present: boolean) => ({ ...row(index), operationType: "feed_item_remove", itemPresent: present, itemText: "Current item",
    personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: [], payload: { removed_at_ms: 10 } })) });
  query.mockResolvedValueOnce({ ...review, rows: [member(0, true)], nextCursor: "next" })
    .mockResolvedValueOnce({ ...review, rows: [member(1, false)], nextCursor: null });
  const loaded = await loadRecoveryItemRemovalDrafts(review, new AbortController().signal);
  expect(loaded.drafts?.map((draft) => [draft.entityId, draft.present])).toEqual([[row(0).entityId, true], [row(1).entityId, false]]);
  query.mockResolvedValueOnce({ ...review, rows: [member(0, true), { ...member(1, false), operationType: "rss_feed_remove_with_items" }], nextCursor: null });
  await expect(loadRecoveryItemRemovalDrafts(review, new AbortController().signal)).rejects.toThrow("No targets were removed");
});


it("reviews whole RSS upserts with current defaults and preserves current history and provenance", async () => {
  const one = { ...review, memberCount: 1 };
  const archived = { url: row(0).entityId, title: "Archived", enabled: true, trackUnread: false, lastFetched: 1, pollInterval: 5 };
  const member = { ...row(0), operationType: "rss_feed_upsert", personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { feed: archived } })) };
  const current = { ...archived, title: "Current", enabled: false, lastFetched: 900, pollInterval: 60,
    siteUrl: null, imageUrl: null, folder: null, sampleBatchId: "batch:current", sampleGeneratedAt: 800, sampleGeneratorVersion: 1 };
  query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce({ source, feed: current });
  const loaded = await loadRecoveryRssUpsertDrafts(one, new AbortController().signal);
  expect(loaded.drafts?.[0].archived).toEqual(archived);
  expect(loaded.drafts?.[0].feed).toEqual({ url: archived.url, title: "Current", enabled: false, trackUnread: false, lastFetched: 900, pollInterval: 60,
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "batch:current", generatedAt: 800, generatorVersion: 1 } });
  const absent = { ...one, rows: [{ ...member, personState: null, rssFeedState: "absent" }], nextCursor: null };
  query.mockResolvedValueOnce(absent).mockResolvedValueOnce({ source, feed: null });
  const fresh = await loadRecoveryRssUpsertDrafts(one, new AbortController().signal);
  expect(fresh.drafts?.[0].current).toBeNull();
  expect(fresh.drafts?.[0].feed).toEqual({ url: archived.url, title: archived.title, enabled: false, trackUnread: archived.trackUnread });
  query.mockResolvedValueOnce({ ...absent, rows: [{ ...absent.rows[0], personState: null, rssFeedState: "deleted" }] }).mockResolvedValueOnce({ source, feed: null });
  await expect(loadRecoveryRssUpsertDrafts(one, new AbortController().signal)).rejects.toThrow("was deleted");
  for (const result of [{ source, feed: null }, { source: { ...source, projectionRevision: 8 }, feed: current }]) {
    query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce(result);
    await expect(loadRecoveryRssUpsertDrafts(one, new AbortController().signal)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...one, rows: [{ ...member, operationType: "rss_feed_title_assignment" }], nextCursor: null });
  await expect(loadRecoveryRssUpsertDrafts(one, new AbortController().signal)).rejects.toThrow("No members were removed");
});


it("reviews complete account links with current people and preserves absent archived destinations", async () => {
  const { loadRecoveryAccountLinkDrafts } = await import("./library-core-recovery-account-editor");
  const member = (index: number) => ({ ...row(index), entityId: "account:fixed", operationType: "account_person_assignment",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { assigned_at_ms: 100, person_id: index === 0 ? "person:old" : null } })) });
  query.mockResolvedValueOnce({ ...review, rows: [member(0), member(1)], nextCursor: null })
    .mockResolvedValueOnce({ source, account: { id: "account:fixed", personId: "person:current", displayName: "Account" } })
    .mockResolvedValueOnce({ source, person: { name: "Current" } }).mockResolvedValueOnce({ source, person: null })
    .mockResolvedValueOnce({ source, account: { id: "account:fixed", personId: null, displayName: "Account" } });
  const result = await loadRecoveryAccountLinkDrafts(review, new AbortController().signal);
  expect(result.drafts?.map(d => [d.accountId, d.current.id, d.archived.id, d.archived.present])).toEqual([
    ["account:fixed", "person:current", "person:old", false], ["account:fixed", null, null, true],
  ]);
  for (const response of [{ source, account: null }, { source: { ...source, projectionRevision: 8 }, account: { id: "account:fixed", personId: null } }]) {
    query.mockResolvedValueOnce({ ...review, rows: [member(0)], nextCursor: null }).mockResolvedValueOnce(response);
    await expect(loadRecoveryAccountLinkDrafts(review, new AbortController().signal)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...review, rows: [{ ...member(0), operationType: "person_upsert" }], nextCursor: null });
  await expect(loadRecoveryAccountLinkDrafts(review, new AbortController().signal)).rejects.toThrow("No members were removed");
});

it.each(["Person", "Account"] as const)("retains %s deletion targets, pins current detail source and refuses mixed scope", async entity => {
  const loaders = await import("./library-core-recovery-item-editor");
  const load = entity === "Person" ? loaders.loadRecoveryPersonRemovalDrafts : loaders.loadRecoveryAccountRemovalDrafts;
  const key = entity === "Person" ? "person" : "account";
  const label = entity === "Person" ? "name" : "displayName";
  const member = (index: number) => ({ ...row(index), operationType: entity === "Person" ? "person_remove_and_accounts" : "account_remove",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: entity, blob_references: [], payload: { removed_at_ms: 10 } })) });
  query.mockResolvedValueOnce({ ...review, rows: [member(0), member(1)], nextCursor: null })
    .mockResolvedValueOnce({ source, [key]: { id: row(0).entityId, [label]: "Current target" } })
    .mockResolvedValueOnce({ source, [key]: null });
  const result = await load(review, new AbortController().signal);
  expect(result.drafts).toEqual([{ entityId: row(0).entityId, label: "Current target", present: true }, { entityId: row(1).entityId, label: `${entity} (absent)`, present: false }]);
  for (const current of [{ source: { ...source, projectionRevision: 8 }, [key]: null }, { source, [key]: { id: "wrong", [label]: "Wrong" } }]) {
    query.mockResolvedValueOnce({ ...review, rows: [member(0)], nextCursor: null }).mockResolvedValueOnce(current);
    await expect(load(review, new AbortController().signal)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...review, rows: [{ ...member(0), operationType: "person_remove_detach_accounts" }], nextCursor: null });
  await expect(load(review, new AbortController().signal)).rejects.toThrow("No targets were removed");
  const controller = new AbortController();
  query.mockResolvedValueOnce({ ...review, rows: [member(0)], nextCursor: null }).mockImplementationOnce(async () => { controller.abort(); return { source, [key]: null }; });
  await expect(load(review, controller.signal)).rejects.toThrow("QUERY_CANCELLED");
});

it("preserves absent Person roots without restoring avatar loads and rejects tombstones or unknown fields", async () => {
  const { loadRecoveryPersonDrafts } = await import("./library-core-recovery-person-editor");
  const one = { ...review, memberCount: 1 };
  const person = { id: "person:one", name: "Archived", avatarUrl: "https://example.com/avatar", relationshipStatus: "friend", careLevel: 3, createdAt: 1, updatedAt: 2, tags: ["one"] };
  const member = { ...row(0), entityId: person.id, operationType: "person_upsert", personState: "absent", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { person } })) };
  query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce({ source, person: null });
  const result = await loadRecoveryPersonDrafts(one, new AbortController().signal);
  expect(result.drafts?.[0].archived).toEqual(person);
  expect(result.drafts?.[0].person).toEqual({ ...person, avatarUrl: undefined });
  expect(result.drafts?.[0].current).toBeNull();
  query.mockResolvedValueOnce({ ...one, rows: [{ ...member, personState: "deleted" }], nextCursor: null });
  await expect(loadRecoveryPersonDrafts(one, new AbortController().signal)).rejects.toThrow("was deleted");
  query.mockResolvedValueOnce({ ...one, rows: [{ ...member, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { person: { ...person, unknown: "keep me" } } })) }], nextCursor: null });
  await expect(loadRecoveryPersonDrafts(one, new AbortController().signal)).rejects.toThrow("No members were removed");
  query.mockResolvedValueOnce({ ...one, rows: [member], nextCursor: null }).mockResolvedValueOnce({ source: { ...source, projectionRevision: 8 }, person: null });
  await expect(loadRecoveryPersonDrafts(one, new AbortController().signal)).rejects.toThrow("CURSOR_STALE");
  const { avatarUrl: _archivedAvatar, ...root } = person;
  const current = { ...root, name: "Current", bio: "Current bio", notes: "Current notes", careLevel: 5, tags: ["current"], reachOutIntervalDays: 14, createdAt: 42, updatedAt: 99,
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "sample:current", generatedAt: 40, generatorVersion: 1 } };
  query.mockResolvedValueOnce({ ...one, rows: [{ ...member, personState: "present" }], nextCursor: null }).mockResolvedValueOnce({ source, person: current });
  const present = await loadRecoveryPersonDrafts(one, new AbortController().signal);
  expect(present.drafts?.[0].person).toEqual({ id: person.id, name: "Current", bio: "Current bio", notes: "Current notes", relationshipStatus: "friend", careLevel: 5, tags: ["current"], reachOutIntervalDays: 14, createdAt: 42, updatedAt: 99,
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "sample:current", generatedAt: 40, generatorVersion: 1 } });
  expect(present.drafts?.[0].archived).toEqual(person);

  query.mockResolvedValueOnce({ ...one, rows: [{ ...member, personState: "present" }], nextCursor: null }).mockResolvedValueOnce({ source, person: { ...current, tags: Array.from({ length: 64 }, (_, i) => `tag:${i}`) } });
  expect((await loadRecoveryPersonDrafts(one, new AbortController().signal)).drafts?.[0].person.tags).toHaveLength(64);

});

it("loads complete Friend account choices from exact current rows without trusting display projections", async () => {
  const { loadRecoveryFriendDraft } = await import("./library-core-recovery-friend-editor");
  const one = { ...review, memberCount: 1 };
  const person = { id: "person:one", name: "Archived", relationshipStatus: "friend", careLevel: 3, createdAt: 1, updatedAt: 2 };
  const account = { id: "account:archived", personId: person.id, kind: "social", provider: "instagram", externalId: "old", discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, avatarUrl: "https://example.com/avatar" };
  const member = { ...row(0), operationType: "friend_replace", entityId: person.id, personState: "present", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { person, accounts: [account] } })) };
  const current = { ...account, id: "account:linked", externalId: "current", followRosterActive: true, followRosterRoles: ["following"], followRosterSyncedAt: 8,
    displayName: "Exact current", sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "current-batch", generatedAt: 3, generatorVersion: 1 } };
  const install = (count = 1, revision = 7) => query.mockImplementation(async request => {
    if (request.queryId === "recovery_intent_review_v1") return { ...one, rows: [member], nextCursor: null };
    if (request.queryId === "person_root_v1") return { source, person: { ...person, name: "Current", tags: Array.from({ length: 65 }, (_, i) => `tag:${i}`) } };
    if (request.queryId === "person_account_page_v1") return { source, nextCursor: count > 1 ? "more" : null, rows: [{ accountId: current.id }] };
    return { source: { ...source, projectionRevision: revision }, account: request.accountId === current.id ? current : null };
  });
  install();
  const loaded = await loadRecoveryFriendDraft(one, new AbortController().signal);
  expect(loaded.draft?.person.tags).toHaveLength(65);
  expect(loaded.draft?.accounts.map(a => [a.id, a.selected])).toEqual([[account.id, false], [current.id, true]]);
  expect(loaded.draft?.accounts[0]?.archived).toEqual(account);
  expect(loaded.draft?.accounts[0]?.account.avatarUrl).toBeUndefined();
  expect(loaded.draft?.accounts[1]?.account).toMatchObject({ displayName: "Exact current", followRosterActive: true, followRosterRoles: ["following"], sampleDataFingerprint: { batchId: "current-batch" } });
  install(65);
  const paged = await loadRecoveryFriendDraft(one, new AbortController().signal);
  expect(paged.draft?.paged?.first.accounts).toHaveLength(1);
  expect(paged.draft?.accounts.every(row => !row.selected)).toBe(true);
  install(1, 8);
  await expect(loadRecoveryFriendDraft(one, new AbortController().signal)).rejects.toThrow("CURSOR_STALE");
  await expect(loadRecoveryFriendDraft(review, new AbortController().signal)).rejects.toThrow("single-member");
});


it("retains complete Account roots, clears absent avatars, and refuses stale or mixed recovery", async () => {
  const { loadRecoveryAccountDrafts } = await import("./library-core-recovery-account-upsert-editor");
  const one = { ...review, memberCount: 1, rows: [{ ...row(0), assigned: null, assignedAt: null, authorName: null, createdAt: 1000, itemPresent: null, itemText: null, readAt: null }] };
  const account = { id: "account:root", kind: "social", provider: "x", externalId: "external:one", discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, avatarUrl: "https://example.com/avatar", address: "a".repeat(20000) };
  const member = { ...one.rows[0]!, entityId: account.id, operationType: "account_upsert", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { account } })) };
  const original = { ...one, rows: [member], nextCursor: null };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: one.source, account: null });
  const absent = await loadRecoveryAccountDrafts(one, new AbortController().signal);
  expect(absent.drafts?.[0].archived).toEqual(account);
  expect(absent.drafts?.[0].account).toEqual({ ...account, avatarUrl: undefined });
  const current = { ...account, address: "b".repeat(20000), importedAt: 100 };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: one.source, account: current });
  expect((await loadRecoveryAccountDrafts(one, new AbortController().signal)).drafts?.[0].account).toEqual(current);
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: { ...one.source, projectionRevision: 999 }, account: null });
  await expect(loadRecoveryAccountDrafts(one, new AbortController().signal)).rejects.toThrow("CURSOR_STALE");
  query.mockResolvedValueOnce({ ...original, rows: [{ ...member, operationType: "account_remove" }] });
  await expect(loadRecoveryAccountDrafts(one, new AbortController().signal)).rejects.toThrow("No members were removed");
});


it("keeps historical reach-out payloads and refuses retained originals, missing people and stale history", async () => {
 const { loadRecoveryReachOutDrafts } = await import("./library-core-recovery-reach-out-editor");
 const base = { ...review, memberCount: 1 };
 const event = { channel: "email", logged_at_ms: 1000, notes: "Historical note" };
 const member = { memberIndex: 0, entityId: "person:event", operationType: "person_reach_out_append", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", operation_id: "old:event", blob_references: [], payload: event })) };
 const original = { ...base, rows: [member], nextCursor: null } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
 const current = { source: base.source, person: { id: "person:event", name: "Current", reachOuts: [] } };
 query.mockResolvedValueOnce(original).mockResolvedValueOnce(current);
 const loaded = await loadRecoveryReachOutDrafts(original, new AbortController().signal);
 expect(loaded.drafts).toEqual([{ personId: "person:event", originalOperationId: "old:event", archived: event, event }]);
 for (const invalid of [{ ...current, person: null }, { ...current, source: { ...base.source, projectionRevision: 999 } }, { ...current, person: { ...current.person, reachOuts: [{ reachOutId: "old:event", loggedAt: 1001, notes: "Changed" }] } }]) {
  query.mockResolvedValueOnce(original).mockResolvedValueOnce(invalid);
  await expect(loadRecoveryReachOutDrafts(original, new AbortController().signal)).rejects.toThrow();
 }
 query.mockResolvedValueOnce({ ...original, rows: [{ ...member, operationType: "person_upsert" }] });
 await expect(loadRecoveryReachOutDrafts(original, new AbortController().signal)).rejects.toThrow("No members were removed");
});

it("loads complete preference transactions against one snapshot and returns stored replacements first", async () => {
  const { loadRecoveryPreferenceDrafts } = await import("./library-core-recovery-preference-editor");
  const prefRow = (index: number, value: boolean) => ({ ...row(index), operationType: "preferences_leaf_assignment", entityId: "preferences",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "UserPreferences", blob_references: [], payload: { updates: { display: { showEngagementCounts: value } } } })) });
  const first = { ...review, rows: [prefRow(0, false)], nextCursor: "next" };
  const last = { ...review, rows: [prefRow(1, true)], nextCursor: null };
  query.mockResolvedValueOnce(first).mockResolvedValueOnce({ source, rows: [] }).mockResolvedValueOnce(last);
  const loaded = await loadRecoveryPreferenceDrafts(review, new AbortController().signal);
  expect(loaded.drafts?.map(draft => draft.fields[0]?.archived)).toEqual([false, true]);
  expect(query.mock.calls.map(([request]) => request.queryId)).toEqual(["recovery_intent_review_v1", "preferences_snapshot_v1", "recovery_intent_review_v1"]);
  query.mockReset();
  query.mockResolvedValueOnce(first).mockResolvedValueOnce({ source, rows: [] }).mockResolvedValueOnce({ ...last, source: { ...source, projectionRevision: 8 } });
  await expect(loadRecoveryPreferenceDrafts(review, new AbortController().signal)).rejects.toThrow("CURSOR_STALE");
  query.mockReset();
  const replacement = { replacementTransactionId: "stored-replacement" };
  query.mockResolvedValueOnce({ ...first, replacement, source: { ...source, projectionRevision: 99 } });
  expect(await loadRecoveryPreferenceDrafts(review, new AbortController().signal)).toEqual({ replacement });
  expect(query).toHaveBeenCalledOnce();
});
