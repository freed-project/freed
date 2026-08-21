import { describe, expect, it } from "vitest";
import {
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedGraphPageResponseV1,
} from "./friends-identity-page-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

const baseRequest = {
  cancellationId: "cancel-1",
  cursor: null,
  limit: 2,
  readerSessionId: "reader-1",
  schemaVersion: 1 as const,
};

describe("Friends identity page contracts", () => {
  it("shares one source-fenced identity cursor across Person and Account pages", () => {
    const cursor = encodeLibraryCoreIdentityPageCursorV1({
      entityId: "person-2",
      generationId: source.generationId,
      projectionRevision: 7,
      transitionSequence: 7,
    });
    expect(decodeLibraryCoreIdentityPageCursorV1(cursor)).toMatchObject({
      ok: true,
      value: { entityId: "person-2", generationId: source.generationId },
    });
    expect(
      parseLibraryCorePersonGraphPageResponseV1(
        {
          nextCursor: cursor,
          queryId: "person_graph_page_v1",
          rows: [
            {
              avatarUrl: null,
              careLevel: 5,
              graphPinned: false,
              graphUpdatedAt: null,
              graphX: null,
              graphY: null,
              id: "person-1",
              lastReachOutAt: null,
              name: "Ada",
              reachOutIntervalDays: 14,
              relationshipStatus: "friend",
              updatedAt: 10,
            },
            {
              avatarUrl: null,
              careLevel: 4,
              graphPinned: false,
              graphUpdatedAt: null,
              graphX: null,
              graphY: null,
              id: "person-2",
              lastReachOutAt: 9,
              name: "Grace",
              reachOutIntervalDays: null,
              relationshipStatus: "friend",
              updatedAt: 11,
            },
          ],
          schemaVersion: 1,
          source,
        },
        { ...baseRequest, queryId: "person_graph_page_v1" },
      ).ok,
    ).toBe(true);
  });

  it("rejects unordered Account rows and cursors from another source", () => {
    const account = (id: string) => ({
      activityCount: 0,
      avatarUrl: null,
      discoveredFrom: "capture",
      displayName: null,
      externalId: id,
      firstSeenAt: 1,
      followRosterActive: null,
      graphPinned: false,
      graphUpdatedAt: null,
      graphX: null,
      graphY: null,
      handle: null,
      id,
      kind: "social",
      lastSeenAt: 2,
      latestActivityAt: null,
      personId: null,
      provider: "x",
      updatedAt: 2,
    });
    expect(
      parseLibraryCoreAccountGraphPageResponseV1(
        {
          nextCursor: null,
          queryId: "account_graph_page_v1",
          rows: [account("account-2"), account("account-1")],
          schemaVersion: 1,
          source,
        },
        { ...baseRequest, queryId: "account_graph_page_v1" },
      ).ok,
    ).toBe(false);
  });

  it("accepts compact binary-ordered RSS feed rows", () => {
    expect(
      parseLibraryCoreRssFeedGraphPageResponseV1(
        {
          nextCursor: null,
          queryId: "rss_feed_graph_page_v1",
          rows: [
            {
              activityCount: 4,
              enabled: true,
              imageUrl: null,
              latestActivityAt: 30,
              title: "Alpha",
              updatedAt: 3,
              url: "https://alpha.example/feed",
            },
            {
              activityCount: 0,
              enabled: false,
              imageUrl: "https://beta.example/icon.png",
              latestActivityAt: null,
              title: "Beta",
              updatedAt: 4,
              url: "https://beta.example/feed",
            },
          ],
          schemaVersion: 1,
          source,
        },
        { ...baseRequest, queryId: "rss_feed_graph_page_v1" },
      ).ok,
    ).toBe(true);
  });
});
