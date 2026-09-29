import { decodeLibraryCoreFeedPageCursorV1, encodeLibraryCoreFeedPageCursorV1, isLibraryCoreEntityId, encodeLibraryCoreCanonicalValue, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { afterEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./library-core-sqlite-runtime", () => ({ queryPwaNormalizedLibrary: query }));
import { loadPwaRecoveryAccountRemovalDrafts, loadPwaRecoveryPersonRemovalDrafts, loadPwaRecoveryAccountLinkDrafts, loadPwaRecoveryRssUpsertDrafts, loadPwaRecoveryItemRemovalDrafts, loadPwaRecoveryRssRemovalDrafts, loadPwaRecoveryAnnotationDrafts, loadPwaRecoveryRssTitleDrafts } from "./library-core-pwa-recovery-editors";
import fixture from "../../../shared/src/library-core/recovery-review-vector-v1.json";
const source = fixture.response.source;
const url = "https://example.com/feed.xml";
function review() {
  return { ...fixture.response, memberCount: 1, nextCursor: null, outcome: { state: "unresolved" }, rows: [{ ...fixture.response.rows[0],
    entityId: url, operationType: "rss_feed_title_assignment", itemPresent: null,
    personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { title: "Archived name", assigned_at_ms: 1000 } })),
  }] } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
}
afterEach(() => query.mockReset());
describe("PWA preserved feed name editor", () => {
  it("loads archived and current names without fetching feeds and rejects a changed Library", async () => {
    const original = review();
    query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, feed: { title: "Current name" } });
    expect(await loadPwaRecoveryRssTitleDrafts(original)).toEqual({ replacement: null, drafts: [{ url, archivedTitle: "Archived name", title: "Archived name", currentTitle: "Current name" }] });
    expect(query.mock.calls.map(call => call[0].queryId)).toEqual(["recovery_intent_review_v1", "rss_feed_detail_v1"]);
    query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: { ...source, projectionRevision: 99 }, feed: { title: "Changed" } });
    await expect(loadPwaRecoveryRssTitleDrafts(original)).rejects.toThrow("Library changed");
  });
  it("preserves all members, refuses missing feeds, and returns a previous link before current reads", async () => {
    const original = review();
    query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], operationType: "feed_item_read_assignment" }] });
    await expect(loadPwaRecoveryRssTitleDrafts(original)).rejects.toThrow("No members were removed");
    query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, feed: null });
    await expect(loadPwaRecoveryRssTitleDrafts(original)).rejects.toThrow("no longer exists");
    const replacement = { replacementTransactionId: "already-stored" };
    query.mockReset(); query.mockResolvedValue({ ...original, replacement, source: { ...source, projectionRevision: 99 } });
    expect(await loadPwaRecoveryRssTitleDrafts(original)).toEqual({ replacement });
    expect(query).toHaveBeenCalledOnce();
  });
  it("stops between reads when the editor closes", async () => {
    const controller = new AbortController();
    query.mockImplementation(async () => { controller.abort(); return review(); });
    await expect(loadPwaRecoveryRssTitleDrafts(review(), controller.signal)).rejects.toThrow("closed");
    expect(query).toHaveBeenCalledOnce();
  });
  it("preserves full annotation sets and unloaded text references, refusing unsupported blobs", async () => {
    const payload = { assigned_at_ms: 1000, tags: ["alpha", "beta"], highlights: [
      { text: "A quote", textBlobDigest: null, note: "A note", createdAt: 500 },
      { text: null, textBlobDigest: "b".repeat(64), note: null, createdAt: 600 },
    ] };
    const original = { ...review(), rows: [{ ...review().rows[0]!, operationType: "feed_item_annotations_replace", itemPresent: true,
      personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: [], payload })),
    }] };
    query.mockResolvedValue(original);
    const result = await loadPwaRecoveryAnnotationDrafts(original);
    expect(result.drafts?.[0]).toMatchObject({ highlights: payload.highlights, tags: payload.tags });
    expect(query).toHaveBeenCalledOnce();
    query.mockResolvedValue({ ...original, rows: [{ ...original.rows[0], itemPresent: false }] });
    await expect(loadPwaRecoveryAnnotationDrafts(original)).rejects.toThrow("available items");
    query.mockResolvedValue({ ...original, rows: [{ ...original.rows[0], personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: ["unsupported"], payload })) }] });
    await expect(loadPwaRecoveryAnnotationDrafts(original)).rejects.toThrow("cannot be preserved");
  });

  it("retains unsubscribe deletion scope and refuses missing subscriptions without inferring acceptance", async () => {
    for (const includeItems of [false, true]) {
      const original = { ...review(), rows: [{ ...review().rows[0]!, operationType: includeItems ? "rss_feed_remove_with_items" : "rss_feed_remove_keep_items",
        personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { removed_at_ms: 1000 } })),
      }] };
      query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, feed: { title: "Current feed" } });
      expect(await loadPwaRecoveryRssRemovalDrafts(original)).toEqual({ replacement: null, drafts: [{ url, title: "Current feed", includeItems }] });
      query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, feed: null });
      await expect(loadPwaRecoveryRssRemovalDrafts(original)).rejects.toThrow("does not prove the original edit was accepted");
    }
  });

});

