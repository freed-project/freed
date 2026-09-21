import { describe, expect, it } from "vitest";
import { describeLibraryFollowerProgress } from "./library-core-follower-status";
import type { NormalizedLibraryFollowerRuntimeStatus } from "./sqlite-library";

const active: NormalizedLibraryFollowerRuntimeStatus = {
  state: "active", libraryId: "library", authorityEpochId: "epoch", actorId: "actor",
  checkpointGeneration: 1, sourceRevision: 2, pendingIntentCount: 0,
  publishedIntentCount: 0, importedResultCount: 10, awaitingCanonicalChanges: false,
};

describe("consumer synchronization progress", () => {
  it("keeps accepted changes pending until canonical application and reports simultaneous queues", () => {
    const result = describeLibraryFollowerProgress({ ...active, awaitingCanonicalChanges: true,
      pendingIntentCount: 1, publishedIntentCount: 2 });
    expect(result.statusMessage).toBe("Library edits are still synchronizing.");
    expect(result.pendingReason).toBe("1 edit waiting to upload. 2 edits awaiting Primary acceptance. Accepted changes waiting to apply.");
    expect(describeLibraryFollowerProgress({ ...active, awaitingCanonicalChanges: true }).statusMessage)
      .toBe("Library edits are still synchronizing.");
    expect(describeLibraryFollowerProgress(active).statusMessage).toBe("No local edits waiting to sync.");
  });

  it("does not describe unenrolled readers as editable or infer Primary availability", () => {
    for (const state of ["awaiting_enrollment", "enrollment_pending"] as const) {
      expect(describeLibraryFollowerProgress({ ...active, state }).statusMessage)
        .toBe("Waiting for Primary enrollment.");
    }
    expect(describeLibraryFollowerProgress({ ...active, state: "awaiting_checkpoint" }).statusMessage)
      .toBe("Waiting for the Primary Library.");
  });
});
