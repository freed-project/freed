import { describe, expect, it } from "vitest";
import type { FeedItem, Friend } from "@freed/shared";
import {
  buildFriendOverviewEntries,
  filterAndSortFriendOverview,
} from "../../../ui/src/lib/friends-workspace";
import {
  buildFrozenFriendGraphLayout,
  createLayoutSignature,
} from "../../../ui/src/lib/friends-graph-layout";

const LABEL_OFFSET_Y = 12;
const LABEL_HEIGHT = 20;

function makeFriend(id: string, name: string, careLevel: Friend["careLevel"], authorId: string): Friend {
  const now = Date.now();
  return {
    id,
    name,
    careLevel,
    sources: [
      {
        platform: "instagram",
        authorId,
        handle: name.toLowerCase().replace(/\s+/g, "."),
        displayName: name,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function makeItem(id: string, authorId: string, publishedAt: number, withLocation: boolean): FeedItem {
  return {
    globalId: id,
    platform: "instagram",
    contentType: "post",
    capturedAt: publishedAt + 1_000,
    publishedAt,
    author: {
      id: authorId,
      handle: authorId,
      displayName: authorId,
    },
    content: {
      text: `Post ${id}`,
      mediaUrls: [],
      mediaTypes: [],
    },
    ...(withLocation
      ? {
          location: {
            name: "Paris",
            coordinates: { lat: 48.8566, lng: 2.3522 },
            source: "geo_tag" as const,
          },
        }
      : {}),
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

describe("friends workspace helpers", () => {
  it("filters and sorts overview entries", () => {
    const now = Date.now();
    const ada = {
      ...makeFriend("friend-ada", "Ada Lovelace", 5, "ada-ig"),
      reachOutLog: [{ loggedAt: now - 40 * 24 * 60 * 60 * 1000, channel: "text" as const }],
    };
    const maya = makeFriend("friend-maya", "Maya Chen", 3, "maya-ig");

    const friends = {
      [ada.id]: ada,
      [maya.id]: maya,
    };
    const feedItems = {
      "ada-post": makeItem("ada-post", "ada-ig", now - 2 * 24 * 60 * 60 * 1000, true),
      "maya-post": makeItem("maya-post", "maya-ig", now - 2 * 60 * 60 * 1000, false),
    };

    const entries = buildFriendOverviewEntries(friends, feedItems, now);
    const filtered = filterAndSortFriendOverview(
      entries,
      "ada",
      new Set(["need_outreach", "has_location"]),
      "recent_activity"
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.friend.name).toBe("Ada Lovelace");

    const sorted = filterAndSortFriendOverview(entries, "", new Set(), "care_level");
    expect(sorted[0]?.friend.name).toBe("Ada Lovelace");
  });

  it("builds stable graph layout signatures and positions", () => {
    const now = Date.now();
    const friends = [
      makeFriend("friend-ada", "Ada Lovelace", 5, "ada-ig"),
      makeFriend("friend-maya", "Maya Chen", 3, "maya-ig"),
      makeFriend("friend-jules", "Jules Rivera", 4, "jules-ig"),
    ];
    const feedItems = {
      "ada-post": makeItem("ada-post", "ada-ig", now - 2 * 60 * 60 * 1000, true),
      "maya-post": makeItem("maya-post", "maya-ig", now - 20 * 24 * 60 * 60 * 1000, false),
      "jules-post": makeItem("jules-post", "jules-ig", now - 3 * 24 * 60 * 60 * 1000, true),
    };

    const signatureA = createLayoutSignature(friends, feedItems, now);
    const signatureB = createLayoutSignature([...friends].reverse(), feedItems, now);
    expect(signatureA).toBe(signatureB);

    const firstLayout = buildFrozenFriendGraphLayout(friends, feedItems, 900, 600, undefined, now);
    const previous = new Map(firstLayout.map((node) => [node.friend.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
    const secondLayout = buildFrozenFriendGraphLayout(friends, feedItems, 900, 600, previous, now);

    expect(firstLayout).toHaveLength(3);
    expect(secondLayout.map((node) => node.friend.id)).toEqual(firstLayout.map((node) => node.friend.id));
    expect(secondLayout.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("keeps friend label boxes from overlapping", () => {
    const now = Date.now();
    const friends = Array.from({ length: 12 }, (_, index) =>
      makeFriend(
        `friend-${index}`,
        `Long Friend Name ${index + 1}`,
        (index % 5) + 1 as Friend["careLevel"],
        `author-${index}`
      )
    );

    const feedItems = Object.fromEntries(
      friends.map((friend, index) => [
        `post-${index}`,
        makeItem(`post-${index}`, friend.sources[0]!.authorId, now - index * 60_000, index % 2 === 0),
      ])
    );

    const layout = buildFrozenFriendGraphLayout(friends, feedItems, 920, 640, undefined, now);

    for (let index = 0; index < layout.length; index += 1) {
      const current = layout[index]!;
      const currentBox = {
        left: (current.x ?? 0) - current.labelWidth / 2,
        right: (current.x ?? 0) + current.labelWidth / 2,
        top: (current.y ?? 0) + current.radius + LABEL_OFFSET_Y,
        bottom: (current.y ?? 0) + current.radius + LABEL_OFFSET_Y + LABEL_HEIGHT,
      };

      for (let compareIndex = index + 1; compareIndex < layout.length; compareIndex += 1) {
        const next = layout[compareIndex]!;
        const nextBox = {
          left: (next.x ?? 0) - next.labelWidth / 2,
          right: (next.x ?? 0) + next.labelWidth / 2,
          top: (next.y ?? 0) + next.radius + LABEL_OFFSET_Y,
          bottom: (next.y ?? 0) + next.radius + LABEL_OFFSET_Y + LABEL_HEIGHT,
        };

        const overlaps =
          currentBox.left < nextBox.right
          && currentBox.right > nextBox.left
          && currentBox.top < nextBox.bottom
          && currentBox.bottom > nextBox.top;

        expect(overlaps).toBe(false);
      }
    }
  });
});