it("preserves absent deletion targets and rejects mixed transactions or accepted originals", async () => {
  const original = review();
  const row = { ...original.rows[0]!, operationType: "feed_item_remove", itemPresent: false,
    personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "FeedItem", blob_references: [], payload: { removed_at_ms: 1000 } })) };
  const removal = { ...original, rows: [row] };
  query.mockResolvedValueOnce(removal);
  expect((await loadPwaRecoveryItemRemovalDrafts(removal)).drafts?.map(value => [value.entityId, value.present])).toEqual([[url, false]]);
  query.mockResolvedValueOnce({ ...removal, rows: [{ ...row, operationType: "rss_feed_remove_keep_items" }] });
  await expect(loadPwaRecoveryItemRemovalDrafts(removal)).rejects.toThrow("No targets were removed");
  query.mockResolvedValueOnce({ ...removal, outcome: { state: "confirmed_accepted" } });
  await expect(loadPwaRecoveryItemRemovalDrafts(removal)).rejects.toThrow("already accepted");
});


it("loads full subscriptions from current values and refuses missing, mixed or stale targets", async () => {
  const archived = { url, title: "Archived", enabled: true, trackUnread: false, lastFetched: 1, pollInterval: 5 };
  const original = { ...review(), rows: [{ ...review().rows[0]!, operationType: "rss_feed_upsert",
    personState: null, rssFeedState: null, originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "RssFeed", blob_references: [], payload: { feed: archived } })) }] };
  const current = { ...archived, title: "Current", enabled: false, lastFetched: 900, pollInterval: 60,
    siteUrl: null, imageUrl: null, folder: null, sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, feed: current });
  const loaded = await loadPwaRecoveryRssUpsertDrafts(original);
  expect(loaded.drafts?.[0].archived).toEqual(archived);
  expect(loaded.drafts?.[0].feed).toEqual({ ...archived, title: "Current", enabled: false, lastFetched: 900, pollInterval: 60 });
  const absent = { ...original, rows: [{ ...original.rows[0], personState: null, rssFeedState: "absent" }] };
  query.mockResolvedValueOnce(absent).mockResolvedValueOnce({ source, feed: null });
  const fresh = await loadPwaRecoveryRssUpsertDrafts(original);
  expect(fresh.drafts?.[0].current).toBeNull();
  expect(fresh.drafts?.[0].feed).toEqual({ url: archived.url, title: archived.title, enabled: false, trackUnread: archived.trackUnread });
  query.mockResolvedValueOnce({ ...absent, rows: [{ ...absent.rows[0], personState: null, rssFeedState: "deleted" }] }).mockResolvedValueOnce({ source, feed: null });
  await expect(loadPwaRecoveryRssUpsertDrafts(original)).rejects.toThrow("was deleted");
  for (const response of [{ source, feed: null }, { source: { ...source, projectionRevision: 99 }, feed: current }]) {
    query.mockResolvedValueOnce(original).mockResolvedValueOnce(response);
    await expect(loadPwaRecoveryRssUpsertDrafts(original)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], operationType: "rss_feed_title_assignment" }] });
  await expect(loadPwaRecoveryRssUpsertDrafts(original)).rejects.toThrow("No members were removed");
  const replacement = { replacementTransactionId: "already-stored" };
  query.mockReset(); query.mockResolvedValue({ ...original, replacement });
  expect(await loadPwaRecoveryRssUpsertDrafts(original)).toEqual({ replacement });
  expect(query).toHaveBeenCalledOnce();
});

