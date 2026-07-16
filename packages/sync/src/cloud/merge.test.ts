import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import {
  addFeedItem,
  addRssFeed,
  createEmptyDoc,
  getRegisteredDesktopClientIds,
  registerDesktopClient,
  type FreedDoc,
} from "@freed/shared/schema";
import { mergeBinaries } from "./merge.js";

type FeedItem = Parameters<typeof addFeedItem>[1];

function makeItem(globalId = "rss:forward-compatible-merge"): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "article",
    capturedAt: 1_000,
    publishedAt: 1_000,
    author: {
      id: "author",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: "Forward compatible merge",
      mediaUrls: [],
      mediaTypes: [],
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

describe("cloud binary merge compatibility", () => {
  it("keeps native feed deletion and other merged state", () => {
    let base = createEmptyDoc();
    base = A.change(base, "Seed shared state", (draft) => {
      addFeedItem(draft, makeItem());
      const root = draft as unknown as Record<string, unknown>;
      root.futureLibraryState = {
        localValue: 0,
        incomingValue: 0,
      };
      root.futureRemovedState = { values: ["restore", "me"] };
    });
    base = registerDesktopClient(base, {
      id: "desktop-shared",
      registeredAt: 1_000,
    });

    const local = A.change(A.clone(base), "Update future root locally", (draft) => {
      const future = (draft as unknown as Record<string, unknown>)
        .futureLibraryState as Record<string, number>;
      future.localValue = 1;
    });
    const incoming = A.change(A.clone(base), "Delete feed and update future root", (draft) => {
      delete draft.feedItems["rss:forward-compatible-merge"];
      addRssFeed(draft, {
        url: "https://local.example/feed.xml",
        title: "Local only",
        enabled: true,
        trackUnread: false,
      });
      draft.preferences.display.themeId = "midas";
      draft.preferences.weights.recency = 73;
      const root = draft as unknown as Record<string, unknown>;
      delete root.futureRemovedState;
      delete root["desktopClient:desktop-shared"];
      const future = root.futureLibraryState as Record<string, number>;
      future.incomingValue = 1;
    });

    const result = A.load<FreedDoc>(
      mergeBinaries(A.save(local), A.save(incoming)),
    );
    const plain = A.toJS(result) as unknown as Record<string, unknown>;

    expect(result.feedItems["rss:forward-compatible-merge"]).toBeUndefined();
    expect(plain.futureLibraryState).toEqual({
      localValue: 1,
      incomingValue: 1,
    });
    expect(result.rssFeeds["https://local.example/feed.xml"]?.title).toBe("Local only");
    expect(result.preferences.display.themeId).toBe("midas");
    expect(result.preferences.weights.recency).toBe(73);
    expect(plain.futureRemovedState).toBeUndefined();
    expect(getRegisteredDesktopClientIds(result)).toEqual([]);
    expect(A.hasHeads(result, A.getHeads(local))).toBe(true);
    expect(A.hasHeads(result, A.getHeads(incoming))).toBe(true);
  });

  it("restores only feed items after a large merge is blocked for resolving to empty", () => {
    let base = createEmptyDoc();
    base = A.change(base, "Seed populated feed", (draft) => {
      for (let index = 0; index < 600; index += 1) {
        addFeedItem(draft, makeItem(`rss:cloud-item-${index}`));
      }
      const root = draft as unknown as Record<string, unknown>;
      root.futureLibraryState = {
        localValue: 0,
        incomingValue: 0,
      };
      root.futureRemovedState = { values: ["remove", "me"] };
    });

    const baseBinary = A.save(base);
    const populated = A.change(
      A.load<FreedDoc>(baseBinary),
      "Update populated side",
      (draft) => {
        const future = (draft as unknown as Record<string, unknown>)
          .futureLibraryState as Record<string, number>;
        future.localValue = 1;
        draft.preferences.weights.recency = 73;
      },
    );
    const staleEmpty = A.change(
      A.load<FreedDoc>(baseBinary),
      "Apply stale empty state",
      (draft) => {
        for (const id of Object.keys(draft.feedItems)) {
          delete draft.feedItems[id];
        }
        addRssFeed(draft, {
          url: "https://remote.example/feed.xml",
          title: "Remote only",
          enabled: true,
          trackUnread: false,
        });
        const root = draft as unknown as Record<string, unknown>;
        const future = root.futureLibraryState as Record<string, number>;
        future.incomingValue = 1;
        delete root.futureRemovedState;
      },
    );

    expect(Object.keys(base.feedItems)).toHaveLength(600);
    expect(Object.keys(populated.feedItems)).toHaveLength(600);
    const populatedBinary = A.save(populated);
    const staleEmptyBinary = A.save(staleEmpty);
    expect(
      Object.keys(A.load<FreedDoc>(populatedBinary).feedItems),
    ).toHaveLength(600);
    const rawMerged = A.merge(
      A.load<FreedDoc>(populatedBinary),
      A.load<FreedDoc>(staleEmptyBinary),
    );
    expect(Object.keys(rawMerged.feedItems)).toHaveLength(0);

    const result = A.load<FreedDoc>(
      mergeBinaries(populatedBinary, staleEmptyBinary),
    );
    const plain = A.toJS(result) as unknown as Record<string, unknown>;

    expect(Object.keys(result.feedItems)).toHaveLength(600);
    expect(result.rssFeeds["https://remote.example/feed.xml"]?.title).toBe(
      "Remote only",
    );
    expect(result.preferences.weights.recency).toBe(73);
    expect(plain.futureLibraryState).toEqual({
      localValue: 1,
      incomingValue: 1,
    });
    expect(plain.futureRemovedState).toBeUndefined();
    expect(A.hasHeads(result, A.getHeads(populated))).toBe(true);
    expect(A.hasHeads(result, A.getHeads(staleEmpty))).toBe(true);
  });

  it("still blocks a large partial feed deletion", () => {
    let populated = createEmptyDoc();
    populated = A.change(populated, "Seed populated feed", (draft) => {
      for (let index = 0; index < 600; index += 1) {
        addFeedItem(draft, makeItem(`rss:partial-delete-${index}`));
      }
    });
    const partiallyDeleted = A.change(
      A.clone(populated),
      "Delete most feed items",
      (draft) => {
        for (let index = 20; index < 600; index += 1) {
          delete draft.feedItems[`rss:partial-delete-${index}`];
        }
      },
    );

    expect(() => mergeBinaries(A.save(populated), A.save(partiallyDeleted))).toThrow(
      /Freed blocked a sync merge/,
    );
  });
});
