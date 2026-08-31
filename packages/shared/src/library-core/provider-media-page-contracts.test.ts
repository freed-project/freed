import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreProviderMediaPageCursorV1,
  libraryCoreProviderMediaBindingDigestV1,
  parseLibraryCoreProviderMediaPageRequestV1,
  parseLibraryCoreProviderMediaPageResponseV1,
} from "./provider-media-page-contracts.js";
import type {
  LibraryCoreEntityId,
  LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const generationId = "a".repeat(64) as LibraryCoreLowercaseHex64;
const request = {
  cancellationId: "cancel-provider-media-1",
  cursor: null,
  limit: 2,
  provider: "facebook" as const,
  queryId: "provider_media_page_v1" as const,
  readerSessionId: "reader-provider-media-1",
  savedOnly: false,
  schemaVersion: 1 as const,
};

function row(globalId: string) {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: "Reader",
    authorHandle: "reader",
    authorId: "reader-1",
    capturedAt: 2,
    contentSignalTags: [],
    contentText: null,
    contentType: "video",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    fbGroup: {
      id: "group-1",
      name: "Group",
      url: "https://facebook.test/group-1",
    },
    globalId,
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    linkUrl: "https://example.test/video",
    locationName: null,
    mediaTypes: ["video"],
    mediaUrls: ["https://example.test/video.mp4"],
    platform: "facebook",
    publishedAt: 1,
    readAt: null,
    readingTimeMinutes: null,
    saved: true,
    sourceUrl: "https://facebook.test/post",
    tags: [],
  };
}

describe("Library Core provider media page", () => {
  it("accepts only closed, bounded provider requests", () => {
    expect(parseLibraryCoreProviderMediaPageRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreProviderMediaPageRequestV1({ ...request, limit: 65 }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreProviderMediaPageRequestV1({ ...request, provider: "x" })
        .ok,
    ).toBe(false);
    expect(
      parseLibraryCoreProviderMediaPageRequestV1({
        ...request,
        sql: "SELECT 1",
      }).ok,
    ).toBe(false);
  });

  it("binds ordered page cursors to provider, saved mode, and source", () => {
    const rows = [row("facebook:1"), row("facebook:2")];
    const response = {
      nextCursor: encodeLibraryCoreProviderMediaPageCursorV1({
        filterDigest: libraryCoreProviderMediaBindingDigestV1(
          "facebook",
          false,
        ),
        generationId,
        globalId: "facebook:2" as LibraryCoreEntityId,
        projectionRevision: 7,
        transitionSequence: 7,
      }),
      queryId: "provider_media_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: { generationId, projectionRevision: 7, transitionSequence: 7 },
    };
    expect(
      parseLibraryCoreProviderMediaPageResponseV1(response, request).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreProviderMediaPageResponseV1(response, {
        ...request,
        provider: "instagram",
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreProviderMediaPageResponseV1(
        { ...response, rows: [...rows].reverse() },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreProviderMediaPageResponseV1(
        {
          ...response,
          nextCursor: null,
          rows: [{ ...row("saved:youtube"), platform: "saved" }],
        },
        { ...request, provider: "youtube", savedOnly: true },
      ).ok,
    ).toBe(true);
  });
});
