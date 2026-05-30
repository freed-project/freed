import { describe, expect, it } from "vitest";
import {
  mediumEntriesToFeedItems,
  mediumProfilesToAccounts,
} from "./normalize.js";
import type { RawMediumEntry, RawMediumProfile } from "./types.js";

describe("medium normalization", () => {
  it("normalizes stories and responses with stable global IDs", () => {
    const entries: RawMediumEntry[] = [
      {
        kind: "story",
        id: "story-1",
        url: "https://medium.com/@ada/story-1",
        title: "A good story",
        text: "Long thoughts.",
        author: { handle: "ada", displayName: "Ada" },
        publishedAt: "2026-05-30T12:00:00Z",
      },
      {
        kind: "response",
        id: "response-1",
        url: "https://medium.com/@ada/response-1",
        text: "A useful response.",
        author: { handle: "ada", displayName: "Ada" },
      },
    ];

    const items = mediumEntriesToFeedItems(entries);

    expect(items).toHaveLength(2);
    expect(items[0]?.globalId).toBe("medium:story:story-1");
    expect(items[0]?.contentType).toBe("article");
    expect(items[1]?.globalId).toBe("medium:response:response-1");
    expect(items[1]?.contentType).toBe("post");
  });

  it("creates follow roster accounts", () => {
    const profiles: RawMediumProfile[] = [
      {
        id: "user-1",
        handle: "grace",
        displayName: "Grace",
        profileUrl: "https://medium.com/@grace",
        role: "follower",
      },
    ];

    const accounts = mediumProfilesToAccounts(profiles);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: "social:medium:user-1",
      provider: "medium",
      externalId: "user-1",
      discoveredFrom: "follow_roster",
    });
  });
});
