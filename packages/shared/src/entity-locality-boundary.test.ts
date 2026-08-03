import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import {
  addAccount,
  addPerson,
  addRssFeed,
  updateAccount,
  updatePerson,
  updateRssFeed,
} from "./schema.js";
import type { FreedDoc } from "./schema.js";
import type { Account, Person, RssFeed } from "./types.js";
import {
  ACCOUNT_WRITE_POLICY,
  PERSON_WRITE_POLICY,
  RSS_FEED_WRITE_POLICY,
} from "./sync-write-policy.js";

/**
 * The device-local boundary for persons, accounts, and RSS feeds, proved
 * through every write path for every leaf.
 *
 * `packages/pwa/src/lib/sync-write-policy.test.ts` already covers this well,
 * both at the sanitizer level and through one generic mutation-boundary test.
 * What it cannot do is grow: it names one device-local leaf per write path by
 * hand, so a leaf added to a policy tomorrow gets no coverage until someone
 * remembers.
 *
 * Measured before writing this. Of the fourteen device-local and
 * compatibility-only leaves across the three entity policies, four had no
 * write-path coverage at all: `consecutiveFailures`, `lastFetchError`, `etag`,
 * and `lastModified`, each appearing only in a sanitizer-level assertion. The
 * first two are a feed's local failure state, so leaking them would turn one
 * machine's network trouble into every device's.
 *
 * Cases here are generated from the policy objects, so the matrix fills itself.
 */

const emptyDoc = (): FreedDoc =>
  A.from({
    feedItems: {},
    persons: {},
    accounts: {},
    rssFeeds: {},
    preferences: {},
    meta: {},
  } as never) as unknown as FreedDoc;

