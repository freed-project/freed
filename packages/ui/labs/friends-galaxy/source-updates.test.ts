import { describe, expect, it, vi } from "vitest";
import type { Account, Person, RssFeed } from "@freed/shared";
import {
  sameFriendsGalaxyAccounts,
  sameFriendsGalaxyFeeds,
  sameFriendsGalaxyPersons,
} from "../../src/lib/friends-galaxy-source-equality.js";
import { FriendsGalaxySourceScheduler } from "../../src/lib/friends-galaxy-source-scheduler.js";

const person: Person = {
  id: "person-1",
  name: "Ari Frost",
  relationshipStatus: "friend",
  careLevel: 4,
  createdAt: 1,
  updatedAt: 1,
};

const account: Account = {
  id: "account-1",
  personId: person.id,
  kind: "social",
  provider: "x",
  externalId: "ari",
  displayName: "Ari Frost",
  firstSeenAt: 1,
  lastSeenAt: 1,
  discoveredFrom: "captured_item",
  createdAt: 1,
  updatedAt: 1,
};

const feed: RssFeed = {
  url: "https://example.com/feed.xml",
  title: "Example",
  enabled: true,
  trackUnread: false,
};

describe("Friends Galaxy structural source updates", () => {
  it("ignores metadata and activity fields that do not alter graph structure", () => {
    expect(sameFriendsGalaxyPersons(
      [person],
      [{ ...person, notes: "Changed", tags: ["new"], updatedAt: 2 }],
    )).toBe(true);
    expect(sameFriendsGalaxyAccounts(
      { [account.id]: account },
      {
        [account.id]: {
          ...account,
          lastSeenAt: 2,
          profileUrl: "https://example.com/ari",
          followRosterSyncedAt: 2,
          updatedAt: 2,
        },
      },
    )).toBe(true);
    expect(sameFriendsGalaxyFeeds(
      { [feed.url]: feed },
      {
        [feed.url]: {
          ...feed,
          lastFetched: 2,
          lastFetchError: "Temporary failure",
          nextFetchAfter: 3,
        },
      },
    )).toBe(true);
  });

  it("detects fields that change topology, placement, or presentation", () => {
    expect(sameFriendsGalaxyPersons([person], [{ ...person, careLevel: 5 }])).toBe(false);
    expect(sameFriendsGalaxyAccounts(
      { [account.id]: account },
      { [account.id]: { ...account, personId: undefined } },
    )).toBe(false);
    expect(sameFriendsGalaxyFeeds(
      { [feed.url]: feed },
      { [feed.url]: { ...feed, enabled: false } },
    )).toBe(false);
  });

  it("admits isolated sources immediately and bounds a sustained burst", () => {
    vi.useFakeTimers();
    try {
      const flushed: number[] = [];
      const scheduler = new FriendsGalaxySourceScheduler<number>({
        flush: (value) => flushed.push(value),
        now: () => Date.now(),
        quietMs: 600,
        maxWaitMs: 2_000,
      });

      scheduler.request(1);
      expect(flushed).toEqual([1]);
      for (let revision = 2; revision <= 9; revision += 1) {
        vi.advanceTimersByTime(250);
        scheduler.request(revision);
      }
      vi.advanceTimersByTime(250);
      expect(flushed).toEqual([1, 9]);

      vi.advanceTimersByTime(700);
      scheduler.request(10);
      expect(flushed).toEqual([1, 9, 10]);
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
