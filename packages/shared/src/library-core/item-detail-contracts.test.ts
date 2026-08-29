import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreItemDetailRequestV1,
  parseLibraryCoreItemDetailResponseV1,
} from "./item-detail-contracts";

const request = {
  globalId: "item-1",
  queryId: "item_detail_v1" as const,
  schemaVersion: 1 as const,
};
const card = {
  archived: false,
  authorAvatarUrl: null,
  authorDisplayName: "Ada",
  authorHandle: "ada",
  authorId: "author-1",
  capturedAt: 100,
  contentSignalTags: [],
  contentText: "preview",
  contentType: "article",
  engagementComments: null,
  engagementLikes: null,
  eventConfidenceBasisPoints: null,
  eventStartsAt: null,
  globalId: "item-1",
  liked: null,
  likedAt: null,
  likedSyncedAt: null,
  linkPreviewTitle: null,
  locationName: null,
  mediaTypes: [],
  mediaUrls: [],
  platform: "saved",
  publishedAt: 100,
  readAt: null,
  readingTimeMinutes: null,
  saved: true,
  sourceUrl: null,
  tags: [],
};

describe("item detail contracts", () => {
  it("accepts closed metadata with separate body locators", () => {
    expect(parseLibraryCoreItemDetailRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreItemDetailResponseV1(
        {
          item: {
            card,
            contentBody: { blobDigest: null, storage: "inline" },
            mediaBlobDigests: [],
            preservedBody: { blobDigest: "a".repeat(64), storage: "blob" },
          },
          queryId: "item_detail_v1",
          schemaVersion: 1,
          source: {
            generationId: "b".repeat(64),
            projectionRevision: 7,
            transitionSequence: 7,
          },
        },
        request,
      ).ok,
    ).toBe(true);
  });

  it("rejects whole-body fields, invalid locators, and the wrong item", () => {
    const response = {
      item: {
        card,
        contentBody: { blobDigest: null, storage: "inline" },
        mediaBlobDigests: [],
        preservedBody: { blobDigest: null, storage: "none" },
      },
      queryId: "item_detail_v1",
      schemaVersion: 1,
      source: {
        generationId: "b".repeat(64),
        projectionRevision: 7,
        transitionSequence: 7,
      },
    };
    expect(
      parseLibraryCoreItemDetailResponseV1(
        { ...response, item: { ...response.item, contentBlob: "forbidden" } },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemDetailResponseV1(
        {
          ...response,
          item: {
            ...response.item,
            card: {
              ...card,
              mediaTypes: ["video"],
              mediaUrls: ["https://example.com/video.mp4"],
            },
            mediaBlobDigests: [],
          },
        },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemDetailResponseV1(
        {
          ...response,
          item: {
            ...response.item,
            contentBody: { blobDigest: "a".repeat(64), storage: "inline" },
          },
        },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemDetailResponseV1(
        {
          ...response,
          item: {
            ...response.item,
            card: { ...card, globalId: "item-2" },
          },
        },
        request,
      ).ok,
    ).toBe(false);
  });
});
