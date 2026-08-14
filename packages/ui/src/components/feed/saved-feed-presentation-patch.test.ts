import { describe, expect, it } from "vitest";
import type { FeedItem, SavedFeedPresentationPatch } from "@freed/shared";
import {
  applySavedFeedPresentationPatch,
  prepareSavedFeedPresentationPatch,
  projectSavedFeedLikePresentation,
  resolveSavedFeedSelectionPin,
} from "./saved-feed-presentation-patch";

function item(
  globalId: string,
  platform: FeedItem["platform"] = "rss",
): FeedItem {
  return {
    globalId,
    platform,
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author" },
    content: { text: globalId },
    media: [],
    topics: [],
    userState: {
      saved: true,
      archived: false,
      hidden: false,
      tags: [],
    },
  };
}

function patch(
  overrides: Partial<SavedFeedPresentationPatch>,
): SavedFeedPresentationPatch {
  return {
    revision: 1,
    sourceVersion: 7,
    readAt: 0,
    readItemIds: [],
    readPlatforms: [],
    userStates: [],
    ...overrides,
  };
}

describe("Saved bounded presentation patches", () => {
  it("drops an evicted selection instead of rebinding a stale row to a new generation", () => {
    const selected = item("saved-1");
    const current = {
      item: selected,
      readerIdentity: "saved-generation-1",
      selectedItemId: selected.globalId,
    };

    expect(
      resolveSavedFeedSelectionPin({
        current,
        eligible: true,
        readerIdentity: "saved-generation-1",
        residentSelectedItem: null,
        selectedItemId: selected.globalId,
      }),
    ).toBe(current);
    expect(
      resolveSavedFeedSelectionPin({
        current,
        eligible: false,
        readerIdentity: "saved-generation-2",
        // The old ready page can still be visible for this render.
        residentSelectedItem: selected,
        selectedItemId: selected.globalId,
      }),
    ).toBeNull();
  });

  it("applies exact-ID and mark-all platform reads only to resident matches", () => {
    const prepared = prepareSavedFeedPresentationPatch(
      patch({
        readAt: 500,
        readItemIds: ["rss-exact"],
        readPlatforms: ["x"],
      }),
    );

    expect(
      applySavedFeedPresentationPatch(item("rss-exact"), prepared).userState
        .readAt,
    ).toBe(500);
    expect(
      applySavedFeedPresentationPatch(item("x-any", "x"), prepared).userState
        .readAt,
    ).toBe(500);
    const untouched = item("rss-other");
    expect(applySavedFeedPresentationPatch(untouched, prepared)).toBe(
      untouched,
    );
  });

  it("applies the exact provider like receipt and clears stale sync state on a new intent", () => {
    const pending = {
      ...item("liked"),
      userState: {
        ...item("liked").userState,
        liked: true,
        likedAt: 100,
      },
    };
    const receipt = prepareSavedFeedPresentationPatch(
      patch({
        userStates: [
          {
            globalId: pending.globalId,
            liked: true,
            likedAt: 100,
            likedSyncedAt: 200,
            seenSyncedAt: null,
          },
        ],
      }),
    );
    expect(
      applySavedFeedPresentationPatch(pending, receipt).userState
        .likedSyncedAt,
    ).toBe(200);

    const reliked = projectSavedFeedLikePresentation(
      projectSavedFeedLikePresentation(
        applySavedFeedPresentationPatch(pending, receipt),
        300,
      ),
      400,
    );
    expect(reliked.userState).toMatchObject({ liked: true, likedAt: 400 });
    expect(reliked.userState.likedSyncedAt).toBeUndefined();
  });
});
