import { describe, expect, it } from "vitest";
import type { Friend } from "@freed/shared";
import {
  buildFriendOverviewEntriesFromActivity,
  friendActivitySourceKey,
} from "./friends-workspace";
import { createLibraryFriendsGraphRequest } from "./friends-library-read-model";

function friend(
  id: string,
  sources: Friend["sources"],
  now: number,
): Friend {
  return {
    id,
    name: id,
    relationshipStatus: "friend",
    careLevel: 4,
    sources,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Friends SQLite activity projection", () => {
  it("builds overview rows from compact activity aggregates", () => {
    const now = 10_000;
    const friends = {
      ada: friend(
        "ada",
        [{ platform: "instagram", authorId: "ada", handle: "ada" }],
        now,
      ),
      maya: friend(
        "maya",
        [{ platform: "instagram", authorId: "maya", handle: "maya" }],
        now,
      ),
    };
    const overview = buildFriendOverviewEntriesFromActivity(
      friends,
      {
        [friendActivitySourceKey("instagram", "ada")]: {
          avatarUrl: "https://example.com/ada.jpg",
          avatarPublishedAt: now - 100,
          avatarGlobalId: "newer-ada",
          hasLocation: true,
          latestActivityAt: now - 100,
        },
        [friendActivitySourceKey("instagram", "maya")]: {
          avatarUrl: null,
          avatarPublishedAt: null,
          avatarGlobalId: null,
          hasLocation: false,
          latestActivityAt: now - 500,
        },
      },
      now,
    );

    expect(overview.find((entry) => entry.friend.id === "ada")).toMatchObject({
      avatarUrlCandidates: ["https://example.com/ada.jpg"],
      hasLocation: true,
      isRecentlyActive: true,
      lastPostAt: now - 100,
    });
    expect(overview.find((entry) => entry.friend.id === "maya")?.lastPostAt)
      .toBe(now - 500);
  });

  it("orders compact avatar evidence by activity and binary identity", () => {
    const now = 10_000;
    const friends = {
      ada: friend(
        "ada",
        [
          { platform: "instagram", authorId: "ada-instagram" },
          { platform: "x", authorId: "ada-x" },
        ],
        now,
      ),
    };
    const compact = buildFriendOverviewEntriesFromActivity(
      friends,
      {
        [friendActivitySourceKey("instagram", "ada-instagram")]: {
          avatarUrl: "https://example.com/instagram.jpg",
          avatarPublishedAt: now - 1_000,
          avatarGlobalId: "é-avatar",
          hasLocation: false,
          latestActivityAt: now - 100,
        },
        [friendActivitySourceKey("x", "ada-x")]: {
          avatarUrl: "https://example.com/x.jpg",
          avatarPublishedAt: now - 1_000,
          avatarGlobalId: "z-avatar",
          hasLocation: false,
          latestActivityAt: now - 1_000,
        },
      },
      now,
    );

    expect(compact[0]?.lastPostAt).toBe(now - 100);
    expect(compact[0]?.avatarUrlCandidates).toEqual([
      "https://example.com/x.jpg",
      "https://example.com/instagram.jpg",
    ]);
  });

  it("pins the 45-day graph window", () => {
    const now = 1_785_000_000_000;
    const request = createLibraryFriendsGraphRequest(
      [
        { platform: "x", authorId: "z" },
        { platform: "instagram", authorId: "é " },
      ],
      now,
    );
    expect(request.sources).toEqual([
      { platform: "instagram", authorId: "é " },
      { platform: "x", authorId: "z" },
    ]);
    expect(request.rssFeedUrls).toEqual([]);
    expect(request.recentWindow).toEqual({
      startMs: now - 45 * 24 * 60 * 60 * 1_000,
      endMs: now,
    });
  });
});
