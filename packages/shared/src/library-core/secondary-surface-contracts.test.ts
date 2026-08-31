import { describe, expect, it } from "vitest";
import {
  libraryCoreMapMarkerToLocationCandidateV1,
  libraryCoreMapMarkerToItemV1,
  libraryCoreStoryWallCandidateToItemV1,
  libraryCoreStoryWallCandidateToVisibleV1,
  parseLibraryCoreMapMarkersRequestV1,
  parseLibraryCoreMapMarkersResponseV1,
  parseLibraryCoreStoryWallCandidatesRequestV1,
  parseLibraryCoreStoryWallCandidatesResponseV1,
} from "./secondary-surface-contracts.js";

const operationId = "018f3f60-7d3a-7d0f-8000-000000000001";
const source = {
  generationId: "a".repeat(64),
  projectionRevision: 9,
  transitionSequence: 9,
};

describe("secondary surface query contracts", () => {
  it("closes the map request and accepts only compact location rows", () => {
    const request = {
      cancellationId: operationId,
      limit: 1,
      queryId: "map_markers_v1" as const,
      readerSessionId: operationId,
      schemaVersion: 1 as const,
    };
    expect(parseLibraryCoreMapMarkersRequestV1(request).ok).toBe(true);
    expect(parseLibraryCoreMapMarkersRequestV1({ ...request, sql: "SELECT 1" }).ok).toBe(false);
    expect(parseLibraryCoreMapMarkersResponseV1({
      hasMore: false,
      queryId: "map_markers_v1",
      rows: [{
        authorAvatarUrl: null,
        authorDisplayName: "Ada",
        authorHandle: "ada",
        authorId: "author-1",
        capturedAt: 10,
        contentText: "At the observatory",
        contentType: "post",
        friendAvatarUrl: null,
        friendName: "Ada Friend",
        friendPersonId: "person-1",
        friendRelationshipStatus: "friend",
        globalId: "x:item-1",
        linkedAccountId: "account-1",
        locationLat: 34.2,
        locationLng: -118.2,
        locationName: "Observatory",
        locationUrl: null,
        platform: "x",
        publishedAt: 10,
        sourceUrl: "https://example.test/item-1",
        timeRangeEndsAt: null,
        timeRangeStartsAt: null,
      }],
      schemaVersion: 1,
      source,
    }, request).ok).toBe(true);
  });

  it("requires a bounded media set for Story Wall candidates", () => {
    const request = {
      cancellationId: operationId,
      limit: 1,
      queryId: "story_wall_candidates_v1" as const,
      readerSessionId: operationId,
      schemaVersion: 1 as const,
    };
    expect(parseLibraryCoreStoryWallCandidatesRequestV1(request).ok).toBe(true);
    expect(parseLibraryCoreStoryWallCandidatesResponseV1({
      hasMore: false,
      queryId: "story_wall_candidates_v1",
      rows: [{
        authorDisplayName: "Ada",
        authorHandle: "ada",
        authorId: "author-1",
        capturedAt: 10,
        contentText: "Caption",
        globalId: "x:item-1",
        linkedAccountId: "account-1",
        linkedPersonId: "person-1",
        locationName: null,
        mediaTypes: ["video"],
        mediaUrls: ["https://example.test/video.mp4"],
        platform: "x",
        publishedAt: 10,
        sourceUrl: null,
      }],
      schemaVersion: 1,
      source,
    }, request).ok).toBe(true);
    expect(parseLibraryCoreStoryWallCandidatesResponseV1({
      hasMore: false,
      queryId: "story_wall_candidates_v1",
      rows: [],
      schemaVersion: 1,
      source,
      shellJson: {},
    }, request).ok).toBe(false);
  });

  it("projects compact surface rows without a whole-item payload", () => {
    const mapItem = libraryCoreMapMarkerToItemV1({
      authorAvatarUrl: null,
      authorDisplayName: "Ada",
      authorHandle: "ada",
      authorId: "author-1",
      capturedAt: 10,
      contentText: "At the observatory",
      contentType: "post",
      friendAvatarUrl: null,
      friendName: null,
      friendPersonId: null,
      friendRelationshipStatus: null,
      globalId: "x:map-1",
      linkedAccountId: null,
      locationLat: 34.2,
      locationLng: -118.2,
      locationName: "Observatory",
      locationUrl: null,
      platform: "x",
      publishedAt: 10,
      sourceUrl: null,
      timeRangeEndsAt: 30,
      timeRangeStartsAt: 20,
    });
    expect(mapItem.location?.coordinates).toEqual({ lat: 34.2, lng: -118.2 });
    expect(mapItem.timeRange).toEqual({ startsAt: 20, endsAt: 30, kind: "event" });

    const mapCandidate = libraryCoreMapMarkerToLocationCandidateV1({
      authorAvatarUrl: null,
      authorDisplayName: "Ada",
      authorHandle: "ada",
      authorId: "author-1",
      capturedAt: 10,
      contentText: "At the observatory",
      contentType: "post",
      friendAvatarUrl: "https://example.test/ada.jpg",
      friendName: "Ada Friend",
      friendPersonId: "person-1",
      friendRelationshipStatus: "friend",
      globalId: "x:map-2",
      linkedAccountId: "account-1",
      locationLat: 34.2,
      locationLng: -118.2,
      locationName: "Observatory",
      locationUrl: null,
      platform: "x",
      publishedAt: 10,
      sourceUrl: null,
      timeRangeEndsAt: null,
      timeRangeStartsAt: null,
    });
    expect(mapCandidate.friend).toEqual({
      avatarUrl: "https://example.test/ada.jpg",
      id: "person-1",
      name: "Ada Friend",
      relationshipStatus: "friend",
    });
    expect(mapCandidate.accountId).toBe("account-1");

    const storyItem = libraryCoreStoryWallCandidateToItemV1({
      authorDisplayName: "Ada",
      authorHandle: "ada",
      authorId: "author-1",
      capturedAt: 10,
      contentText: "Caption",
      globalId: "x:story-1",
      linkedAccountId: "account-1",
      linkedPersonId: "person-1",
      locationName: null,
      mediaTypes: ["video", "unknown"],
      mediaUrls: ["https://example.test/video.mp4", "https://example.test/raw"],
      platform: "x",
      publishedAt: 10,
      sourceUrl: null,
    });
    expect(storyItem.content.mediaTypes).toEqual(["video", "link"]);
    expect(storyItem.content.mediaUrls).toHaveLength(2);
    expect(storyItem).not.toHaveProperty("shellJson");
    expect(libraryCoreStoryWallCandidateToVisibleV1({
      authorDisplayName: "Ada",
      authorHandle: "ada",
      authorId: "author-1",
      capturedAt: 10,
      contentText: "Caption",
      globalId: "x:story-1",
      linkedAccountId: "account-1",
      linkedPersonId: "person-1",
      locationName: null,
      mediaTypes: ["video"],
      mediaUrls: ["https://example.test/video.mp4"],
      platform: "x",
      publishedAt: 10,
      sourceUrl: null,
    })).toMatchObject({
      accountId: "account-1",
      item: { globalId: "x:story-1" },
      personId: "person-1",
    });
  });
});
