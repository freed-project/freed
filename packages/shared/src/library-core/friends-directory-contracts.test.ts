import { describe, expect, it } from "vitest";
import {
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  libraryCoreFriendsDirectoryBindingDigestV1,
  parseLibraryCoreAccountLinkCandidatesRequestV1,
  parseLibraryCoreAccountLinkCandidatesResponseV1,
  parseLibraryCoreAccountPickerPageRequestV1,
  parseLibraryCoreAccountPickerPageResponseV1,
  parseLibraryCoreFriendsDirectoryPageRequestV1,
  parseLibraryCoreFriendsDirectoryPageResponseV1,
  parseLibraryCorePersonPickerPageRequestV1,
  parseLibraryCorePersonPickerPageResponseV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
} from "./friends-directory-contracts.js";
import {
  coerceLibraryCoreGeneratedSqliteQueryRow,
  parseLibraryCoreGeneratedSqliteQueryRow,
} from "./sqlite-contract.generated.js";

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
  it("generates one closed row transform for SQLite and wire values", () => {
    const sqliteRow = {
      avatarUrl: null,
      bio: "First programmer",
      careLevel: 5,
      hasLocation: 1,
      id: "person-ada",
      isRecentlyActive: 1,
      lastContactAt: 1_799_000_000_000,
      latestActivityAt: 1_799_500_000_000,
      latestAvatarUrl: "https://example.test/ada.jpg",
      name: "Ada Lovelace",
      needsOutreach: 0,
      reachOutIntervalDays: 7,
      relationshipStatus: "friend",
    };
    const coerced = coerceLibraryCoreGeneratedSqliteQueryRow(
      "friends_directory_page_v1",
      sqliteRow,
    );
    expect(coerced).toMatchObject({
      hasLocation: true,
      isRecentlyActive: true,
      needsOutreach: false,
    });
    expect(
      parseLibraryCoreGeneratedSqliteQueryRow(
        "friends_directory_page_v1",
        coerced,
      ),
    ).toStrictEqual(coerced);
    expect(
      coerceLibraryCoreGeneratedSqliteQueryRow("friends_directory_page_v1", {
        ...sqliteRow,
        relationshipStatus: "connection",
      }),
    ).toBeNull();
    expect(
      coerceLibraryCoreGeneratedSqliteQueryRow("friends_directory_page_v1", {
        ...sqliteRow,
        surprise: true,
      }),
    ).toBeNull();
    expect(
      coerceLibraryCoreGeneratedSqliteQueryRow("friends_directory_page_v1", {
        ...sqliteRow,
        id: "",
      }),
    ).toBeNull();
    expect(
      coerceLibraryCoreGeneratedSqliteQueryRow("friends_directory_page_v1", {
        ...sqliteRow,
        name: "",
      }),
    ).toBeNull();
    expect(
      coerceLibraryCoreGeneratedSqliteQueryRow("friends_directory_page_v1", {
        ...sqliteRow,
        careLevel: 6,
      }),
    ).toBeNull();
  });

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

