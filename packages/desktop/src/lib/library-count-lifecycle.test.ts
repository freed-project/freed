import { describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
import { desktopLibraryCountResource as counts } from "./library-count-resource";
import { prepareNormalizedLibraryConsumerRecovery, commitNormalizedLibraryConsumerRecovery,
  resetNormalizedLibrary, restoreNormalizedLocalSnapshot, activateNormalizedLibraryTargetHandoff,
  adoptNormalizedLibrarySourceHandoff } from "./sqlite-library";
const id = "a".repeat(64), selection = { libraryId: id, authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) };
const recovery = { recoveryId: id, libraryId: id, predecessorEpochId: "b".repeat(64), successorEpochId: "d".repeat(64), state: "prepared", archivedPendingEdits: 0, archivedPublishedEdits: 0 };
describe("native transition wrappers retire count activation", () => {
  it.each([
    ["prepare recovery", () => prepareNormalizedLibraryConsumerRecovery(), recovery],
    ["commit recovery", () => commitNormalizedLibraryConsumerRecovery(id), recovery],
    ["reset", () => resetNormalizedLibrary(), undefined],
    ["restore", () => restoreNormalizedLocalSnapshot("synthetic", { operationId: id, restoredAtMs: 1 }), {}],
    ["target activation", () => activateNormalizedLibraryTargetHandoff(id, "synthetic"), {}],
    ["source adoption", () => adoptNormalizedLibrarySourceHandoff({ handoffId: id, stageId: "synthetic", canonicalControl: "synthetic", accessToken: "synthetic" }), {}],
  ] as const)("%s invalidates before native work and blocks acceptance until acknowledgement", async (_label, operation, result) => {
    counts.invalidate(); counts.setSelection(selection); const epoch = counts.getSnapshot().activation;
    let resolve!: (value: unknown) => void;
    native.invoke.mockReset().mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = operation();
    expect(native.invoke).toHaveBeenCalledTimes(1); expect(counts.getSnapshot().activation).toBeGreaterThan(epoch);
    const retired = counts.getSnapshot().activation;
    counts.setSelection(selection); expect(counts.getSnapshot().activation).toBe(retired);
    resolve(result); await pending;
    expect(counts.getSnapshot().committed).toBeNull();
    counts.setSelection(selection); expect(counts.getSnapshot().activation).toBeGreaterThan(retired);
  });
});
