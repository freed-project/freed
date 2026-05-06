import { describe, expect, it } from "vitest";
import {
  getLatestAuthorLocationMarkers,
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

  it("keeps marker group counts correct without rescanning every location for every marker", () => {
    const adaParis = createItem(
      "ig:ada:paris",
      NOW - 90_000,
      "Paris",
      { lat: 48.8566, lng: 2.3522 },
    );
    const adaParisEarlier = createItem(
      "ig:ada:paris-earlier",
      NOW - 120_000,
      "Paris",
      { lat: 48.8566, lng: 2.3522 },
    );
    const adaRome = createItem(
      "ig:ada:rome",
      NOW - 30_000,
      "Rome",
      { lat: 41.9028, lng: 12.4964 },
    );
    const authorParis = {
      ...createItem(
        "ig:nora:paris",
        NOW - 60_000,
        "Paris",
        { lat: 48.8566, lng: 2.3522 },
      ),
      author: {
        id: "nora-ig",
        handle: "nora",
        displayName: "Nora Quinn",
      },
    };
    const authorParisLater = {
      ...authorParis,
      globalId: "ig:nora:paris-later",
      publishedAt: NOW - 10_000,
      capturedAt: NOW - 10_000,
    };

    const resolvedItems = [
      resolved(adaParis, { lat: 48.8566, lng: 2.3522 }),
      resolved(adaParisEarlier, { lat: 48.8566, lng: 2.3522 }),
      resolved(adaRome, { lat: 41.9028, lng: 12.4964 }),
      {
        item: authorParis,
        friend: null,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
      {
        item: authorParisLater,
        friend: null,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
    ];

    const friendMarkers = getLatestFriendLocationMarkers(resolvedItems, { now: NOW });
    expect(friendMarkers).toHaveLength(1);
    expect(friendMarkers[0]?.label).toBe("Rome");
    expect(friendMarkers[0]?.groupCount).toBe(1);

    const authorMarkers = getLatestAuthorLocationMarkers(resolvedItems, { now: NOW });
    const noraMarker = authorMarkers.find((marker) => marker.authorKey === "author:instagram:nora-ig");
    expect(noraMarker?.groupCount).toBe(2);
  });

  it("builds dense all-content map markers within the interaction budget", () => {
    const authorCount = 4_000;
    const resolvedItems: ResolvedLocationItem[] = [];

    for (let authorIndex = 0; authorIndex < authorCount; authorIndex += 1) {
      for (let postIndex = 0; postIndex < 3; postIndex += 1) {
        const publishedAt = NOW - postIndex * 60_000;
        const item = createItem(
          `ig:author-${authorIndex}:post-${postIndex}`,
          publishedAt,
          `Location ${authorIndex}`,
          {
            lat: 30 + (authorIndex % 80) * 0.1,
            lng: -120 + (authorIndex % 120) * 0.1,
          },
        );
        item.author = {
          id: `author-${authorIndex}`,
          handle: `author-${authorIndex}`,
          displayName: `Author ${authorIndex}`,
        };
        resolvedItems.push({
          item,
          friend: null,
          lat: item.location!.coordinates!.lat,
          lng: item.location!.coordinates!.lng,
          label: item.location!.name,
        });
      }
    }

    const startedAt = performance.now();
    const markers = getLatestAuthorLocationMarkers(resolvedItems, { now: NOW });
    const elapsed = performance.now() - startedAt;

    console.log(`[PERF] Map all-content marker prep: ${elapsed.toFixed(1)} ms for ${resolvedItems.length.toLocaleString()} locations`);
    expect(markers).toHaveLength(authorCount);
    expect(markers[0]?.groupCount).toBe(3);
    expect(elapsed).toBeLessThan(500);
  });
});