describe("Person picker contract", () => {
  const pickerRequest = {
    cancellationId: "cancel-person-picker",
    limit: 12,
    queryId: "person_picker_page_v1" as const,
    readerSessionId: "person-picker-session",
    schemaVersion: 1 as const,
    search: "Ada",
  };

  it("accepts only the compact generated Person row", () => {
    const request = parseLibraryCorePersonPickerPageRequestV1(pickerRequest);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(
      parseLibraryCorePersonPickerPageResponseV1(
        {
          queryId: "person_picker_page_v1",
          rows: [
            {
              avatarUrl: null,
              careLevel: 5,
              id: "person-ada",
              name: "Ada Lovelace",
              relationshipStatus: "friend",
            },
          ],
          schemaVersion: 1,
          source,
        },
        request.value,
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCorePersonPickerPageResponseV1(
        {
          queryId: "person_picker_page_v1",
          rows: [
            {
              avatarUrl: null,
              careLevel: 5,
              id: "person-ada",
              name: "Ada Lovelace",
              notes: "must never cross the picker boundary",
              relationshipStatus: "friend",
            },
          ],
          schemaVersion: 1,
          source,
        },
        request.value,
      ).ok,
    ).toBe(false);
  });

  it("rejects oversized searches and unregistered request fields", () => {
    expect(
      parseLibraryCorePersonPickerPageRequestV1({
        ...pickerRequest,
        search: "x".repeat(1_025),
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePersonPickerPageRequestV1({
        ...pickerRequest,
        arbitrarySql: "SELECT *",
      }).ok,
    ).toBe(false);
  });
});

describe("Account picker contract", () => {
  const pickerRequest = {
    cancellationId: "cancel-account-picker",
    limit: 50,
    queryId: "account_picker_page_v1" as const,
    readerSessionId: "account-picker-session",
    schemaVersion: 1 as const,
    search: "love",
  };

  it("accepts only the compact generated Account row", () => {
    const request = parseLibraryCoreAccountPickerPageRequestV1(pickerRequest);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(
      parseLibraryCoreAccountPickerPageResponseV1(
        {
          queryId: "account_picker_page_v1",
          rows: [
            {
              accountId: "account-ada",
              authorId: "ada-remote",
              avatarUrl: null,
              displayName: "Ada Lovelace",
              handle: "ada",
              platform: "x",
            },
          ],
          schemaVersion: 1,
          source,
        },
        request.value,
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreAccountPickerPageResponseV1(
        {
          queryId: "account_picker_page_v1",
          rows: [
            {
              accountId: "account-ada",
              activityCount: 100,
              authorId: "ada-remote",
              avatarUrl: null,
              displayName: "Ada Lovelace",
              handle: "ada",
              platform: "x",
            },
          ],
          schemaVersion: 1,
          source,
        },
        request.value,
      ).ok,
    ).toBe(false);
  });

  it("permits an empty search and rejects one or two scalars", () => {
    expect(
      parseLibraryCoreAccountPickerPageRequestV1({
        ...pickerRequest,
        search: "",
      }).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreAccountPickerPageRequestV1({
        ...pickerRequest,
        search: "lo",
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreAccountPickerPageRequestV1({
        ...pickerRequest,
        search: "猫犬鳥",
      }).ok,
    ).toBe(true);
  });
});

describe("Account link candidates contract", () => {
  const accountLinkRequest = {
    cancellationId: "cancel-account-links",
    entityId: "account-1",
    entityKind: "account" as const,
    limit: 5,
    queryId: "account_link_candidates_v1" as const,
    readerSessionId: "reader-account-links",
    schemaVersion: 1 as const,
  };

  it("accepts one closed selected-identity request and bounded response", () => {
    const parsedRequest =
      parseLibraryCoreAccountLinkCandidatesRequestV1(accountLinkRequest);
    expect(parsedRequest.ok).toBe(true);
    if (!parsedRequest.ok) return;
    expect(
      parseLibraryCoreAccountLinkCandidatesResponseV1(
        {
          queryId: "account_link_candidates_v1",
          rows: [
            {
              accountAvatarUrl: null,
              accountDisplayName: "Ada Lovelace",
              accountExternalId: "ada",
              accountHandle: "ada",
              accountId: "account-1",
              accountProvider: "x",
              confidence: "high",
              personAvatarUrl: null,
              personId: "person-1",
              personName: "Ada Lovelace",
              reason:
                "Same handle as an account already linked to this friend.",
              score: 95,
            },
          ],
          schemaVersion: 1,
          source,
        },
        parsedRequest.value,
      ).ok,
    ).toBe(true);
  });

  it("rejects unknown fields, identity kinds, and excess rows", () => {
    expect(
      parseLibraryCoreAccountLinkCandidatesRequestV1({
        ...accountLinkRequest,
        extra: true,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreAccountLinkCandidatesRequestV1({
        ...accountLinkRequest,
        entityKind: "all",
      }).ok,
    ).toBe(false);
    const parsedRequest =
      parseLibraryCoreAccountLinkCandidatesRequestV1(accountLinkRequest);
    if (!parsedRequest.ok) throw new Error(parsedRequest.error);
    expect(
      parseLibraryCoreAccountLinkCandidatesResponseV1(
        {
          queryId: "account_link_candidates_v1",
          rows: Array.from({ length: 6 }, (_, index) => ({
            accountAvatarUrl: null,
            accountDisplayName: `Account ${index.toLocaleString()}`,
            accountExternalId: `account-${index.toLocaleString()}`,
            accountHandle: null,
            accountId: `account-${index.toLocaleString()}`,
            accountProvider: "x",
            confidence: "medium",
            personAvatarUrl: null,
            personId: "person-1",
            personName: "Ada Lovelace",
            reason: "Display name matches this friend.",
            score: 84,
          })),
          schemaVersion: 1,
          source,
        },
        parsedRequest.value,
      ).ok,
    ).toBe(false);
  });
});
