import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import {
  addAccount,
  addFeedItem,
  addPerson,
  addRssFeed,
} from "./schema.js";
import type { FreedDoc } from "./schema.js";
import type { Account, FeedItem, Person, RssFeed } from "./types.js";

/**
 * What the entity writers actually do with a dangerous map key.
 *
 * `__proto__`, `constructor`, and `prototype` are the keys that turn a plain
 * object into someone else's prototype chain. Feed item identifiers and account
 * identifiers come from provider capture, so these values are influenced from
 * outside the app rather than chosen by it.
 *
 * The codebase agrees this matters and disagrees about how to say so. There is
 * a canonical `UNSAFE_OBJECT_KEYS` set, six inline copies of the same literal
 * array across the reconcilers, a `__proto__`-only check in Facebook group
 * discovery, and two writers with no check at all. Nothing tested any of it.
 *
 * These tests state the behavior as it ships. They are deliberately not a fix:
 * adding a guard to `addPerson` would start rejecting records it accepts today,
 * which is a product decision. See
 * https://github.com/freed-project/freed/issues/1337.
 */

const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"] as const;

const emptyDoc = (): FreedDoc =>
  A.from({
    feedItems: {},
    persons: {},
    accounts: {},
    rssFeeds: {},
    preferences: {},
    meta: {},
  } as never) as unknown as FreedDoc;

const person = (id: string): Person =>
  ({
    id,
    name: "Person",
    relationshipStatus: "friend",
    careLevel: 4,
    createdAt: 1,
    updatedAt: 1,
  }) as Person;

const account = (id: string): Account =>
  ({
    id,
    personId: "person",
    kind: "social",
    provider: "rss",
    externalId: "external",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  }) as Account;

const feed = (url: string): RssFeed =>
  ({ url, title: "Example", enabled: true, trackUnread: false }) as RssFeed;

const item = (globalId: string): FeedItem =>
  ({
    globalId,
    platform: "rss",
    sourceId: "source",
    url: "https://example.com/1",
    publishedAt: 1,
    capturedAt: 1,
    author: { id: "author", displayName: "Author" },
    content: { text: "text", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  }) as unknown as FeedItem;

/** Each writer, its collection, and whether the source checks unsafe keys. */
const WRITERS = [
  {
    name: "addFeedItem",
    collection: "feedItems",
    guarded: true,
    write: (doc: FreedDoc, key: string) => addFeedItem(doc, item(key)),
  },
  {
    name: "addAccount",
    collection: "accounts",
    guarded: true,
    write: (doc: FreedDoc, key: string) => addAccount(doc, account(key)),
  },
  {
    name: "addPerson",
    collection: "persons",
    guarded: false,
    write: (doc: FreedDoc, key: string) => addPerson(doc, person(key)),
  },
  {
    name: "addRssFeed",
    collection: "rssFeeds",
    guarded: false,
    write: (doc: FreedDoc, key: string) => addRssFeed(doc, feed(key)),
  },
] as const;

const storedKeys = (
  writer: (typeof WRITERS)[number],
  key: string,
): string[] => {
  const doc = A.change(emptyDoc() as never, (draft: never) => {
    writer.write(draft as unknown as FreedDoc, key);
  });
  return Object.keys(
    (doc as unknown as Record<string, Record<string, unknown>>)[
      writer.collection
    ],
  );
};

describe("unsafe map keys in the entity writers", () => {
  it("covers every writer and both guard states", () => {
    // Guard the guard. If the table collapsed to one side, the contrast below
    // would stop being a contrast.
    expect(WRITERS.filter((writer) => writer.guarded)).toHaveLength(2);
    expect(WRITERS.filter((writer) => !writer.guarded)).toHaveLength(2);
    expect(UNSAFE_KEYS).toStrictEqual(["__proto__", "constructor", "prototype"]);
  });

  it("never writes a record under __proto__, guarded or not", () => {
    // Assignment through `__proto__` does not create an own property, so the
    // record is discarded by every writer. No error is raised, which means a
    // caller cannot tell the write was dropped.
    for (const writer of WRITERS) {
      expect(storedKeys(writer, "__proto__")).toStrictEqual([]);
    }
  });

  describe.each(WRITERS.filter((writer) => writer.guarded))(
    "$name checks the key",
    (writer) => {
      it.each(["constructor", "prototype"])("refuses %s", (key) => {
        expect(storedKeys(writer, key)).toStrictEqual([]);
      });

      it("still accepts an ordinary identifier", () => {
        // The positive control. A writer that refused everything would satisfy
        // the two assertions above without guarding anything.
        expect(storedKeys(writer, "ordinary-id")).toStrictEqual(["ordinary-id"]);
      });
    },
  );

  describe.each(WRITERS.filter((writer) => !writer.guarded))(
    "$name does not check the key",
    (writer) => {
      it.each(["constructor", "prototype"])("stores a record under %s", (key) => {
        // Recorded as the shipping behavior, not endorsed. A record living at
        // `constructor` shadows `Object.prototype.constructor` the moment the
        // collection is materialized into a plain object, which the SQLite
        // projection does.
        expect(storedKeys(writer, key)).toStrictEqual([key]);
      });

      it("still accepts an ordinary identifier", () => {
        expect(storedKeys(writer, "ordinary-id")).toStrictEqual(["ordinary-id"]);
      });
    },
  );
});
