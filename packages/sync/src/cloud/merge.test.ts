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

function makeItem(): FeedItem {
  return {
    globalId: "rss:forward-compatible-merge",
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
});