it("reviews account links without dropping absent people or allowing missing accounts and stale sources", async () => {
  const original = { ...review(), rows: [{ ...review().rows[0]!, entityId: "account:fixed", operationType: "account_person_assignment",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { assigned_at_ms: 100, person_id: "person:old" } })) }] };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, account: { id: "account:fixed", personId: null, displayName: "Account" } }).mockResolvedValueOnce({ source, person: null });
  expect((await loadPwaRecoveryAccountLinkDrafts(original)).drafts?.[0]).toMatchObject({ accountId: "account:fixed", current: { id: null, present: true }, archived: { id: "person:old", present: false } });
  for (const response of [{ source, account: null }, { source: { ...source, projectionRevision: 99 }, account: { id: "account:fixed", personId: null } }]) {
    query.mockResolvedValueOnce(original).mockResolvedValueOnce(response);
    await expect(loadPwaRecoveryAccountLinkDrafts(original)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], operationType: "person_upsert" }] });
  await expect(loadPwaRecoveryAccountLinkDrafts(original)).rejects.toThrow("No members were removed");
  const controller = new AbortController();
  query.mockResolvedValueOnce(original).mockImplementationOnce(async () => { controller.abort(); return { source, account: null }; });
  await expect(loadPwaRecoveryAccountLinkDrafts(original, controller.signal)).rejects.toThrow("closed");
});

it.each(["Person", "Account"] as const)("pins %s deletion detail to the review source, keeps absent targets and refuses mixed scope", async entity => {
  const load = entity === "Person" ? loadPwaRecoveryPersonRemovalDrafts : loadPwaRecoveryAccountRemovalDrafts;
  const key = entity === "Person" ? "person" : "account";
  const original = review();
  const row = { ...original.rows[0]!, operationType: entity === "Person" ? "person_remove_and_accounts" : "account_remove",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: entity, blob_references: [], payload: { removed_at_ms: 1000 } })) };
  const removal = { ...original, rows: [row] };
  query.mockResolvedValueOnce(removal).mockResolvedValueOnce({ source: original.source, [key]: null });
  expect((await load(removal)).drafts).toEqual([{ entityId: url, label: `${entity} (absent)`, present: false }]);
  for (const current of [{ source: { ...original.source, projectionRevision: 999 }, [key]: null }, { source: original.source, [key]: { id: "wrong", name: "Wrong" } }]) {
    query.mockResolvedValueOnce(removal).mockResolvedValueOnce(current);
    await expect(load(removal)).rejects.toThrow();
  }
  query.mockResolvedValueOnce({ ...removal, rows: [{ ...row, operationType: "person_remove_detach_accounts" }] });
  await expect(load(removal)).rejects.toThrow("No targets were removed");
  const controller = new AbortController();
  query.mockResolvedValueOnce(removal).mockImplementationOnce(async () => { controller.abort(); return { source: original.source, [key]: null }; });
  await expect(load(removal, controller.signal)).rejects.toThrow("QUERY_CANCELLED");
});

