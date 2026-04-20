import { describe, expect, it } from "vitest";
import {
  getLatestFriendLocationMarkers,
  getLocationTimelineMoments,
  type FeedItem,
  type Person,
  type ResolvedLocationItem,
} from "@freed/shared";

const NOW = Date.UTC(2026, 3, 18, 19, 0, 0);

const ADA: Person = {
  id: "friend-ada",
  name: "Ada Lovelace",
  relationshipStatus: "friend",
  careLevel: 5,
  createdAt: NOW - 30 * 24 * 60 * 60_000,
  updatedAt: NOW,
};

function createItem(
  id: string,
  publishedAt: number,
  locationName: string,
  coordinates: { lat: number; lng: number },
  timeRange?: FeedItem["timeRange"],
): FeedItem {
  return {
    globalId: id,
    platform: "instagram",
    contentType: "post",
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: "ada-ig",
      handle: "ada",
      displayName: "Ada Lovelace",
    },
    content: {
      text: `Checking in from ${locationName}`,
      mediaUrls: [],
      mediaTypes: [],
    },
    location: {
      name: locationName,
      coordinates,
      source: "geo_tag",
    },
    timeRange,
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function resolved(
  item: FeedItem,
  coordinates: { lat: number; lng: number },
): ResolvedLocationItem {
  return {
    item,
    friend: ADA,
    lat: coordinates.lat,
    lng: coordinates.lng,
    label: item.location?.name,
  };
}

describe("map playback selectors", () => {
  it("builds scrubber moments from historical posts and future planning windows", () => {
    const berlin = createItem(
      "ig:ada:berlin",
      NOW - 9 * 24 * 60 * 60_000,
      "Berlin",
      { lat: 52.52, lng: 13.405 },
    );
    const parisTrip = createItem(
      "ig:ada:paris-trip",
      NOW - 4 * 24 * 60 * 60_000,
      "Paris",
      { lat: 48.8566, lng: 2.3522 },
      {
        startsAt: NOW - 4 * 24 * 60 * 60_000,
        endsAt: NOW - 2 * 24 * 60 * 60_000,
        kind: "travel",
      },
    );
    const lisbonTrip = createItem(
      "ig:ada:lisbon-trip",
      NOW + 2 * 24 * 60 * 60_000,
      "Lisbon",
      { lat: 38.7223, lng: -9.1393 },
      {
        startsAt: NOW + 2 * 24 * 60 * 60_000,
        endsAt: NOW + 5 * 24 * 60 * 60_000,
        kind: "travel",
      },
    );

    const resolvedItems = [
      resolved(berlin, { lat: 52.52, lng: 13.405 }),
      resolved(parisTrip, { lat: 48.8566, lng: 2.3522 }),
      resolved(lisbonTrip, { lat: 38.7223, lng: -9.1393 }),
    ];

    expect(
      getLocationTimelineMoments(resolvedItems, {
        timeMode: "past",
        now: NOW,
      }),
    ).toEqual([
      NOW - 9 * 24 * 60 * 60_000,
      NOW - 4 * 24 * 60 * 60_000,
      NOW - 2 * 24 * 60 * 60_000,
    ]);

    expect(
      getLocationTimelineMoments(resolvedItems, {
        timeMode: "future",
        now: NOW,
      }),
    ).toEqual([
      NOW + 2 * 24 * 60 * 60_000,
      NOW + 5 * 24 * 60 * 60_000,
    ]);
  });

  it("plays back historical posts and future plans at the selected scrubber point", () => {
    const rome = createItem(
      "ig:ada:rome",
      NOW - 10 * 24 * 60 * 60_000,
      "Rome",
      { lat: 41.9028, lng: 12.4964 },
    );
    const berlin = createItem(
      "ig:ada:berlin",
      NOW - 3 * 24 * 60 * 60_000,
      "Berlin",
      { lat: 52.52, lng: 13.405 },
    );
    const lisbon = createItem(
      "ig:ada:lisbon-plan",
      NOW + 2 * 24 * 60 * 60_000,
      "Lisbon",
      { lat: 38.7223, lng: -9.1393 },
      {
        startsAt: NOW + 2 * 24 * 60 * 60_000,
        endsAt: NOW + 4 * 24 * 60 * 60_000,
        kind: "travel",
      },
    );
    const tokyo = createItem(
      "ig:ada:tokyo-plan",
      NOW + 6 * 24 * 60 * 60_000,
      "Tokyo",
      { lat: 35.6764, lng: 139.65 },
      {
        startsAt: NOW + 6 * 24 * 60 * 60_000,
        endsAt: NOW + 7 * 24 * 60 * 60_000,
        kind: "travel",
      },
    );

    const resolvedItems = [
      resolved(rome, { lat: 41.9028, lng: 12.4964 }),
      resolved(berlin, { lat: 52.52, lng: 13.405 }),
      resolved(lisbon, { lat: 38.7223, lng: -9.1393 }),
      resolved(tokyo, { lat: 35.6764, lng: 139.65 }),
    ];

    const latePastMarkers = getLatestFriendLocationMarkers(resolvedItems, {
      timeMode: "past",
      now: NOW,
      playbackAt: NOW - 2 * 24 * 60 * 60_000,
    });
    expect(latePastMarkers).toHaveLength(1);
    expect(latePastMarkers[0]?.label).toBe("Berlin");

    const earlyPastMarkers = getLatestFriendLocationMarkers(resolvedItems, {
      timeMode: "past",
      now: NOW,
      playbackAt: NOW - 8 * 24 * 60 * 60_000,
    });
    expect(earlyPastMarkers).toHaveLength(1);
    expect(earlyPastMarkers[0]?.label).toBe("Rome");

    const lisbonMarkers = getLatestFriendLocationMarkers(resolvedItems, {
      timeMode: "future",
      now: NOW,
      playbackAt: NOW + 3 * 24 * 60 * 60_000,
    });
    expect(lisbonMarkers).toHaveLength(1);
    expect(lisbonMarkers[0]?.label).toBe("Lisbon");

    const tokyoMarkers = getLatestFriendLocationMarkers(resolvedItems, {
      timeMode: "future",
      now: NOW,
      playbackAt: NOW + 6 * 24 * 60 * 60_000 + 12 * 60 * 60_000,
    });
    expect(tokyoMarkers).toHaveLength(1);
    expect(tokyoMarkers[0]?.label).toBe("Tokyo");
  });
});
