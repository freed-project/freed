import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import {
  addAccount,
  addFeedItem,
  addPerson,
  addRssFeed,
  isSafeObjectKey,
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
 * One exported predicate now owns the rule. Every direct entity writer rejects
 * the same keys and returns whether it accepted the write, so callers can
 * observe a refused record instead of mistaking a silent drop for success.
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

/** Each writer and its collection. */
const WRITERS = [
  {
    name: "addFeedItem",
    collection: "feedItems",
    write: (doc: FreedDoc, key: string) => addFeedItem(doc, item(key)),
  },
  {
    name: "addAccount",
    collection: "accounts",
    write: (doc: FreedDoc, key: string) => addAccount(doc, account(key)),
  },
  {
    name: "addPerson",
    collection: "persons",
    write: (doc: FreedDoc, key: string) => addPerson(doc, person(key)),
  },
  {
    name: "addRssFeed",
    collection: "rssFeeds",
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
  it("owns one canonical key rule", () => {
    expect(UNSAFE_KEYS).toStrictEqual(["__proto__", "constructor", "prototype"]);
    expect(UNSAFE_KEYS.every((key) => !isSafeObjectKey(key))).toBe(true);
    expect(isSafeObjectKey("ordinary-id")).toBe(true);
  });

  it("never writes a record under __proto__, guarded or not", () => {
    for (const writer of WRITERS) {
      expect(storedKeys(writer, "__proto__")).toStrictEqual([]);
    }
  });

  describe.each(WRITERS)(
    "$name",
    (writer) => {
      it.each(UNSAFE_KEYS)("refuses %s observably", (key) => {
        let accepted = true;
        const doc = A.change(emptyDoc() as never, (draft: never) => {
          accepted = writer.write(draft as unknown as FreedDoc, key);
        });
        expect(accepted).toBe(false);
        expect(storedKeys(writer, key)).toStrictEqual([]);
        expect(
          Object.keys(
            (doc as unknown as Record<string, Record<string, unknown>>)[writer.collection],
          ),
        ).toStrictEqual([]);
      });

      it("accepts an ordinary identifier observably", () => {
        let accepted = false;
        A.change(emptyDoc() as never, (draft: never) => {
          accepted = writer.write(draft as unknown as FreedDoc, "ordinary-id");
        });
        expect(accepted).toBe(true);
        expect(storedKeys(writer, "ordinary-id")).toStrictEqual(["ordinary-id"]);
      });
    },
  );
});
