import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  blobTierFields,
  deviceLocalFields,
  diffProjection,
  projectFeedItem,
  reconstructFeedItem,
} from "./projection.js";
import type { FeedItem } from "./types.js";

/**
 * Stage 4 of the storage roadmap. Nothing reads the projected rows yet, so
 * there is no behavior to test. What is being tested is a property: the
 * projection is reversible. Stage 8 turns the write path one-way, and once the
 * retained Automerge copy is pruned, a field the projector drops is gone. This
 * file is the evidence that has to exist before that is allowed to happen.
 *
 * The round-trip is asserted with `toStrictEqual`, which distinguishes a
 * missing key from a key holding undefined. That distinction is the whole
 * subject of half these cases.
 */

function roundTrip(item: unknown): unknown {
  return reconstructFeedItem(projectFeedItem(item as FeedItem));
}

function expectLossless(item: Record<string, unknown>): void {
  expect(roundTrip(item)).toStrictEqual(item);
}

const complete: Record<string, unknown> = {
  globalId: "x:1",
  platform: "x",
  contentType: "post",
  publishedAt: 1_780_000_000_000,
  capturedAt: 1_780_000_001_000,
  author: { id: "a:1", handle: "someone", displayName: "Someone", avatarUrl: "https://e/a.png" },
  sourceUrl: "https://example.test/1",
  content: { text: "hello", mediaUrls: [], mediaTypes: [] },
  preservedContent: { text: "hello", preservedAt: 1, wordCount: 1, readingTime: 1 },
  userState: { hidden: false, saved: true, archived: false, tags: ["a", "b"], readAt: 7 },
  topics: ["tech"],
  engagement: { likes: 3, reposts: 0, replies: 1 },
};

