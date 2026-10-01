import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLibraryCoreSqliteQueryWorkerRequest, type LibraryCoreSqliteQueryRequest } from "@freed/shared/library-core";
const { query, account, person } = vi.hoisted(() => ({ query: vi.fn(), account: vi.fn(), person: vi.fn() }));
vi.mock("./jev-client", () => ({ isJevNative: true }));
vi.mock("./library-core-normalized-query-client", () => ({ queryNormalizedLibrary: (request: LibraryCoreSqliteQueryRequest) => {
  createLibraryCoreSqliteQueryWorkerRequest("jev-query-test", request);
  return query(request);
} }));
vi.mock("./library-core-item-detail-runtime", () => ({ readLibraryCoreAccountDetail: account, readLibraryCorePersonDetail: person }));
vi.mock("./jev-preview-library", () => ({}));
import { loadJevPreviewSample, assertJevSourceCurrent, loadJevPreviewRelationships } from "./jev-library";
const source = { generationId: "a".repeat(64), transitionSequence: 1, projectionRevision: 3 };
const card = (id: string, platform = "x") => ({
  globalId: id, platform, contentType: "post", authorId: "author", authorHandle: "author", authorDisplayName: "Author", authorAvatarUrl: null,
  archived: false, capturedAt: 1, publishedAt: 1, contentSignalTags: [], contentText: "Lossy card prefix", saved: false,
  readAt: null, liked: false, likedAt: null, likedSyncedAt: null, sourceUrl: null, tags: [], mediaTypes: [], mediaUrls: [],
  eventConfidenceBasisPoints: null, eventStartsAt: null, locationName: null, readingTimeMinutes: null,
  engagementComments: null, engagementLikes: null, linkPreviewTitle: null,
});

// Tier 1: bounded native reads, complete supplied evidence and fail-closed source checks before cloud contact.
describe("Jev native Library evaluation", () => {
  beforeEach(() => { query.mockReset(); account.mockReset(); person.mockReset(); });
  it("bounds each source window and reads body bytes instead of classifying a truncated card", async () => {
    query.mockImplementation(async request => {
      if (request.queryId === "optimistic_fields_v1") return { source, rows: [] };
      if (request.queryId === "feed_browse_page_v3") return { source, rows: Array.from({ length: 64 }, (_, i) => card(`${request.filter.platform}:${i}`, request.filter.platform)) };
      if (request.queryId === "item_detail_v1") return { source, item: { card: card(request.globalId, request.globalId.split(":")[0]) } };
      return { source, body: { bytesBase64: btoa("Complete stored source text"), contentLength: 27, startOffset: 0, endOffset: 27, storage: "inline", blobDigest: null } };
    });
    const items = await loadJevPreviewSample(500);
    expect(items).toHaveLength(100);
    expect(items.every(item => item.content.text === "Complete stored source text")).toBe(true);
    const requests = query.mock.calls.map(([request]) => request);
    expect(requests.filter(request => request.queryId === "feed_browse_page_v3")).toHaveLength(6);
    expect(requests.filter(request => request.queryId === "item_reader_body_v1").every(request => request.limitBytes === 32_004 && request.offsetBytes === 0)).toBe(true);
    await expect(assertJevSourceCurrent(items[0])).resolves.toBeUndefined();
    query.mockResolvedValue({ source: { ...source, projectionRevision: 4 }, item: { card: card(items[0].globalId) } });
    await expect(assertJevSourceCurrent(items[0])).rejects.toThrow("Library changed");
  });
  it("rejects an edited or hidden window before constructing a Jev batch", async () => {
    query.mockImplementation(async request => request.queryId === "optimistic_fields_v1" ? { source, rows: [] } : request.queryId === "feed_browse_page_v3"
      ? { source, rows: [card("x:one")] }
      : request.queryId === "item_detail_v1" ? { source: { ...source, projectionRevision: 4 }, item: { card: card("x:one") } }
        : { source, body: null });
    await expect(loadJevPreviewSample()).rejects.toThrow("Library changed");
  });
  it("excludes pending local archives and rejects an archive before sending loaded evidence", async () => {
    let archived = false;
    query.mockImplementation(async request => {
      if (request.queryId === "optimistic_fields_v1") return { source, rows: archived ? [{ entityId: "x:one", fieldPath: "archived", valueType: "boolean", value: true }] : [] };
      if (request.queryId === "feed_browse_page_v3") return { source, rows: request.filter.platform === "x" ? [card("x:one")] : [] };
      if (request.queryId === "item_detail_v1") return { source, item: { card: card("x:one") } };
      return { source, body: null };
    });
    const [item] = await loadJevPreviewSample();
    archived = true;
    await expect(assertJevSourceCurrent(item)).rejects.toThrow("no longer visible");
    await expect(loadJevPreviewSample()).resolves.toEqual([]);
  });
  it("uses exact account linkage and never guesses a relationship from an author name", async () => {
    const item = { globalId: "x:one", platform: "x", author: { id: "author" } } as Parameters<typeof loadJevPreviewRelationships>[0][number];
    account.mockResolvedValue(null);
    expect(await loadJevPreviewRelationships([item])).toEqual({ "x:one": { kind: "unknown" } });
    expect(person).not.toHaveBeenCalled();
    account.mockResolvedValue({ id: "social:x:author", kind: "social", provider: "x", externalId: "author", personId: "person-id" });
    person.mockResolvedValue({ id: "person-id", relationshipStatus: "friend", name: "Author" });
    expect(await loadJevPreviewRelationships([item])).toEqual({ "x:one": { kind: "friend", name: "Author" } });
    expect(account).toHaveBeenCalledWith("social:x:author");
  });
});
