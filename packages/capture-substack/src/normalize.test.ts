import { describe, expect, it } from "vitest";
import {
  substackEntriesToFeedItems,
  substackProfilesToAccounts,
} from "./normalize.js";
import type { RawSubstackEntry, RawSubstackProfile } from "./types.js";

describe("substack normalization", () => {
  it("normalizes essays and activity with stable global IDs", () => {
    const entries: RawSubstackEntry[] = [
      {
        kind: "essay",
        id: "post-1",
        url: "https://example.substack.com/p/post-1",
        title: "A good essay",
        text: "Long thoughts.",
        author: { handle: "ada", displayName: "Ada" },
        publishedAt: "2026-05-30T12:00:00Z",
      },
      {
        kind: "comment",
        id: "comment-1",
        url: "https://substack.com/@ada/note/c-1",
        text: "A useful comment.",
        author: { handle: "ada", displayName: "Ada" },
      },
    ];

    const items = substackEntriesToFeedItems(entries);

    expect(items).toHaveLength(2);
    expect(items[0]?.globalId).toBe("substack:essay:post-1");
    expect(items[0]?.contentType).toBe("article");
    expect(items[1]?.globalId).toBe("substack:comment:comment-1");
    expect(items[1]?.contentType).toBe("post");
  });

  it("creates follow roster accounts without subscriber dashboard data", () => {
    const profiles = [
      {
        id: "user-1",
        handle: "grace",
        displayName: "Grace",
        profileUrl: "https://substack.com/@grace",
        role: "following",
      },
      {
        id: "subscriber-1",
        handle: "private-subscriber",
        role: "subscriber",
      },
    ] as unknown as RawSubstackProfile[];

    const accounts = substackProfilesToAccounts(profiles);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: "social:substack:user-1",
      provider: "substack",
      externalId: "user-1",
      discoveredFrom: "follow_roster",
    });
  });
});
