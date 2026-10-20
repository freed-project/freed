import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedLibraryHandoffStatus } from "./sqlite-library";
const mocks = vi.hoisted(() => ({
  cancelTarget: vi.fn(),
  status: null as NormalizedLibraryHandoffStatus | null,
  readiness: vi.fn(), begin: vi.fn(), seal: vi.fn(), cancel: vi.fn(), describe: vi.fn(), drain: vi.fn(), syncOwner: vi.fn(),
  syncOwnerActive: false, stageSource: vi.fn(), adoptSource: vi.fn(), readRecovery: vi.fn(), prepareRecovery: vi.fn(), commitRecovery: vi.fn(),
  publish: vi.fn(), prepareConsent: vi.fn(), authorize: vi.fn(), acceptTarget: vi.fn(), stageTarget: vi.fn(), activateTarget: vi.fn(), refreshRole: vi.fn(),
}));
vi.mock("./library-core-desktop-role", () => ({ refreshLibraryCoreDesktopRole: mocks.refreshRole }));
vi.mock("./rss-poller", () => ({ stopRssPollerAndDrain: mocks.drain }));
vi.mock("./provider-sync-scheduler", () => ({ stopProviderSyncSchedulerAndDrain: mocks.drain }));
vi.mock("./content-fetcher", () => ({ stopAndDrain: mocks.drain }));
vi.mock("./priority-indexer", () => ({ stopAndDrain: mocks.drain }));
vi.mock("./semantic-classifier", () => ({ stopAndDrain: mocks.drain }));
vi.mock("./provider-auth-lifecycle", () => ({ quiesceDesktopProviderAuthForHandoff: mocks.drain }));
vi.mock("./snapshots", () => ({ stopSnapshotManager: vi.fn() }));
vi.mock("./library-core-cloud-sync", () => ({ stageSqliteLibraryHandoffSource: mocks.stageSource, runSqliteLibraryHandoffLifecycle: mocks.syncOwner, publishSealedSqliteLibraryCheckpoint: mocks.publish }));
vi.mock("./sqlite-library", () => ({
  readNormalizedLibraryHandoffStatus: async () => mocks.status,
  adoptNormalizedLibrarySourceHandoff: mocks.adoptSource,
  readNormalizedLibraryConsumerRecovery: mocks.readRecovery,
  prepareNormalizedLibraryConsumerRecovery: mocks.prepareRecovery,
  commitNormalizedLibraryConsumerRecovery: mocks.commitRecovery,
  prepareNormalizedLibraryHandoffAuthorization: mocks.prepareConsent,
  authorizeNormalizedLibrarySourceHandoff: mocks.authorize,
  acceptNormalizedLibraryTargetHandoffAuthorization: mocks.acceptTarget,
  acceptNormalizedLibraryTargetHandoffCancellation: mocks.cancelTarget,
  stageNormalizedLibraryTargetHandoff: mocks.stageTarget,
  activateNormalizedLibraryTargetHandoff: mocks.activateTarget,
  prepareNormalizedLibraryHandoffReadiness: mocks.readiness,
  beginNormalizedLibrarySourceHandoff: mocks.begin,
  sealNormalizedLibrarySourceHandoff: mocks.seal,
  cancelNormalizedLibrarySourceHandoff: mocks.cancel,
  describeNormalizedLibraryCheckpoint: mocks.describe,
}));
const input = { canonicalReadiness: '{"body":{"target_actor_id":"target"}}', selectedTargetActorId: "target" };
function status(phase: NormalizedLibraryHandoffStatus["phase"]): NormalizedLibraryHandoffStatus {
  return { handoffId: "transfer", libraryId: "library", installationRole: "source", phase,
    predecessorEpochId: "old", successorEpochId: null, canonicalReadiness: input.canonicalReadiness,
    canonicalAuthorizationBody: null, canonicalAuthorization: null, canonicalActivation: null,
    expectedControlRevision: null, observedControlRevision: null, updatedAtMs: 1 };
}
async function load() {
  return { api: await import("./library-core-handoff"), guard: await import("./factory-reset-guard") };
}
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); mocks.status = null;
  mocks.syncOwnerActive = false;
  mocks.syncOwner.mockImplementation(async (work: () => Promise<unknown>) => {
    if (mocks.syncOwnerActive) throw new Error("nested sync owner");
    mocks.syncOwnerActive = true;
    try { return await work(); } finally { mocks.syncOwnerActive = false; }
  });
  mocks.drain.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue({ controlPointer: { generation: 2 }, controlRevision: '"head"', controlFileId: "source-control" });
  mocks.prepareConsent.mockResolvedValue("native consent");
  mocks.authorize.mockImplementation(async (_id: string, body: string) => {
    mocks.status = { ...status("authorized"), canonicalAuthorizationBody: body, canonicalAuthorization: "signed grant" };
    return "signed grant";
  });
  mocks.describe.mockResolvedValue({ sourceRevision: 3 });
  mocks.begin.mockImplementation(async () => { mocks.status = status("preparing"); return "transfer"; });
  mocks.seal.mockImplementation(async () => { mocks.status = status("sealed"); });
  mocks.cancel.mockImplementation(async () => { mocks.status = status("cancelled"); });
  // Module transformation is fixture setup, not the lifecycle under test.
  await load();
});
describe("Desktop source handoff lifecycle", () => {
  it.each([false, true])("keeps failed readiness paused only with durable lifecycle: %s", async (persisted) => {
    const { api, guard } = await load();
    mocks.readiness.mockImplementation(async () => {
      if (persisted) mocks.status = { ...status("preparing"), installationRole: "target" };
      throw new Error("readiness response lost");
    });
    await expect(api.prepareDesktopLibraryTargetReadiness()).rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(persisted);
  });

  it.each(["following", "cancelled", "demoted"] as const)("resumes a rejected %s preparation only after matching native consumer admission", async phase => {
    const { api, guard } = await load();
    mocks.status = { ...status(phase), installationRole: phase === "following" ? "consumer" : phase === "demoted" ? "source" : "target", successorEpochId: "new" };
    mocks.readiness.mockRejectedValue(new Error("all edits must settle"));
    mocks.refreshRole.mockResolvedValue({ state: "editable_consumer", role: "follower", libraryId: "library", authorityEpochId: "wrong" });
    await expect(api.prepareDesktopLibraryTargetReadiness()).rejects.toThrow("all edits must settle");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    mocks.refreshRole.mockResolvedValue({ state: "editable_consumer", role: "follower", libraryId: "library", authorityEpochId: phase === "cancelled" ? "old" : "new" });
    await expect(api.prepareDesktopLibraryTargetReadiness()).rejects.toThrow("all edits must settle");
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    expect(mocks.syncOwnerActive).toBe(false);
  });

  it("keeps accepted target consent paused without treating it as activation", async () => {
    const { api, guard } = await load();
    mocks.acceptTarget.mockImplementation(async (bytes: string) => {
      mocks.status = { ...status("preparing"), installationRole: "target",
        canonicalAuthorizationBody: "native consent", canonicalAuthorization: bytes };
      return "transfer";
    });
    await expect(api.acceptDesktopLibraryTargetHandoffAuthorization("signed consent"))
      .resolves.toMatchObject({ phase: "preparing", installationRole: "target", successorEpochId: null });
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("refuses target consent readback for a different transfer", async () => {
    const { api, guard } = await load();
    mocks.acceptTarget.mockResolvedValue("transfer");
    mocks.status = { ...status("preparing"), installationRole: "target", handoffId: "other",
      canonicalAuthorizationBody: "native consent", canonicalAuthorization: "signed consent" };
    await expect(api.acceptDesktopLibraryTargetHandoffAuthorization("signed consent"))
      .rejects.toThrow("could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });

  it("publishes sealed state before native consent and reuses committed bytes after response loss", async () => {
    const { api, guard } = await load(); mocks.status = status("sealed");
    mocks.authorize.mockImplementationOnce(async (_id: string, body: string) => {
      mocks.status = { ...status("authorized"), canonicalAuthorizationBody: body };
      throw new Error("signature receipt response lost");
    });
    await expect(api.authorizeDesktopLibrarySourceHandoff({ handoffId: "transfer", accessToken: "token" }))
      .rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(mocks.prepareConsent).toHaveBeenCalledWith("transfer", '{"generation":2}', '"head"', "source-control");
    expect(mocks.publish.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepareConsent.mock.invocationCallOrder[0]);
    expect(mocks.prepareConsent.mock.invocationCallOrder[0]).toBeLessThan(mocks.authorize.mock.invocationCallOrder[0]);
    await expect(api.authorizeDesktopLibrarySourceHandoff({ handoffId: "transfer", accessToken: "expired" }))
      .resolves.toBe("signed grant");
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.prepareConsent).toHaveBeenCalledOnce();
    expect(mocks.authorize).toHaveBeenNthCalledWith(2, "transfer", "native consent");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });

  it("leaves the source sealed when the caller aborts before native consent admission", async () => {
    const { api, guard } = await load(); mocks.status = status("sealed");
    const controller = new AbortController();
    mocks.prepareConsent.mockImplementationOnce(async () => {
      controller.abort(); return "native consent";
    });
    await expect(api.authorizeDesktopLibrarySourceHandoff({
      handoffId: "transfer", accessToken: "token", signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(mocks.status?.phase).toBe("sealed");
  });

  it("does not authorize when final checkpoint publication fails", async () => {
    const { api, guard } = await load(); mocks.status = status("sealed");
    mocks.publish.mockRejectedValueOnce(new Error("Drive readback failed"));
    await expect(api.authorizeDesktopLibrarySourceHandoff({ handoffId: "transfer", accessToken: "token" }))
      .rejects.toThrow("Drive readback failed");
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });

  it("releases a rejected readiness pause only when native confirms no transfer was persisted", async () => {
    const { api, guard } = await load();
    mocks.begin.mockRejectedValueOnce(new Error("invalid readiness"));
    await expect(api.prepareDesktopLibrarySourceHandoff(input)).rejects.toThrow("invalid readiness");
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    expect(mocks.seal).not.toHaveBeenCalled();
  });
  it("seals after accepted writes finish and resumes only after durable cancellation", async () => {
    const { api, guard } = await load();
    let finish!: () => void;
    const writing = new Promise<void>((resolve) => { finish = resolve; });
    const accepted = guard.runFactoryResetSensitiveDesktopOperation(() => writing);
    const prepare = api.prepareDesktopLibrarySourceHandoff(input);
    await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce());
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(mocks.seal).not.toHaveBeenCalled();
    await expect(api.cancelDesktopLibrarySourceHandoff("transfer")).rejects.toThrow("still finishing");
    finish(); await accepted;
    await expect(prepare).resolves.toMatchObject({ phase: "sealed" });
    expect(mocks.seal).toHaveBeenCalledWith("transfer", { sourceRevision: 3 });
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    await api.cancelDesktopLibrarySourceHandoff("transfer");
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it("retains preparation after a drain failure and permits recovery", async () => {
    const { api, guard } = await load();
    mocks.drain.mockRejectedValueOnce(new Error("article drain timed out"));
    await expect(api.prepareDesktopLibrarySourceHandoff(input)).rejects.toThrow("article drain timed out");
    expect(mocks.seal).not.toHaveBeenCalled();
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    await expect(api.prepareDesktopLibrarySourceHandoff(input)).resolves.toMatchObject({ phase: "sealed" });
  });
  it("recovers a lost seal response without fresh native preparation", async () => {
    const { api } = await load(); mocks.status = status("sealed");
    await expect(api.prepareDesktopLibrarySourceHandoff(input)).resolves.toMatchObject({ phase: "sealed" });
    expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.seal).toHaveBeenCalledOnce();
  });
  it("restores an unsigned authorized pause and retains it when native cancellation refuses", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("authorized"), canonicalAuthorizationBody: "unsigned consent" };
    await api.restoreDesktopLibraryHandoffPause();
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    mocks.cancel.mockRejectedValueOnce(new Error("authorization cutoff"));
    await expect(api.cancelDesktopLibrarySourceHandoff("transfer")).rejects.toThrow("authorization cutoff");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });
  it("keeps consumer archive recovery available for read-only catch-up after restart", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("recovery"), installationRole: "consumer", successorEpochId: "successor" };
    await expect(api.restoreDesktopLibraryHandoffPause()).resolves.toMatchObject({ installationRole: "consumer", phase: "recovery" });
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it("requires matching durable readback after successful cancellation IPC", async () => {
    const { api, guard } = await load(); mocks.status = status("sealed");
    mocks.cancel.mockResolvedValue(undefined);
    await expect(api.cancelDesktopLibrarySourceHandoff("transfer")).rejects.toThrow("could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });
  it("keeps staging fenced through a lost response and exact retry", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("preparing"), installationRole: "target", canonicalAuthorization: "grant" };
    mocks.stageTarget.mockImplementationOnce(async () => {
      mocks.status = { ...mocks.status!, phase: "cas_pending", successorEpochId: "successor" };
      throw new Error("response lost");
    });
    await expect(api.stageDesktopLibraryTargetHandoff("transfer")).rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    mocks.stageTarget.mockResolvedValueOnce("successor certificate");
    await expect(api.stageDesktopLibraryTargetHandoff("transfer")).resolves.toBe("successor certificate");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("refuses staging without consent and rejects a changed native receipt", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("preparing"), installationRole: "target" };
    await expect(api.stageDesktopLibraryTargetHandoff("transfer")).rejects.toThrow("requires accepted");
    expect(mocks.stageTarget).not.toHaveBeenCalled();
    mocks.status = { ...mocks.status, canonicalAuthorization: "grant" };
    mocks.stageTarget.mockImplementationOnce(async () => {
      mocks.status = { ...mocks.status!, phase: "cas_pending", successorEpochId: "successor",
        canonicalAuthorization: "another grant" };
      return "certificate";
    });
    await expect(api.stageDesktopLibraryTargetHandoff("transfer")).rejects.toThrow("could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });

});


describe("Desktop target activation lifecycle", () => {
  function pending() {
    mocks.status = { ...status("cas_pending"), installationRole: "target", successorEpochId: "successor",
      canonicalAuthorization: "grant", canonicalActivation: "proposal" };
    mocks.activateTarget.mockImplementation(async () => {
      mocks.status = { ...mocks.status!, phase: "active", observedControlRevision: '"winner"' };
      return mocks.status;
    });
    mocks.refreshRole.mockResolvedValue({ state: "shared_primary", role: "primary", libraryId: "library",
      authorityEpochId: "successor", actorId: "actor" });
  }
  it("updates the shell while paused and resumes only after native receipt and role agree", async () => {
    const { api, guard } = await load(); pending();
    const onActivated = vi.fn(async () => { expect(guard.isDesktopHandoffPaused()).toBe(true); });
    await expect(api.activateDesktopLibraryTargetHandoff({ handoffId: "transfer", accessToken: "token", onActivated }))
      .resolves.toMatchObject({ phase: "active" });
    expect(mocks.activateTarget).toHaveBeenCalledWith("transfer", "token");
    expect(onActivated).toHaveBeenCalledOnce();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it("recovers a lost activation response before allowing services to resume", async () => {
    const { api, guard } = await load(); pending();
    mocks.activateTarget.mockImplementationOnce(async () => {
      mocks.status = { ...mocks.status!, phase: "active", observedControlRevision: '"winner"' };
      throw new Error("activation response lost");
    });
    const onActivated = vi.fn();
    await expect(api.activateDesktopLibraryTargetHandoff({ handoffId: "transfer", accessToken: "token", onActivated })).rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    expect(onActivated).not.toHaveBeenCalled();
    await expect(api.activateDesktopLibraryTargetHandoff({ handoffId: "transfer", accessToken: "expired", onActivated })).resolves.toMatchObject({ phase: "active" });
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it.each(["receipt", "role", "shell"])("retains the pause after a %s failure", async (failure) => {
    const { api, guard } = await load(); pending();
    const onActivated = vi.fn();
    if (failure === "receipt") mocks.activateTarget.mockImplementationOnce(async () => {
      mocks.status = { ...mocks.status!, phase: "active", observedControlRevision: '"winner"' };
      return { ...mocks.status, successorEpochId: "other" };
    });
    if (failure === "role") mocks.refreshRole.mockResolvedValueOnce({ role: "follower", state: "editable_consumer" });
    if (failure === "shell") onActivated.mockRejectedValueOnce(new Error("shell update failed"));
    await expect(api.activateDesktopLibraryTargetHandoff({ handoffId: "transfer", accessToken: "token", onActivated })).rejects.toThrow();
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    if (failure !== "shell") expect(onActivated).not.toHaveBeenCalled();
  });
});

describe("consumer recovery lifecycle", () => {
  const recovery = { recoveryId: "a".repeat(64), libraryId: "b".repeat(64),
    predecessorEpochId: "c".repeat(64), successorEpochId: "d".repeat(64),
    state: "prepared" as const, archivedPendingEdits: 2, archivedPublishedEdits: 3 };

  it("prepares under the sync owner and resumes the verified consumer with archived counts", async () => {
    const { api, guard } = await load();
    mocks.prepareRecovery.mockImplementation(async () => {
      expect(guard.isDesktopHandoffPaused()).toBe(true);
      mocks.status = { ...status("recovery"), installationRole: "consumer" };
      return recovery;
    });
    mocks.readRecovery.mockResolvedValue(recovery);
    await expect(api.prepareDesktopLibraryConsumerRecovery()).resolves.toEqual(recovery);
    expect(mocks.syncOwner).toHaveBeenCalledOnce();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    expect(mocks.commitRecovery).not.toHaveBeenCalled();
  });

  it("resumes after a lost commit response and retries the same recovery", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("recovery"), installationRole: "consumer" };
    let stored = { ...recovery, state: "prepared" as "prepared" | "following" };
    mocks.readRecovery.mockImplementation(async () => stored);
    mocks.commitRecovery.mockImplementationOnce(async () => {
      expect(guard.isDesktopHandoffPaused()).toBe(true);
      stored = { ...stored, state: "following" };
      mocks.status = { ...status("following"), installationRole: "consumer" };
      throw new Error("response lost");
    }).mockImplementation(async () => stored);
    await expect(api.commitDesktopLibraryConsumerRecovery(recovery.recoveryId)).rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    await expect(api.commitDesktopLibraryConsumerRecovery(recovery.recoveryId)).resolves.toEqual(stored);
    expect(mocks.commitRecovery).toHaveBeenNthCalledWith(2, recovery.recoveryId);
    expect(mocks.refreshRole).toHaveBeenCalledOnce();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });

  it("refuses another recovery identity without calling the native commit", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("recovery"), installationRole: "consumer" };
    mocks.readRecovery.mockResolvedValue(recovery);
    await expect(api.commitDesktopLibraryConsumerRecovery("e".repeat(64))).rejects.toThrow("Prepare this consumer recovery");
    expect(mocks.commitRecovery).not.toHaveBeenCalled();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
});


describe("old Primary adoption", () => {
  const adoption = { handoffId: "transfer", stageId: "staged-successor", canonicalControl: '{"generation":7}', accessToken: "token" };
  function demoted() {
    return { ...status("demoted"), successorEpochId: "successor", canonicalAuthorization: "grant", canonicalActivation: '{"activation":{"control":{"generation":7},"handoff_id":"transfer"},"format":"freed_library_source_adoption_v1","stage_id":"staged-successor"}', observedControlRevision: "winner" };
  }
  beforeEach(() => {
    mocks.status = { ...status("authorized"), canonicalAuthorization: "grant" };
    mocks.stageSource.mockImplementation(async () => {
      if (mocks.syncOwnerActive) throw new Error("download requires its own sync owner");
      return { stageId: adoption.stageId, canonicalControl: adoption.canonicalControl };
    });
    mocks.adoptSource.mockImplementation(async () => { mocks.status = demoted(); return mocks.status; });
    mocks.refreshRole.mockResolvedValue({ role: "follower", libraryId: "library", authorityEpochId: "successor" });
  });
  it("resumes only after native demotion and matching consumer role readback", async () => {
    const { api, guard } = await load();
    await expect(api.adoptDesktopLibrarySourceHandoff(adoption)).resolves.toMatchObject({ phase: "demoted" });
    expect(mocks.adoptSource).toHaveBeenCalledWith(adoption);
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("requires native viewer readback before resuming a read-only adoption", async () => {
    const { api, guard } = await load();
    await expect(api.adoptDesktopLibrarySourceHandoff({ ...adoption, readOnly: true })).rejects.toThrow("access mode could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    mocks.refreshRole.mockResolvedValue({ role: "follower", state: "read_only_consumer", libraryId: "library", authorityEpochId: "successor" });
    await expect(api.adoptDesktopLibrarySourceHandoff({ ...adoption, readOnly: true })).resolves.toMatchObject({ phase: "demoted" });
    expect(mocks.adoptSource).toHaveBeenLastCalledWith({ ...adoption, readOnly: true });
    expect(mocks.stageSource).toHaveBeenCalledOnce();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it("keeps a lost response paused and resumes on exact native retry", async () => {
    const { api, guard } = await load();
    mocks.adoptSource.mockImplementationOnce(async () => { mocks.status = demoted(); throw new Error("response lost"); });
    await expect(api.adoptDesktopLibrarySourceHandoff(adoption)).rejects.toThrow("response lost");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    await expect(api.adoptDesktopLibrarySourceHandoff(adoption)).resolves.toMatchObject({ phase: "demoted" });
    expect(mocks.adoptSource).toHaveBeenNthCalledWith(2, adoption);
    expect(mocks.stageSource).toHaveBeenCalledOnce();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
  it("stays paused when consumer role does not match the committed successor", async () => {
    const { api, guard } = await load();
    mocks.refreshRole.mockResolvedValue({ role: "follower", libraryId: "library", authorityEpochId: "other" });
    await expect(api.adoptDesktopLibrarySourceHandoff(adoption)).rejects.toThrow("consumer role could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });
  it("does not restore a writer pause for a durably demoted consumer", async () => {
    const { api, guard } = await load(); mocks.status = demoted();
    await api.restoreDesktopLibraryHandoffPause();
    expect(guard.isDesktopHandoffPaused()).toBe(false);
  });
});


describe("target cancellation", () => {
  it("retains the pause after response loss and resumes only after exact proof and consumer role readback", async () => {
    const { api, guard } = await load();
    mocks.status = { ...status("preparing"), installationRole: "target" };
    mocks.cancelTarget.mockImplementationOnce(async () => {
      mocks.status = { ...mocks.status!, phase: "cancelled", canonicalCancellation: "proof" };
      throw new Error("lost response");
    }).mockResolvedValue("transfer");
    mocks.refreshRole.mockResolvedValue({ role: "follower", state: "editable_consumer", libraryId: "library", authorityEpochId: "old" });
    await expect(api.acceptDesktopLibraryTargetHandoffCancellation("proof")).rejects.toThrow("lost response");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
    await api.acceptDesktopLibraryTargetHandoffCancellation("proof");
    expect(guard.isDesktopHandoffPaused()).toBe(false);
    expect(mocks.cancelTarget.mock.calls).toEqual([["proof"], ["proof"]]);
  });
  it.each(["proof", "role"])("keeps a canceled target paused when %s readback disagrees", async mismatch => {
    const { api, guard } = await load();
    mocks.status = { ...status("cancelled"), installationRole: "target", canonicalCancellation: mismatch === "proof" ? "other" : "proof" };
    mocks.cancelTarget.mockResolvedValue("transfer");
    mocks.refreshRole.mockResolvedValue({ role: "primary", state: "primary", libraryId: "library", authorityEpochId: "old" });
    await expect(api.acceptDesktopLibraryTargetHandoffCancellation("proof")).rejects.toThrow("could not be verified");
    expect(guard.isDesktopHandoffPaused()).toBe(true);
  });
});
