import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import {
  addAccount,
  addPerson,
  clearSampleData,
  logReachOut,
  removeAccount,
  removePerson,
  updateAccount,
  updatePerson,
} from "./schema.js";
import type { FreedDoc } from "./schema.js";
import type { Account, Person } from "./types.js";

/**
 * Every person and account mutator survives a document that predates the
 * identity graph.
 *
 * `ensureIdentityGraphRoots` runs at the top of twelve mutators and creates
 * `persons` and `accounts` when they are missing. A document saved before
 * those roots existed has neither, so without the guard the first
 * `doc.persons[id]` would throw and the mutator would take the whole
 * `A.change` down with it.
 *
 * The guard is module-private, so these tests drive it through the public
 * mutators. That is the stronger test anyway: it proves the guard is wired
 * into each entry point, not merely that the helper works when called.
 *
 * Nothing referenced this behaviour before. The guard is a migration
 * affordance, and the documents it protects are by definition old ones nobody
 * creates any more, which is exactly the kind of code that rots unnoticed.
 */

/** A document shaped like one saved before the identity graph existed. */
const legacyDoc = (): FreedDoc =>
  A.from({
    feedItems: {},
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
    personId: "person-1",
    kind: "social",
    provider: "rss",
    externalId: "external",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  }) as Account;

const roots = (doc: unknown): { persons?: unknown; accounts?: unknown } =>
  doc as { persons?: unknown; accounts?: unknown };

/**
 * Each guarded mutator, exercised from a document with no identity roots.
 *
 * Named as data so the matrix cannot quietly shrink to the two easy cases.
 */
const GUARDED_MUTATORS: ReadonlyArray<{
  readonly name: string;
  readonly run: (doc: FreedDoc) => void;
}> = [
  { name: "addPerson", run: (doc) => addPerson(doc, person("person-1")) },
  {
    name: "updatePerson",
    run: (doc) => updatePerson(doc, "person-1", { name: "Renamed" }),
  },
  { name: "removePerson", run: (doc) => removePerson(doc, "person-1") },
  {
    name: "logReachOut",
    run: (doc) =>
      logReachOut(doc, "person-1", {
        loggedAt: 1,
        channel: "call",
      } as never),
  },
  { name: "addAccount", run: (doc) => addAccount(doc, account("account-1")) },
  {
    name: "updateAccount",
    run: (doc) => updateAccount(doc, "account-1", { displayName: "Renamed" }),
  },
  { name: "removeAccount", run: (doc) => removeAccount(doc, "account-1") },
  { name: "clearSampleData", run: (doc) => clearSampleData(doc) },
];

describe("identity graph roots on a legacy document", () => {
  it("covers every guarded mutator", () => {
    // Guard the guard. If this list shrank, the cases below would still pass
    // while covering less.
    expect(GUARDED_MUTATORS).toHaveLength(8);
    expect(roots(legacyDoc()).persons).toBeUndefined();
    expect(roots(legacyDoc()).accounts).toBeUndefined();
  });

  it.each(GUARDED_MUTATORS)(
    "$name creates the missing roots instead of throwing",
    ({ run }) => {
      const doc = A.change(legacyDoc() as never, (draft: never) => {
        run(draft as unknown as FreedDoc);
      });

      expect(roots(doc).persons).toBeDefined();
      expect(roots(doc).accounts).toBeDefined();
    },
  );

  it("does not disturb roots that already exist", () => {
    // The guard fills gaps. A mutator that reset a populated root would lose
    // the whole identity graph, so absence of that is asserted rather than
    // assumed from reading the two `if` statements.
    let doc = A.change(legacyDoc() as never, (draft: never) => {
      addPerson(draft as unknown as FreedDoc, person("person-1"));
      addAccount(draft as unknown as FreedDoc, account("account-1"));
    });

    doc = A.change(doc, (draft: never) => {
      addPerson(draft as unknown as FreedDoc, person("person-2"));
    });

    const persons = roots(doc).persons as Record<string, unknown>;
    const accounts = roots(doc).accounts as Record<string, unknown>;
    expect(Object.keys(persons).sort()).toStrictEqual(["person-1", "person-2"]);
    expect(Object.keys(accounts)).toStrictEqual(["account-1"]);
  });

  it("leaves a legacy document usable end to end", () => {
    // The point of the guard is that an old document keeps working, not just
    // that one call survives.
    let doc = A.change(legacyDoc() as never, (draft: never) => {
      addPerson(draft as unknown as FreedDoc, person("person-1"));
    });
    doc = A.change(doc, (draft: never) => {
      updatePerson(draft as unknown as FreedDoc, "person-1", {
        name: "Renamed",
      });
    });
    doc = A.change(doc, (draft: never) => {
      addAccount(draft as unknown as FreedDoc, account("account-1"));
      updateAccount(draft as unknown as FreedDoc, "account-1", {
        displayName: "Linked",
      });
    });

    const persons = roots(doc).persons as Record<string, { name?: string }>;
    const accounts = roots(doc).accounts as Record<
      string,
      { displayName?: string }
    >;
    expect(persons["person-1"]?.name).toBe("Renamed");
    expect(accounts["account-1"]?.displayName).toBe("Linked");
  });
});
