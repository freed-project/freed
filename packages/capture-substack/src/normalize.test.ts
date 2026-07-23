import { describe, expect, it } from "vitest";
import {
  deduplicateAccounts,
  substackEntriesToFeedItems,
  substackEntryToFeedItem,
  substackProfilesToAccounts,
} from "./normalize.js";
import type { RawSubstackEntry, RawSubstackProfile } from "./types.js";

function expectNoUndefined(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) {
    expect(nested).not.toBeUndefined();
    expectNoUndefined(nested);
  }
}

describe("substack normalization", () => {
  it("normalizes every visible activity kind and keeps essays as articles", () => {
    const kinds: RawSubstackEntry["kind"][] = [
      "essay",
      "note",
      "restack",
      "like",
      "comment",
    ];
    const items = substackEntriesToFeedItems(
      kinds.map((kind, index) => ({
        kind,
        id: `${kind}-${index.toLocaleString()}`,
        url: kind === "essay" ? "https://example.substack.com/p/a-good-essay" : undefined,
        title: kind === "essay" ? "A good essay" : undefined,
        text: `Visible ${kind}`,
        activityLabel:
          kind === "restack" || kind === "like" ? `Visible ${kind}` : undefined,
        author: { handle: "Ada", displayName: "Ada Lovelace" },
        publishedAt: 1_780_243_200,
      })),
    );

    expect(items.map((item) => item.contentType)).toEqual([
      "article",
      "post",
      "post",
      "post",
      "post",
    ]);
    expect(items[0]?.publishedAt).toBe(1_780_243_200_000);
    expect(items[0]?.author.handle).toBe("ada");
    items.forEach(expectNoUndefined);
  });

  it("canonicalizes tracked URLs into stable IDs and source links", () => {
    const first = substackEntryToFeedItem({
      kind: "essay",
      url: "https://example.substack.com/p/deep-thought/?utm_source=email#comments",
      text: "Long thoughts.",
    });
    const second = substackEntryToFeedItem({
      kind: "essay",
      url: "https://example.substack.com/p/deep-thought",
      text: "Long thoughts.",
    });

    expect(first?.globalId).toBe(second?.globalId);
    expect(first?.sourceUrl).toBe("https://example.substack.com/p/deep-thought");
  });

  it("keeps distinct comments on the same essay", () => {
    const base = {
      kind: "comment" as const,
      id: "https://writer.substack.com/p/deep-thought",
      url: "https://writer.substack.com/p/deep-thought",
      publishedAt: "2026-07-13T12:00:00.000Z",
      text: "A thoughtful reply",
    };
    const ada = substackEntryToFeedItem({
      ...base,
      author: { id: "https://substack.com/@ada", handle: "ada" },
    });
    const grace = substackEntryToFeedItem({
      ...base,
      author: { id: "https://substack.com/@grace", handle: "grace" },
    });

    expect(ada?.globalId).not.toBe(grace?.globalId);
  });

  it("infers a publication author from an essay URL", () => {
    const item = substackEntryToFeedItem({
      kind: "essay",
      url: "https://deepthoughts.substack.com/p/one",
      title: "One",
    });

    expect(item?.author).toMatchObject({
      id: "https://deepthoughts.substack.com/",
      handle: "deepthoughts",
      displayName: "deepthoughts",
    });
  });

  it("normalizes a profile URL handle when no explicit handle is present", () => {
    const item = substackEntryToFeedItem({
      kind: "note",
      id: "note-profile-handle",
      text: "One note",
      author: { profileUrl: "https://substack.com/@Ada" },
    });

    expect(item?.author).toMatchObject({
      id: "https://substack.com/@ada",
      handle: "ada",
      displayName: "ada",
    });
  });

  it("uses a canonical profile URL when an author has both a handle and URL", () => {
    const item = substackEntryToFeedItem({
      kind: "note",
      id: "note-canonical-profile",
      text: "One note",
      author: { handle: "Ada", profileUrl: "https://substack.com/@Ada?utm_source=profile" },
    });

    expect(item?.author.id).toBe("https://substack.com/@ada");
  });

  it("never persists essay body text from browser capture", () => {
    const item = substackEntryToFeedItem({
      kind: "essay",
      url: "https://example.substack.com/p/private-essay",
      title: "Private essay",
      text: "Subscriber only body",
    });

    expect(item?.content.text).toBeUndefined();
    expect(item?.content.linkPreview?.title).toBe("Private essay");
  });

  it("never persists embedded essay excerpts from likes or restacks", () => {
    for (const kind of ["like", "restack"] as const) {
      const item = substackEntryToFeedItem({
        kind,
        url: "https://example.substack.com/p/private-essay",
        title: "Private essay",
        text: "Subscriber only excerpt",
        activityLabel: kind === "like" ? "Ada liked this essay" : "Ada restacked this essay",
      });

      expect(item?.content.text).toContain(kind === "like" ? "liked" : "restacked");
      expect(item?.content.text).toContain("Private essay");
      expect(item?.content.text).not.toContain("Subscriber only excerpt");
    }
  });

  it("drops roster-only entries and unsafe optional fields", () => {
    for (const kind of ["follower", "following", "subscription"] as const) {
      expect(substackEntryToFeedItem({ kind, id: kind, text: kind })).toBeNull();
    }
    const item = substackEntryToFeedItem({ kind: "note", id: "note-1", text: "Hello" });
    expect(item).not.toHaveProperty("sourceUrl");
    expectNoUndefined(item);
  });

  it("creates follow roster accounts and excludes incidental or sensitive profiles", () => {
    const roles: RawSubstackProfile["role"][] = [
      "follower",
      "following",
      "subscription",
      "author",
      "subscriber",
      undefined,
    ];
    const profiles = roles.map((role, index): RawSubstackProfile => ({
      id: `user-${index.toLocaleString()}`,
      handle: `Person${index.toLocaleString()}`,
      displayName: `Person ${index.toLocaleString()}`,
      profileUrl: `https://substack.com/@person${index.toLocaleString()}?utm_source=profile`,
      role,
    }));

    const accounts = substackProfilesToAccounts(profiles);

    expect(accounts).toHaveLength(3);
    expect(accounts.map((account) => account.discoveredFrom)).toEqual([
      "follow_roster",
      "follow_roster",
      "follow_roster",
    ]);
    expect(accounts[0]).toMatchObject({
      id: "social:substack:user-0",
      provider: "substack",
      handle: "person0",
      profileUrl: "https://substack.com/@person0",
      followRosterRoles: ["follower"],
    });
    accounts.forEach(expectNoUndefined);
  });

  it("retains every observed relationship for a repeated roster identity", () => {
    const accounts = substackProfilesToAccounts([
      {
        id: "https://substack.com/@ada",
        handle: "ada",
        displayName: "ada",
        role: "follower",
      },
      {
        id: "https://substack.com/@ada",
        handle: "ada",
        displayName: "Ada Lovelace",
        role: "following",
      },
      { id: "https://substack.com/@ada", role: "subscription" },
    ]);

    expect(deduplicateAccounts(accounts)).toEqual([
      expect.objectContaining({
        displayName: "Ada Lovelace",
        followRosterRoles: ["follower", "following", "subscription"],
      }),
    ]);
  });

  it("uses the same external identity for roster accounts and feed authors", () => {
    const profile: RawSubstackProfile = {
      id: "https://substack.com/@ada?utm_source=profile",
      handle: "Ada",
      displayName: "Ada Lovelace",
      role: "following",
    };
    const account = substackProfilesToAccounts([profile])[0];
    const item = substackEntryToFeedItem({
      kind: "note",
      id: "note-identity",
      text: "One identity",
      author: profile,
    });

    expect(item?.author.id).toBe(account?.externalId);
    expect(account?.id).toBe(`social:substack:${item?.author.id}`);
    expect(item?.author.handle).toBe("ada");
  });

  it("rejects invalid media and engagement values", () => {
    const item = substackEntryToFeedItem({
      kind: "note",
      id: "note-2",
      text: "Hello",
      mediaUrls: ["javascript:alert(1)", "https://images.example/a.jpg#x"],
      likeCount: -1,
      commentCount: Number.NaN,
      restackCount: 2.9,
    });

    expect(item?.content.mediaUrls).toEqual(["https://images.example/a.jpg"]);
    expect(item?.engagement).toEqual({ reposts: 2 });
  });
});