describe("feed item projection", () => {
  it("round-trips a fully populated item", () => {
    expectLossless(complete);
  });

  it("preserves absence instead of inventing a default", () => {
    // The bug this pins cost a full corpus pass to find. The first draft wrote
    // `String(author.name ?? "")` and `asEpoch(publishedAt) ?? 0`, which turns
    // "never set" into "empty string" and "epoch zero". Under Stage 8 that
    // fabrication is unrecoverable, because there is no second copy to
    // reconstruct the truth from.
    const sparse = { globalId: "x:2", author: { id: "a:2" }, userState: { saved: true } };
    const back = roundTrip(sparse) as Record<string, unknown>;
    expect(back).toStrictEqual(sparse);
    expect("publishedAt" in back).toBe(false);
    expect("platform" in back).toBe(false);
    expect("displayName" in (back.author as object)).toBe(false);
    expect("hidden" in (back.userState as object)).toBe(false);
  });

  it("tells a null value apart from a missing one", () => {
    // Both produce a null column. Only `__absent` can distinguish them, which
    // is why the column alone is not the whole record.
    const withNull = { globalId: "x:3", sourceUrl: null, publishedAt: null };
    const back = roundTrip(withNull) as Record<string, unknown>;
    expect(back).toStrictEqual(withNull);
    expect("sourceUrl" in back).toBe(true);
    expect(back.sourceUrl).toBeNull();
  });

  it("projects against the real field names on Author", () => {
    // The first draft read `author.name`, which does not exist on Author (it is
    // `displayName`). tsc did not catch it, because the projector had cast the
    // author to Record<string, unknown> to read it. The cast added to silence
    // the compiler is what hid the bug from the compiler.
    const row = projectFeedItem(complete as unknown as FeedItem);
    expect(row.authorDisplayName).toBe("Someone");
    expect(row.authorHandle).toBe("someone");
    expect(row.authorId).toBe("a:1");
  });

  it("carries unmodelled fields through untouched", () => {
    // Losslessness has to hold by construction, not by keeping a list current.
    // A field nobody thought about when writing the schema still survives.
    const exotic = {
      ...complete,
      someFutureField: { nested: { deeply: [1, 2, { three: true }] } },
      anotherOne: "value",
    };
    expectLossless(exotic);
  });

  it("carries unmodelled userState and author keys through untouched", () => {
    const extra = {
      ...complete,
      userState: { ...(complete.userState as object), likedSyncedAt: null, hiddenSyncedAt: 42 },
      author: { ...(complete.author as object), verified: true },
    };
    expectLossless(extra);
  });

  it("preserves non-finite numbers that JSON alone would flatten to null", () => {
    // Three items in the owner's 15,846-item corpus hold NaN in
    // preservedContent.publishedAt, from an upstream date parse. JSON.stringify
    // renders all three non-finite values as null. Rewriting them would be a
    // data repair performed by the storage layer, which is the wrong place to
    // decide that, so they are encoded and restored exactly.
    const nonFinite = {
      globalId: "x:4",
      preservedContent: { publishedAt: NaN, a: Infinity, b: -Infinity },
    };
    const back = roundTrip(nonFinite) as Record<string, unknown>;
    const preserved = back.preservedContent as Record<string, number>;
    expect(Number.isNaN(preserved.publishedAt)).toBe(true);
    expect(preserved.a).toBe(Infinity);
    expect(preserved.b).toBe(-Infinity);
  });

  it("preserves a value a column cannot represent", () => {
    // Columns are a query optimization over a document with no enforced schema.
    // `publishedAt` is declared number, but nothing stopped a past writer from
    // putting a string there. The row keeps the column null and the real value
    // comes back unchanged.
    const wrongTypes = { globalId: "x:5", publishedAt: "2026-01-01", hidden: 1 };
    expectLossless(wrongTypes);
    expect(projectFeedItem(wrongTypes as unknown as FeedItem).publishedAt).toBeNull();
  });

  it("preserves author and userState when they are not objects at all", () => {
    // Each is spread across several columns, so a non-object has nowhere to go.
    // Without the escape it would reconstruct as {}, silently.
    expectLossless({ globalId: "x:6", author: null, userState: null });
    expectLossless({ globalId: "x:7", author: "unexpected" });
  });

  it("keeps the blob-tier fields out of the row columns", () => {
    // The Stage 3 contract, not this file, decides which fields are blob-tier.
    // Reading it back here is what keeps the two from drifting apart.
    expect(blobTierFields().sort()).toStrictEqual(["content", "preservedContent"]);
    const row = projectFeedItem(complete as unknown as FeedItem);
    for (const field of blobTierFields()) {
      expect(row.rest).not.toContain(`"${field}"`);
    }
    expect(row.contentBlob).toContain("hello");
    expect(row.preservedBlob).toContain("preservedAt");
  });

  it("never projects a device-local field into a row", () => {
    const row = projectFeedItem(complete as unknown as FeedItem);
    const serialized = JSON.stringify(row);
    for (const field of deviceLocalFields()) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });

  it("reports a mismatch when the projection actually loses something", () => {
    // A differ that cannot fail proves nothing. Corrupt a row by hand and
    // confirm the comparison catches it.
    const row = projectFeedItem(complete as unknown as FeedItem);
    const back = reconstructFeedItem({ ...row, authorDisplayName: "Somebody Else" });
    expect((back.author as Record<string, unknown>).displayName).toBe("Somebody Else");
    expect(back).not.toStrictEqual(complete);
  });
});

/**
 * The synthetic cases above were all written after the fact, each one pinning
 * something the corpus run had already caught. That ordering is the point: the
 * real document found two bugs that no case here would have been written to
 * look for. It stays opt-in because the fixture is the owner's private data and
 * cannot live in the repository.
 */
const fixture = process.env.FREED_CORPUS_FIXTURE;
const hasFixture = fixture !== undefined && fixture !== "" && existsSync(fixture);

describe.skipIf(!hasFixture)("projection against a real corpus", () => {
  it("loses nothing across every item in the document", async () => {
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const items = Object.keys((doc as { feedItems?: object }).feedItems ?? {}).length;
    expect(items).toBeGreaterThan(0);

    const mismatches = diffProjection(doc as never);
    if (mismatches.length > 0) {
      const sample = mismatches
        .slice(0, 10)
        .map((m) => `${m.globalId} ${m.path}: ${String(m.original)} -> ${String(m.roundTripped)}`);
      throw new Error(
        `${mismatches.length} of ${items} items did not survive the round trip:\n${sample.join("\n")}`,
      );
    }
  }, 120_000);
});
