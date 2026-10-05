import { expect, it, vi } from "vitest";
import { readLibraryCoreNormalizedPersonDetailV1, readLibraryCoreNormalizedFriendDetailV1 } from "./normalized-surface-readers.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
const root = { id: "person-1", name: "Ada", relationshipStatus: "friend", careLevel: 3, createdAt: 1, updatedAt: 2, tags: Array.from({ length: 65 }, (_, i) => `tag-${i}`) };
const detail = { source, linkedAccountCount: 0, linkedAccounts: [], person: { ...root, avatarUrl: null, bio: null, notes: null, reachOutIntervalDays: null, sampleBatchId: null, sampleGeneratedAt: null, sampleGeneratorVersion: null, tags: root.tags.slice(0, 64), reachOuts: [{ loggedAt: 3, channel: null, notes: "history" }] } };
it("initializes Person and Friend editors with all tags and separately bounded history", async () => {
  for (const read of [readLibraryCoreNormalizedPersonDetailV1, readLibraryCoreNormalizedFriendDetailV1]) {
    const query = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce({ source, person: root });
    const result = await read({ query } as unknown as LibraryCoreNormalizedReaderRuntime, root.id);
    expect(result?.tags).toEqual(root.tags);
    expect(result?.reachOutLog).toEqual([{ loggedAt: 3, notes: "history" }]);
    expect(query.mock.calls.map(([request]) => request.queryId)).toEqual(["person_detail_v1", "person_root_v1"]);
  }
});
it("refuses mixed source revisions and changed presence before returning an editable root", async () => {
  for (const response of [{ source: { ...source, projectionRevision: 8 }, person: root }, { source, person: null }]) {
    const query = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    await expect(readLibraryCoreNormalizedFriendDetailV1({ query } as unknown as LibraryCoreNormalizedReaderRuntime, root.id)).rejects.toThrow("CURSOR_STALE");
  }
});
