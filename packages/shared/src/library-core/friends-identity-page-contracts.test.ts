import { describe, expect, it } from "vitest";
import {
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
  libraryCoreRssFeedPageRowToRssFeedV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedPageResponseV1,
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
      layoutRevision: 3,
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
          layoutRevision: 3,
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
          layoutRevision: 3,
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
    const rss = (
      url: string,
      overrides: Partial<
        Parameters<typeof libraryCoreRssFeedPageRowToRssFeedV1>[0]
      > = {},
    ) => ({
      activityCount: 0,
      enabled: true,
      folder: null,
      imageUrl: null,
      lastFetched: null,
      latestActivityAt: null,
      pollInterval: null,
      sampleBatchId: null,
      sampleGeneratedAt: null,
      sampleGeneratorVersion: null,
      siteUrl: null,
      title: url,
      trackUnread: false,
      unreadCount: 0,
      updatedAt: 1,
      url,
      ...overrides,
    });
    expect(
      parseLibraryCoreRssFeedPageResponseV1(
        {
          layoutRevision: 3,
          nextCursor: null,
          queryId: "rss_feed_page_v1",
          rows: [
            rss("https://alpha.example/feed", {
              activityCount: 4,
              latestActivityAt: 30,
              title: "Alpha",
              trackUnread: true,
              unreadCount: 2,
              updatedAt: 3,
            }),
            rss("https://beta.example/feed", {
              enabled: false,
              imageUrl: "https://beta.example/icon.png",
              sampleBatchId: "batch-1",
              sampleGeneratedAt: 2,
              sampleGeneratorVersion: 1,
              title: "Beta",
              updatedAt: 4,
            }),
          ],
          schemaVersion: 1,
          source,
        },
        { ...baseRequest, queryId: "rss_feed_page_v1" },
      ).ok,
    ).toBe(true);
    expect(
      libraryCoreRssFeedPageRowToRssFeedV1(
        rss("https://sample.example/feed", {
          sampleBatchId: "batch-1",
          sampleGeneratedAt: 2,
          sampleGeneratorVersion: 1,
        }),
      ),
    ).toMatchObject({
      sampleDataFingerprint: {
        marker: "freed.sample-data.v1",
        batchId: "batch-1",
      },
    });
  });
});