it("preserves absent Person records without image loads and refuses deleted or stale targets", async () => {
  const { loadPwaRecoveryPersonDrafts } = await import("./library-core-pwa-recovery-editors");
  const person = { id: "person:one", name: "Archived", avatarUrl: "https://example.com/avatar", relationshipStatus: "friend", careLevel: 3, createdAt: 1, updatedAt: 2 };
  const base = review();
  const original: LibraryCoreRecoveryIntentReviewResponseV1 = { ...base, rows: [{ ...base.rows[0]!, operationType: "person_upsert", entityId: person.id, personState: "absent", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", blob_references: [], payload: { person } })) }] };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source, person: null });
  const loaded = await loadPwaRecoveryPersonDrafts(original);
  expect(loaded.drafts?.[0].archived).toEqual(person);
  expect(loaded.drafts?.[0].person).not.toHaveProperty("avatarUrl");
  query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], personState: "deleted" }] });
  await expect(loadPwaRecoveryPersonDrafts(original)).rejects.toThrow("was deleted");
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: { ...source, projectionRevision: 999 }, person: null });
  await expect(loadPwaRecoveryPersonDrafts(original)).rejects.toThrow("CURSOR_STALE");
  const root: Partial<typeof person> = { ...person };
  delete root.avatarUrl;
  const current = { ...root, name: "Current", bio: "Current bio", notes: "Current notes", careLevel: 5, tags: ["current"], reachOutIntervalDays: 14, createdAt: 42, updatedAt: 99,
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "sample:current", generatedAt: 40, generatorVersion: 1 } };
  query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], personState: "present" }] }).mockResolvedValueOnce({ source, person: current });
  const present = await loadPwaRecoveryPersonDrafts(original);
  expect(present.drafts?.[0].person).toEqual({ id: person.id, name: "Current", bio: "Current bio", notes: "Current notes", relationshipStatus: "friend", careLevel: 5, tags: ["current"], reachOutIntervalDays: 14, createdAt: 42, updatedAt: 99,
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "sample:current", generatedAt: 40, generatorVersion: 1 } });
  expect(present.drafts?.[0].archived).toEqual(person);

  query.mockResolvedValueOnce({ ...original, rows: [{ ...original.rows[0], personState: "present" }] }).mockResolvedValueOnce({ source, person: { ...current, tags: Array.from({ length: 64 }, (_, i) => `tag:${i}`) } });
  expect((await loadPwaRecoveryPersonDrafts(original)).drafts?.[0].person.tags).toHaveLength(64);

});


it("retains complete Account roots, clears absent avatars, and refuses stale or mixed recovery", async () => {
  const { loadPwaRecoveryAccountDrafts } = await import("./library-core-pwa-recovery-editors");
  const one = review();
  const account = { id: "account:root", kind: "social", provider: "x", externalId: "external:one", discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2, avatarUrl: "https://example.com/avatar", address: "a".repeat(20000) };
  const member = { ...one.rows[0]!, entityId: account.id, operationType: "account_upsert", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Account", blob_references: [], payload: { account } })) };
  const original = { ...one, rows: [member], nextCursor: null };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: one.source, account: null });
  const absent = await loadPwaRecoveryAccountDrafts(one);
  expect(absent.drafts?.[0].archived).toEqual(account);
  expect(absent.drafts?.[0].account).toEqual({ ...account, avatarUrl: undefined });
  const current = { ...account, address: "b".repeat(20000), importedAt: 100 };
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: one.source, account: current });
  expect((await loadPwaRecoveryAccountDrafts(one)).drafts?.[0].account).toEqual(current);
  query.mockResolvedValueOnce(original).mockResolvedValueOnce({ source: { ...one.source, projectionRevision: 999 }, account: null });
  await expect(loadPwaRecoveryAccountDrafts(one)).rejects.toThrow("CURSOR_STALE");
  query.mockResolvedValueOnce({ ...original, rows: [{ ...member, operationType: "account_remove" }] });
  await expect(loadPwaRecoveryAccountDrafts(one)).rejects.toThrow("No members were removed");
});


