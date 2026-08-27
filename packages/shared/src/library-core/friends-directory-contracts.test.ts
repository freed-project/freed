import { describe, expect, it } from "vitest";
import {
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  libraryCoreFriendsDirectoryBindingDigestV1,
  parseLibraryCoreFriendsDirectoryPageRequestV1,
  parseLibraryCoreFriendsDirectoryPageResponseV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
} from "./friends-directory-contracts.js";

const source = {
  generationId: "a".repeat(64) as never,
  projectionRevision: 7,
  transitionSequence: 7,
};

function request(
  overrides: Partial<LibraryCoreFriendsDirectoryPageRequestV1> = {},
): LibraryCoreFriendsDirectoryPageRequestV1 {
  return {
    cancellationId: "cancel-friends-directory",
    cursor: null,
    filters: ["need_outreach"],
    limit: 32,
    nowMs: 1_800_000_000_000,
    queryId: "friends_directory_page_v1",
    readerSessionId: "friends-directory-session",
    schemaVersion: 1,
    search: "Ada",
    sort: "recent_activity",
    ...overrides,
  };
}

describe("Friends directory contract", () => {
  it("binds an offset cursor to the exact query and source", () => {
    const bindingDigest = libraryCoreFriendsDirectoryBindingDigestV1(request());
    const encoded = encodeLibraryCoreFriendsDirectoryCursorV1({
      bindingDigest,
      generationId: source.generationId,
      offset: 32,
      projectionRevision: 7,
      transitionSequence: 7,
    });
    expect(decodeLibraryCoreFriendsDirectoryCursorV1(encoded)).toStrictEqual({
      ok: true,
      value: {
        bindingDigest,
        generationId: source.generationId,
        offset: 32,
        projectionRevision: 7,
        transitionSequence: 7,
      },
    });
    expect(
      parseLibraryCoreFriendsDirectoryPageRequestV1(
        request({ cursor: encoded }),
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreFriendsDirectoryPageRequestV1(
        request({ cursor: encoded, search: "Grace" }),
      ).ok,
    ).toBe(false);
  });

  it("accepts one bounded closed page and exact continuation offset", () => {
    const parsedRequest = parseLibraryCoreFriendsDirectoryPageRequestV1(
      request({ limit: 1 }),
    );
    expect(parsedRequest.ok).toBe(true);
    if (!parsedRequest.ok) return;
    const bindingDigest = libraryCoreFriendsDirectoryBindingDigestV1(
      parsedRequest.value,
    );
    const parsed = parseLibraryCoreFriendsDirectoryPageResponseV1(
      {
        nextCursor: encodeLibraryCoreFriendsDirectoryCursorV1({
          bindingDigest,
          generationId: source.generationId,
          offset: 1,
          projectionRevision: 7,
          transitionSequence: 7,
        }),
        queryId: "friends_directory_page_v1",
        rows: [
          {
            avatarUrl: null,
            bio: "First programmer",
            careLevel: 5,
            hasLocation: true,
            id: "person-ada",
            isRecentlyActive: true,
            lastContactAt: 1_799_000_000_000,
            latestActivityAt: 1_799_500_000_000,
            latestAvatarUrl: "https://example.test/ada.jpg",
            name: "Ada Lovelace",
            needsOutreach: false,
            reachOutIntervalDays: 7,
            relationshipStatus: "friend",
          },
        ],
        schemaVersion: 1,
        source,
        totalCount: 2,
      },
      parsedRequest.value,
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects unsorted filters, extra fields, and malformed rows", () => {
    expect(
      parseLibraryCoreFriendsDirectoryPageRequestV1(
        request({ filters: ["recently_active", "close_friends"] }),
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFriendsDirectoryPageRequestV1({
        ...request(),
        arbitrarySql: "SELECT *",
      }).ok,
    ).toBe(false);
    const parsedRequest =
      parseLibraryCoreFriendsDirectoryPageRequestV1(request());
    expect(parsedRequest.ok).toBe(true);
    if (!parsedRequest.ok) return;
    expect(
      parseLibraryCoreFriendsDirectoryPageResponseV1(
        {
          nextCursor: null,
          queryId: "friends_directory_page_v1",
          rows: [{ id: "person-ada" }],
          schemaVersion: 1,
          source,
          totalCount: 1,
        },
        parsedRequest.value,
      ).ok,
    ).toBe(false);
  });
});
