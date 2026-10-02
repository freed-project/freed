import { expect, it, vi } from "vitest";
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
vi.mock("./library-transfer-capability", () => ({LIBRARY_TRANSFER_ENABLED:false,requireLibraryTransferCapability:()=>{throw new Error("transfer unavailable");}}));
it("denies direct lifecycle calls before drain, keys, IPC or cloud and retains restart fence",async()=>{
 const api=await import("./library-core-handoff");const guard=await import("./factory-reset-guard");
 mocks.status={handoffId:"transfer",libraryId:"library",installationRole:"source",phase:"authorized",predecessorEpochId:"old",successorEpochId:"new",canonicalReadiness:"{}",canonicalAuthorizationBody:null,canonicalAuthorization:null,canonicalActivation:null,expectedControlRevision:null,observedControlRevision:null,updatedAtMs:1};
 await api.restoreDesktopLibraryHandoffPause();expect(guard.isDesktopHandoffPaused()).toBe(true);
 const calls=[()=>api.prepareDesktopLibraryTargetReadiness(),()=>api.prepareDesktopLibrarySourceHandoff({canonicalReadiness:"",selectedTargetActorId:""}),()=>api.cancelDesktopLibrarySourceHandoff(""),()=>api.acceptDesktopLibraryTargetHandoffAuthorization(""),()=>api.stageDesktopLibraryTargetHandoff(""),()=>api.prepareDesktopLibraryConsumerRecovery(),()=>api.commitDesktopLibraryConsumerRecovery("")];
 for(const call of calls)expect(call).toThrow("transfer unavailable");
 expect(mocks.drain).not.toHaveBeenCalled();expect(mocks.readiness).not.toHaveBeenCalled();expect(mocks.begin).not.toHaveBeenCalled();expect(mocks.prepareRecovery).not.toHaveBeenCalled();expect(mocks.syncOwner).not.toHaveBeenCalled();expect(guard.isDesktopHandoffPaused()).toBe(true);
});