it("keeps historical reach-out payloads and refuses retained originals, missing people and stale history", async () => {
 const { loadPwaRecoveryReachOutDrafts } = await import("./library-core-pwa-recovery-editors");
 const base = review();
 const event = { channel: "email", logged_at_ms: 1000, notes: "Historical note" };
 const member = { memberIndex: 0, entityId: "person:event", operationType: "person_reach_out_append", originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "Person", operation_id: "old:event", blob_references: [], payload: event })) };
 const original = { ...base, rows: [member], nextCursor: null } as unknown as LibraryCoreRecoveryIntentReviewResponseV1;
 const current = { source: base.source, person: { id: "person:event", name: "Current", reachOuts: [] } };
 query.mockResolvedValueOnce(original).mockResolvedValueOnce(current);
 const loaded = await loadPwaRecoveryReachOutDrafts(original, new AbortController().signal);
 expect(loaded.drafts).toEqual([{ personId: "person:event", originalOperationId: "old:event", archived: event, event }]);
 for (const invalid of [{ ...current, person: null }, { ...current, source: { ...base.source, projectionRevision: 999 } }, { ...current, person: { ...current.person, reachOuts: [{ reachOutId: "old:event", loggedAt: 1001, notes: "Changed" }] } }]) {
  query.mockResolvedValueOnce(original).mockResolvedValueOnce(invalid);
  await expect(loadPwaRecoveryReachOutDrafts(original, new AbortController().signal)).rejects.toThrow();
 }
 query.mockResolvedValueOnce({ ...original, rows: [{ ...member, operationType: "person_upsert" }] });
 await expect(loadPwaRecoveryReachOutDrafts(original, new AbortController().signal)).rejects.toThrow("No members were removed");
});

it("loads all preference members against one snapshot and returns stored replacement before current reads", async () => {
  const { loadPwaRecoveryPreferenceDrafts } = await import("./library-core-pwa-recovery-editors");
  const original = { ...review(), memberCount: 2 };
  const prefRow = (index: number, value: boolean) => ({ ...original.rows[0]!, memberIndex: index, operationType: "preferences_leaf_assignment", entityId: "preferences",
    originalEnvelopeJson: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ entity_type: "UserPreferences", blob_references: [], payload: { updates: { display: { showEngagementCounts: value } } } })) });
  const cursor = decodeLibraryCoreFeedPageCursorV1(fixture.response.nextCursor);
  if (!cursor.ok) throw new Error(cursor.error);
  const globalId = `${cursor.value.globalId}:original`;
  if (!isLibraryCoreEntityId(globalId)) throw new Error("Invalid fixture cursor");
  const first = { ...original, rows: [prefRow(0, false)], nextCursor: encodeLibraryCoreFeedPageCursorV1({ ...cursor.value, globalId }) };
  const last = { ...original, rows: [prefRow(1, true)], nextCursor: null };
  query.mockResolvedValueOnce(first).mockResolvedValueOnce({ source, rows: [] }).mockResolvedValueOnce(last);
  const loaded = await loadPwaRecoveryPreferenceDrafts(original);
  expect(loaded.drafts?.map(draft => draft.fields[0]?.archived)).toEqual([false, true]);
  expect(query.mock.calls.map(([request]) => request.queryId)).toEqual(["recovery_intent_review_v1", "preferences_snapshot_v1", "recovery_intent_review_v1"]);
  query.mockReset();
  query.mockResolvedValueOnce(first).mockResolvedValueOnce({ source, rows: [] }).mockResolvedValueOnce({ ...last, source: { ...source, projectionRevision: 99 } });
  await expect(loadPwaRecoveryPreferenceDrafts(original)).rejects.toThrow("Library changed");
  query.mockReset();
  const replacement = { replacementTransactionId: "stored-replacement" };
  query.mockResolvedValueOnce({ ...first, replacement, source: { ...source, projectionRevision: 99 } });
  expect(await loadPwaRecoveryPreferenceDrafts(original)).toEqual({ replacement });
  expect(query).toHaveBeenCalledOnce();
});
