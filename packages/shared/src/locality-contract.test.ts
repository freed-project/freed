import { describe, expect, it } from "vitest";

import {
  FEED_ITEM_WRITE_POLICY,
  deleteBehaviorOf,
  dispositionOf,
  sanitizeFeedItemWrite,
  tierOf,
} from "./sync-write-policy.js";

// Stage 3 of the storage roadmap. The value here is not runtime behavior, it is
// forcing the tier and deletion questions to be answered field by field, in
// review, before Stage 4 generates a schema from these answers.
describe("locality and deletion contract", () => {
  it("keeps bare dispositions working so the other 35 policy objects compile unchanged", () => {
    expect(dispositionOf("sync")).toBe("sync");
    expect(dispositionOf("nested")).toBe("nested");
    // Undecided, not defaulted. A field that has not opted into the richer form
    // must read as "nobody has answered this yet", never as a silent default.
    expect(tierOf("sync")).toBeUndefined();
    expect(deleteBehaviorOf("sync")).toBeUndefined();
  });

  it("reads the richer form without changing the disposition", () => {
    const policy = {
      disposition: "nested",
      tier: "blob",
      delete: "cascade",
    } as const;
    expect(dispositionOf(policy)).toBe("nested");
    expect(tierOf(policy)).toBe("blob");
    expect(deleteBehaviorOf(policy)).toBe("cascade");
  });

  it("puts the two prose fields in the blob tier", () => {
    // Measured on the owner's real document: content is 52.1% of the serialized
    // corpus and preservedContent a further 22.9%. Three quarters of the CRDT is
    // article prose that is immutable once captured and never concurrently
    // edited, so it gains nothing from merge semantics.
    expect(tierOf(FEED_ITEM_WRITE_POLICY.content)).toBe("blob");
    expect(tierOf(FEED_ITEM_WRITE_POLICY.preservedContent)).toBe("blob");
    expect(deleteBehaviorOf(FEED_ITEM_WRITE_POLICY.content)).toBe("cascade");
    expect(deleteBehaviorOf(FEED_ITEM_WRITE_POLICY.preservedContent)).toBe("cascade");
  });

  it("keeps userState hot, because filtering and counts read it on every query", () => {
    expect(tierOf(FEED_ITEM_WRITE_POLICY.userState)).toBe("hot");
  });

  it("requires a tombstone for item identity", () => {
    // The whole reason this vocabulary exists. There are eight sites in
    // schema.ts that delete a feed item and no tombstone concept anywhere.
    // Automerge hides that by propagating a delete as an operation; row-level
    // replication will not, and a peer that misses the delete can resurrect the
    // item on its next upward sync.
    expect(deleteBehaviorOf(FEED_ITEM_WRITE_POLICY.globalId)).toBe("tombstone");
  });

  it("still sanitizes fields written in the richer form", () => {
    // Regression guard for a hole introduced while writing this contract.
    // sanitizeByPolicy compared the raw policy entry against string literals,
    // so a field wrapped in {disposition, tier, delete} matched no branch, fell
    // through `disposition !== "nested"`, and was SILENTLY DROPPED from every
    // sanitized write. Types alone did not catch it: these policy objects are
    // runtime data, not just type-level annotations.
    const sanitized = sanitizeFeedItemWrite({
      content: { text: "kept", mediaUrls: [], mediaTypes: [] },
      preservedContent: { text: "also kept", preservedAt: 1, wordCount: 2, readingTime: 1 },
    } as never);
    expect(sanitized.content).toBeDefined();
    expect(sanitized.preservedContent).toBeDefined();
  });

  it("does not silently answer the fields nobody has decided yet", () => {
    // Deliberate: only the fields with measured evidence carry a tier. The rest
    // must stay undecided so review has to confront them rather than inherit a
    // default that looks like a decision.
    expect(tierOf(FEED_ITEM_WRITE_POLICY.topics)).toBeUndefined();
    expect(tierOf(FEED_ITEM_WRITE_POLICY.contentSignals)).toBeUndefined();
  });
});
