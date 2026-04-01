import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchGoogleContacts,
  mergeContactChanges,
} from "@freed/shared/google-contacts";
import {
  buildFriendSourcesFromAuthorIds,
  createDeviceContactFromGoogleContact,
  mergeFriendSources,
  shouldAutoProcessMatch,
} from "@freed/shared/google-contacts-automation";
import type { ContactMatch, FeedItem, Friend } from "@freed/shared";

describe("google contacts helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchGoogleContacts paginates and separates deleted contacts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        connections: [
          {
            resourceName: "people/1",
            names: [{ displayName: "Jane Doe", givenName: "Jane", familyName: "Doe" }],
            emailAddresses: [{ value: "jane@example.com" }],
          },
        ],
        nextPageToken: "page-2",
      })),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({
        connections: [
          {
            resourceName: "people/2",
            metadata: { deleted: true },
          },
        ],
        nextSyncToken: "sync-2",
      })),
    );

    const result = await fetchGoogleContacts("token-123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.nextSyncToken).toBe("sync-2");
    expect(result.deleted).toEqual(["people/2"]);
    expect(result.contacts[0].name.displayName).toBe("Jane Doe");
  });

  it("fetchGoogleContacts retries with a full sync when the token expires", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("gone", { status: 410 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          connections: [{ resourceName: "people/3", names: [{ displayName: "Retry Person" }] }],
          nextSyncToken: "fresh-sync",
        })),
      );

    const result = await fetchGoogleContacts("token-123", "expired-sync-token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.contacts).toHaveLength(1);
    expect(result.nextSyncToken).toBe("fresh-sync");
  });

  it("mergeContactChanges replaces updated contacts and removes deleted ones", () => {
    const merged = mergeContactChanges(
      [
        {
          resourceName: "people/1",
          name: { displayName: "Old Name" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
        {
          resourceName: "people/2",
          name: { displayName: "Delete Me" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
      ],
      [
        {
          resourceName: "people/1",
          name: { displayName: "New Name" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
      ],
      ["people/2"],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        resourceName: "people/1",
        name: expect.objectContaining({ displayName: "New Name" }),
      }),
    ]);
  });

  it("dedupes sources when merging auto-linked friend identities", () => {
    const existing = [{ platform: "rss", authorId: "author-1", displayName: "Jane" }] as Friend["sources"];
    const additions = [
      { platform: "rss", authorId: "author-1", displayName: "Jane" },
      { platform: "x", authorId: "author-2", displayName: "Jane D" },
    ] as Friend["sources"];

    expect(mergeFriendSources(existing, additions)).toEqual([
      { platform: "rss", authorId: "author-1", displayName: "Jane" },
      { platform: "x", authorId: "author-2", displayName: "Jane D" },
    ]);
  });

  it("builds friend sources from unique author ids and preserves platform metadata", () => {
    const items: FeedItem[] = [
      {
        globalId: "x:1",
        platform: "x",
        contentType: "post",
        capturedAt: Date.now(),
        publishedAt: Date.now(),
        author: { id: "author-1", handle: "jane", displayName: "Jane Doe", avatarUrl: "https://example.com/avatar.jpg" },
        content: { text: "hello", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
      {
        globalId: "x:2",
        platform: "x",
        contentType: "post",
        capturedAt: Date.now(),
        publishedAt: Date.now(),
        author: { id: "author-1", handle: "jane", displayName: "Jane Doe", avatarUrl: "https://example.com/avatar.jpg" },
        content: { text: "hello again", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
    ];

    expect(buildFriendSourcesFromAuthorIds(items, ["author-1", "author-1"])).toEqual([
      {
        platform: "x",
        authorId: "author-1",
        handle: "jane",
        displayName: "Jane Doe",
        avatarUrl: "https://example.com/avatar.jpg",
      },
    ]);
  });

  it("marks only high-confidence friend or author matches for automatic processing", () => {
    const baseMatch = {
      contact: {
        resourceName: "people/9",
        name: { displayName: "Jane Doe" },
        emails: [],
        phones: [],
        photos: [],
        organizations: [],
      },
    };

    const friendMatch: ContactMatch = {
      ...baseMatch,
      friend: { id: "friend-1" } as Friend,
      authorIds: [],
      confidence: "high",
    };
    const createMatch: ContactMatch = {
      ...baseMatch,
      friend: null,
      authorIds: ["author-1"],
      confidence: "high",
    };
    const manualMatch: ContactMatch = {
      ...baseMatch,
      friend: null,
      authorIds: ["author-1"],
      confidence: "medium",
    };

    expect(shouldAutoProcessMatch(friendMatch)).toBe(true);
    expect(shouldAutoProcessMatch(createMatch)).toBe(true);
    expect(shouldAutoProcessMatch(manualMatch)).toBe(false);
  });

  it("creates a Google device contact using resourceName as nativeId", () => {
    expect(
      createDeviceContactFromGoogleContact(
        {
          resourceName: "people/10",
          name: { displayName: "Jane Doe" },
          emails: [{ value: "jane@example.com" }],
          phones: [{ value: "+1 555 0100" }],
          photos: [],
          organizations: [],
        },
        123,
      ),
    ).toEqual({
      importedFrom: "google",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "+1 555 0100",
      nativeId: "people/10",
      importedAt: 123,
    });
  });
});
