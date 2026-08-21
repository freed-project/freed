import { describe, expect, it } from "vitest";
import type {
  LibraryCoreAccountGraphPageResponseV1,
  LibraryCorePersonGraphPageResponseV1,
  LibraryCoreRssFeedGraphPageResponseV1,
} from "@freed/shared/library-core";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  validateFriendsGalaxyProductWorkerResponse,
  type FriendsGalaxyProductWorkerRequest,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { FriendsGalaxySqliteSourceAccumulator } from "../../src/lib/friends-galaxy-sqlite-source.js";

const SOURCE = Object.freeze({
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
});

function personPage(
  source = SOURCE,
): LibraryCorePersonGraphPageResponseV1 {
  return {
    layoutRevision: 3,
    nextCursor: null,
    queryId: "person_graph_page_v1",
    rows: [{
      avatarUrl: null,
      careLevel: 5,
      graphPinned: true,
      graphUpdatedAt: 300,
      graphX: 12.5,
      graphY: -8.25,
      id: "person-1",
      lastReachOutAt: null,
      name: "Ada",
      reachOutIntervalDays: 7,
      relationshipStatus: "friend",
      updatedAt: 200,
    }],
    schemaVersion: 1,
    source,
  };
}

function accountPage(): LibraryCoreAccountGraphPageResponseV1 {
  return {
    layoutRevision: 3,
    nextCursor: null,
    queryId: "account_graph_page_v1",
    rows: [{
      activityCount: 12,
      avatarUrl: "https://example.com/account.png",
      discoveredFrom: "capture",
      displayName: "Ada Social",
      externalId: "ada-social",
      firstSeenAt: 50,
      followRosterActive: true,
      graphPinned: false,
      graphUpdatedAt: null,
      graphX: null,
      graphY: null,
      handle: "ada",
      id: "account-1",
      kind: "social",
      lastSeenAt: 210,
      latestActivityAt: 190,
      personId: "person-1",
      provider: "x",
      updatedAt: 210,
    }],
    schemaVersion: 1,
    source: SOURCE,
  };
}

function rssPage(): LibraryCoreRssFeedGraphPageResponseV1 {
  return {
    layoutRevision: 3,
    nextCursor: null,
    queryId: "rss_feed_graph_page_v1",
    rows: [{
      activityCount: 8,
      enabled: true,
      imageUrl: "https://example.com/feed.png",
      latestActivityAt: 180,
      title: "Example feed",
      updatedAt: 220,
      url: "https://example.com/feed.xml",
    }],
    schemaVersion: 1,
    source: SOURCE,
  };
}

function request(
  requestId: number,
  value: Omit<FriendsGalaxyProductWorkerRequest, "protocolVersion" | "requestId" | "sourceRevision">,
): FriendsGalaxyProductWorkerRequest {
  return {
    ...value,
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId,
    sourceRevision: 11,
  } as FriendsGalaxyProductWorkerRequest;
}

describe("Friends Galaxy normalized SQLite source", () => {
  it("streams fenced pages into one worker-owned scene without FeedItems", () => {
    const service = new FriendsGalaxyProductWorkerService();
    const requests: FriendsGalaxyProductWorkerRequest[] = [
      request(1, {
        kind: "normalized-source-begin",
        mode: "all_content",
        viewport: {
          height: 844,
          selectedPersonId: "person-1",
          width: 390,
        },
        proceduralBackgroundStarCount: 100_000,
      }),
      request(2, {
        cursor: null,
        kind: "normalized-source-page",
        page: personPage(),
      }),
      request(3, {
        cursor: null,
        kind: "normalized-source-page",
        page: accountPage(),
      }),
      request(4, {
        cursor: null,
        kind: "normalized-source-page",
        page: rssPage(),
      }),
      request(5, { kind: "normalized-source-commit" }),
    ];
    let response = service.handle(requests[0]!);
    validateFriendsGalaxyProductWorkerResponse(response, requests[0]!);
    for (const next of requests.slice(1)) {
      response = service.handle(next);
      validateFriendsGalaxyProductWorkerResponse(response, next);
    }
    if (response.kind !== "source-ready") throw new Error("Expected source scene.");
    expect(response.rendererScene.scene.nodeIds).toEqual(expect.arrayContaining([
      "person:person-1",
      "account:account-1",
      "feed:https://example.com/feed.xml",
    ]));
    const person = response.rendererScene.atlas.nodes.find(
      (node) => node.personId === "person-1",
    );
    expect(person).toMatchObject({ activityCount: 12, graphPinned: true });
    expect(response).not.toHaveProperty("source");
    expect(response).not.toHaveProperty("feedItems");
  });

  it("rejects reordered query families and a mixed canonical fence", () => {
    const reordered = new FriendsGalaxySqliteSourceAccumulator({
      height: 900,
      mode: "all_content",
      width: 1_400,
    });
    expect(() => reordered.append({ cursor: null, page: accountPage() })).toThrow();

    const mixed = new FriendsGalaxySqliteSourceAccumulator({
      height: 900,
      mode: "all_content",
      width: 1_400,
    });
    mixed.append({ cursor: null, page: personPage() });
    expect(() => mixed.append({
      cursor: null,
      page: {
        ...accountPage(),
        source: { ...SOURCE, projectionRevision: 8, transitionSequence: 8 },
      },
    })).toThrow("different source fence");
  });
});
