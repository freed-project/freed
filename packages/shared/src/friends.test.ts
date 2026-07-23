import { describe, expect, it } from "vitest";
import type { FeedItem } from "./types.js";
import { buildDiscoveredAccountsFromItems } from "./friends.js";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "substack:essay:one",
    platform: "substack",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "https://writer.substack.com/",
      handle: "writer",
      displayName: "Writer",
    },
    content: { mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

describe("discovered essay author accounts", () => {
  it("preserves a Substack publication profile URL", () => {
    const accounts = buildDiscoveredAccountsFromItems([item()], {});

    expect(accounts).toEqual([
      expect.objectContaining({ profileUrl: "https://writer.substack.com/" }),
    ]);
  });

  it("preserves a Medium profile identity", () => {
    const accounts = buildDiscoveredAccountsFromItems([
      item({
        globalId: "medium:story:one",
        platform: "medium",
        author: {
          id: "https://medium.com/@ada",
          handle: "ada",
          displayName: "Ada",
        },
      }),
    ], {});

    expect(accounts).toEqual([
      expect.objectContaining({ profileUrl: "https://medium.com/@ada" }),
    ]);
  });

  it("does not create one shared account for unknown authors", () => {
    expect(buildDiscoveredAccountsFromItems([
      item({ author: { id: "unknown", handle: "unknown", displayName: "unknown" } }),
    ], {})).toEqual([]);
  });

  it("waits for a real Medium profile before creating a custom domain connection", () => {
    expect(buildDiscoveredAccountsFromItems([
      item({
        globalId: "medium:story:custom",
        platform: "medium",
        author: {
          id: "https://essays.example.com/feed",
          handle: "Ada Lovelace",
          displayName: "Ada Lovelace",
        },
      }),
    ], {})).toEqual([]);
  });
});
