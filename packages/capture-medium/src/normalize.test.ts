import { describe, expect, it } from "vitest";
import {
  deduplicateAccounts,
  mediumEntriesToFeedItems,
  mediumEntryToFeedItem,
  mediumProfilesToAccounts,
} from "./normalize.js";
import type { RawMediumEntry, RawMediumProfile } from "./types.js";

function expectNoUndefined(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) {
    expect(nested).not.toBeUndefined();
    expectNoUndefined(nested);
  }
}

describe("medium normalization", () => {
  it("normalizes stories, responses, claps, and highlights", () => {
    const kinds: RawMediumEntry["kind"][] = ["story", "response", "clap", "highlight"];
    const items = mediumEntriesToFeedItems(
      kinds.map((kind, index) => ({
        kind,
        id: `${kind}-${index.toLocaleString()}`,
        url: kind === "story" ? "https://medium.com/@ada/a-good-story-ab12cd" : undefined,
        title: kind === "story" ? "A good story" : undefined,
        text: `Visible ${kind}`,
        activityLabel: kind === "clap" ? "Visible clap" : undefined,
        author: { handle: "Ada", displayName: "Ada Lovelace" },
        publishedAt: 1_780_243_200,
      })),
    );

    expect(items.map((item) => item.contentType)).toEqual(["article", "post", "post", "post"]);
    expect(items[0]?.publishedAt).toBe(1_780_243_200_000);
    expect(items[0]?.author.handle).toBe("ada");
    items.forEach(expectNoUndefined);
  });

  it("canonicalizes tracked URLs into stable IDs and source links", () => {
    const first = mediumEntryToFeedItem({
      kind: "story",
      url: "https://medium.com/@ada/deep-thought/?source=profile&sk=secret#responses",
      text: "Long thoughts.",
    });
    const second = mediumEntryToFeedItem({
      kind: "story",
      url: "https://medium.com/@ada/deep-thought",
      text: "Long thoughts.",
    });

    expect(first?.globalId).toBe(second?.globalId);
    expect(first?.sourceUrl).toBe("https://medium.com/@ada/deep-thought");
  });

  it("keeps responses from different people on the same story", () => {
    const base = {
      kind: "response" as const,
      id: "https://medium.com/@writer/deep-thought-abcdef",
      url: "https://medium.com/@writer/deep-thought-abcdef",
      publishedAt: "2026-07-13T12:00:00.000Z",
      text: "A thoughtful response",
    };
    const ada = mediumEntryToFeedItem({
      ...base,
      author: { id: "https://medium.com/@ada", handle: "ada" },
    });
    const grace = mediumEntryToFeedItem({
      ...base,
      author: { id: "https://medium.com/@grace", handle: "grace" },
    });

    expect(ada?.globalId).not.toBe(grace?.globalId);
  });

  it("infers a story author from its Medium URL", () => {
    const item = mediumEntryToFeedItem({
      kind: "story",
      url: "https://medium.com/@ada/deep-thought-abcdef",
      title: "Deep Thought",
    });

    expect(item?.author).toMatchObject({
      id: "https://medium.com/@ada",
      handle: "ada",
      displayName: "ada",
    });
  });

  it("uses a canonical profile URL when an author has both a handle and URL", () => {
    const item = mediumEntryToFeedItem({
      kind: "response",
      id: "response-canonical-profile",
      text: "One response",
      author: { handle: "Ada", profileUrl: "https://medium.com/@Ada?source=profile" },
    });

    expect(item?.author.id).toBe("https://medium.com/@ada");
  });

  it("never persists story body text from browser capture", () => {
    const item = mediumEntryToFeedItem({
      kind: "story",
      url: "https://medium.com/@ada/private-story-ab12cd",
      title: "Private story",
      text: "Members only body",
    });

    expect(item?.content.text).toBeUndefined();
    expect(item?.content.linkPreview?.title).toBe("Private story");
  });

  it("never persists embedded story excerpts from claps", () => {
    const item = mediumEntryToFeedItem({
      kind: "clap",
      url: "https://medium.com/@ada/private-story-ab12cd",
      title: "Private story",
      text: "Members only excerpt",
      activityLabel: "Ada clapped for this story",
    });

    expect(item?.content.text).toContain("Ada clapped for this story");
    expect(item?.content.text).toContain("Private story");
    expect(item?.content.text).not.toContain("Members only excerpt");
  });

  it("drops roster-only entries and unsafe optional fields", () => {
    for (const kind of ["follower", "following"] as const) {
      expect(mediumEntryToFeedItem({ kind, id: kind, text: kind })).toBeNull();
    }
    const item = mediumEntryToFeedItem({ kind: "response", id: "response-1", text: "Hello" });
    expect(item).not.toHaveProperty("sourceUrl");
    expectNoUndefined(item);
  });

  it("creates roster accounts but excludes incidental authors", () => {
    const profiles: RawMediumProfile[] = [
      {
        id: "user-1",
        handle: "Grace",
        displayName: "Grace Hopper",
        profileUrl: "https://medium.com/@grace?source=profile",
        role: "following",
      },
      {
        id: "user-2",
        handle: "Alan",
        displayName: "Alan Turing",
        profileUrl: "https://medium.com/@alan",
        role: "follower",
      },
      {
        id: "https://medium.com/better-programming",
        handle: "better-programming",
        displayName: "Better Programming",
        profileUrl: "https://medium.com/better-programming",
        role: "subscription",
      },
      { id: "author-1", handle: "author", role: "author" },
      { id: "missing-role", handle: "incidental" },
    ];

    const accounts = mediumProfilesToAccounts(profiles);

    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toMatchObject({
      id: "social:medium:user-1",
      provider: "medium",
      handle: "grace",
      discoveredFrom: "follow_roster",
      profileUrl: "https://medium.com/@grace",
      followRosterRoles: ["following"],
    });
    expect(accounts[2]).toMatchObject({
      id: "social:medium:https://medium.com/better-programming",
      discoveredFrom: "follow_roster",
      followRosterRoles: ["subscription"],
    });
    accounts.forEach(expectNoUndefined);
  });

  it("retains follower and following roles for the same profile", () => {
    const accounts = mediumProfilesToAccounts([
      {
        id: "https://medium.com/@ada",
        handle: "ada",
        displayName: "ada",
        role: "follower",
      },
      {
        id: "https://medium.com/@ada",
        handle: "ada",
        displayName: "Ada Lovelace",
        role: "following",
      },
    ]);

    expect(deduplicateAccounts(accounts)).toEqual([
      expect.objectContaining({
        displayName: "Ada Lovelace",
        followRosterRoles: ["follower", "following"],
      }),
    ]);
  });

  it("uses the same external identity for roster accounts and feed authors", () => {
    const profile: RawMediumProfile = {
      id: "https://medium.com/@ada?source=profile",
      handle: "Ada",
      displayName: "Ada Lovelace",
      role: "follower",
    };
    const account = mediumProfilesToAccounts([profile])[0];
    const item = mediumEntryToFeedItem({
      kind: "story",
      id: "story-identity",
      url: "https://medium.com/@ada/one-identity-ab12cd",
      title: "One identity",
      text: "One identity",
      author: profile,
    });

    expect(item?.author.id).toBe(account?.externalId);
    expect(account?.id).toBe(`social:medium:${item?.author.id}`);
    expect(item?.author.handle).toBe("ada");
  });

  it("rejects invalid media and engagement values", () => {
    const item = mediumEntryToFeedItem({
      kind: "highlight",
      id: "highlight-1",
      text: "A useful passage",
      mediaUrls: ["data:text/plain,nope", "https://images.example/a.jpg#x"],
      clapCount: -1,
      responseCount: 3.8,
    });

    expect(item?.content.mediaUrls).toEqual(["https://images.example/a.jpg"]);
    expect(item?.engagement).toEqual({ comments: 3 });
  });
});