const person = (overrides: Partial<Person> = {}): Person =>
  ({
    id: "person",
    name: "Person",
    relationshipStatus: "friend",
    careLevel: 4,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Person;

const account = (overrides: Partial<Account> = {}): Account =>
  ({
    id: "account",
    personId: "person",
    kind: "social",
    provider: "rss",
    externalId: "external",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Account;

const feed = (overrides: Partial<RssFeed> = {}): RssFeed =>
  ({
    url: "https://example.com/feed",
    title: "Example",
    enabled: true,
    trackUnread: false,
    ...overrides,
  }) as RssFeed;

/**
 * The one record each fixture document holds.
 *
 * Reading by a fixed key would break on the identity leaves: `person.id`,
 * `account.id`, and `rssFeed.url` are the map key, so a probe that lands moves
 * the record. Looking it up by name would then report the leaf as stripped when
 * it was actually admitted, which is exactly backwards.
 */
const onlyRecord = (
  records: Record<string, Record<string, unknown>>,
): Record<string, unknown> | undefined => Object.values(records)[0];

const dispositionOf = (entry: unknown): string =>
  typeof entry === "string"
    ? entry
    : String((entry as { disposition?: unknown })?.disposition);

/**
 * Each entity's two write paths, plus how to read the stored record back.
 *
 * Both paths matter and they sanitize through different call sites: the add
 * paths go through `normalizePerson` / `sanitizeAccountWrite` /
 * `stripDeviceLocalRssFeedState`, the update paths through their own sanitize
 * call. A regression in one would not show up in the other.
 */
const ENTITIES = [
  {
    name: "person",
    policy: PERSON_WRITE_POLICY,
    add: (doc: FreedDoc, value: unknown) => addPerson(doc, person(value as Partial<Person>)),
    update: (doc: FreedDoc, value: unknown) => {
      addPerson(doc, person());
      updatePerson(doc, "person", value as Partial<Person>);
    },
    read: (doc: FreedDoc) =>
      onlyRecord(
        (doc as unknown as { persons: Record<string, Record<string, unknown>> })
          .persons,
      ),
  },
  {
    name: "account",
    policy: ACCOUNT_WRITE_POLICY,
    add: (doc: FreedDoc, value: unknown) => addAccount(doc, account(value as Partial<Account>)),
    update: (doc: FreedDoc, value: unknown) => {
      addAccount(doc, account());
      updateAccount(doc, "account", value as Partial<Account>);
    },
    read: (doc: FreedDoc) =>
      onlyRecord(
        (doc as unknown as { accounts: Record<string, Record<string, unknown>> })
          .accounts,
      ),
  },
  {
    name: "rssFeed",
    policy: RSS_FEED_WRITE_POLICY,
    add: (doc: FreedDoc, value: unknown) => addRssFeed(doc, feed(value as Partial<RssFeed>)),
    update: (doc: FreedDoc, value: unknown) => {
      addRssFeed(doc, feed());
      updateRssFeed(doc, "https://example.com/feed", value as Partial<RssFeed>);
    },
    read: (doc: FreedDoc) =>
      onlyRecord(
        (doc as unknown as { rssFeeds: Record<string, Record<string, unknown>> })
          .rssFeeds,
      ),
  },
] as const;

/**
 * Both write paths. Named as data so the matrix below cannot quietly shrink to
 * one: a mutation dropping `update` is otherwise invisible, because deleting
 * test cases never fails the cases that remain.
 */
const WRITE_PATHS = ["add", "update"] as const;

/** Probe values chosen so every leaf type has one that would survive if admitted. */
const PROBES = [1, "probe", true] as const;

const storedLeaf = (
  entity: (typeof ENTITIES)[number],
  path: "add" | "update",
  leaf: string,
  probe: unknown,
): unknown => {
  const doc = A.change(emptyDoc() as never, (draft: never) => {
    entity[path](draft as unknown as FreedDoc, { [leaf]: probe });
  });
  return entity.read(doc as unknown as FreedDoc)?.[leaf];
};

describe("entity locality boundary", () => {
  const cases = ENTITIES.flatMap((entity) =>
    Object.entries(entity.policy as Record<string, unknown>).map(
      ([leaf, entry]) => ({
        entity,
        entityName: entity.name,
        leaf,
        disposition: dispositionOf(entry),
      }),
    ),
  );

  const local = cases.filter(
    (entry) =>
      entry.disposition === "device-local" ||
      entry.disposition === "compatibility-only",
  );
  const synced = cases.filter(
    (entry) =>
      entry.disposition === "sync" || entry.disposition === "positive-sync",
  );
  const collections = cases.filter((entry) => entry.disposition === "nested");

  it("generates a case for every leaf of every entity policy", () => {
    // Guard the guard. Every leaf lands in exactly one bucket, so a policy that
    // stopped enumerating would fail here rather than emptying the suites.
    expect(cases.length).toBeGreaterThan(30);
    expect(local.length).toBe(14);
    expect(synced.length).toBeGreaterThan(10);
    expect(local.length + synced.length + collections.length).toBe(cases.length);
    expect(WRITE_PATHS).toStrictEqual(["add", "update"]);

    // The four that had no write-path coverage before this file existed.
    expect(local).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityName: "rssFeed", leaf: "consecutiveFailures" }),
        expect.objectContaining({ entityName: "rssFeed", leaf: "lastFetchError" }),
        expect.objectContaining({ entityName: "rssFeed", leaf: "etag" }),
        expect.objectContaining({ entityName: "rssFeed", leaf: "lastModified" }),
      ]),
    );
  });

  describe.each(WRITE_PATHS)("through the %s path", (path) => {
    it.each(local)(
      "$entityName.$leaf is $disposition and never reaches the document",
      ({ entity, leaf }) => {
        for (const probe of PROBES) {
          expect(storedLeaf(entity, path, leaf, probe)).toBeUndefined();
        }
      },
    );

    it.each(synced)(
      "$entityName.$leaf is $disposition and does reach the document",
      ({ entity, leaf }) => {
        // The positive control. Without it, a sanitizer that dropped every
        // field would satisfy all the assertions above.
        const landed = PROBES.some(
          (probe) => storedLeaf(entity, path, leaf, probe) !== undefined,
        );
        expect(landed).toBe(true);
      },
    );
  });
});
