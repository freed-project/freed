import { refreshLibraryCoreDesktopRole, type DesktopLibraryInstallationStatus } from "./library-core-desktop-role";
import { pauseDesktopOperationsForHandoff } from "./factory-reset-guard";
import { stopRssPollerAndDrain } from "./rss-poller";
import { stopProviderSyncSchedulerAndDrain } from "./provider-sync-scheduler";
import { stopAndDrain as drainContent } from "./content-fetcher";
import { stopAndDrain as drainPriorities } from "./priority-indexer";
import { stopAndDrain as drainClassification } from "./semantic-classifier";
import { quiesceDesktopProviderAuthForHandoff } from "./provider-auth-lifecycle";
import { stopSnapshotManager } from "./snapshots";
import { runSqliteLibraryHandoffLifecycle, publishSealedSqliteLibraryCheckpoint, catchUpSqliteLibraryHandoffTarget, publishSqliteLibraryHandoffTarget, stageSqliteLibraryHandoffSource } from "./library-core-cloud-sync";
import { decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue, type LibraryCoreCanonicalValue } from "@freed/shared/library-core";
import type { GoogleDriveFetch } from "@freed/sync/cloud/library-core";
import {
  prepareNormalizedLibraryHandoffReadiness,
  beginNormalizedLibrarySourceHandoff,
  readNormalizedLibraryConsumerRecovery,
  prepareNormalizedLibraryConsumerRecovery,
  commitNormalizedLibraryConsumerRecovery,
  type NormalizedLibraryConsumerRecoverySummary,
  cancelNormalizedLibrarySourceHandoff,
  describeNormalizedLibraryCheckpoint,
  readNormalizedLibraryHandoffStatus,
  sealNormalizedLibrarySourceHandoff,
  prepareNormalizedLibraryHandoffAuthorization,
  authorizeNormalizedLibrarySourceHandoff,
  acceptNormalizedLibraryTargetHandoffAuthorization,
  acceptNormalizedLibraryTargetHandoffCancellation,
  stageNormalizedLibraryTargetHandoff,
  activateNormalizedLibraryTargetHandoff,
  adoptNormalizedLibrarySourceHandoff,
  type NormalizedLibraryHandoffStatus,
} from "./sqlite-library";

let pause: ReturnType<typeof pauseDesktopOperationsForHandoff> | null = null;
let active: Promise<unknown> | null = null;

function ownPause() {
  return pause ??= pauseDesktopOperationsForHandoff();
}

function exclusively<T>(work: () => Promise<T>): Promise<T> {
  if (active) return Promise.reject(new Error("Library transfer is still finishing its current step"));
  const completion = Promise.resolve().then(work);
  active = completion;
  return completion.finally(() => { if (active === completion) active = null; });
}

/** Called before startup enables services. A persisted fence survives renderer
 * restarts; missing or unreadable native state must not be treated as cancellation. */
export async function restoreDesktopLibraryHandoffPause(): Promise<NormalizedLibraryHandoffStatus | null> {
  const status = await readNormalizedLibraryHandoffStatus();
  if (status && status.installationRole !== "consumer" && status.phase !== "cancelled" && !(status.installationRole === "source" && status.phase === "demoted") && !(status.installationRole === "target" && status.phase === "active")) {
    ownPause();
  }
  return status;
}

/** Stop new work, persist native preparation, finish accepted writes, then seal
 * the exact final checkpoint. A persisted or unreadable transfer stays paused on failure. */
export function prepareDesktopLibraryTargetReadiness(): Promise<string> {
  return exclusively(async () => {
    const owner = ownPause();
    try {
      await owner.drain(180_000);
      return await runSqliteLibraryHandoffLifecycle(prepareNormalizedLibraryHandoffReadiness);
    } catch (error) {
      const status = await readNormalizedLibraryHandoffStatus().catch(() => undefined);
      let canResume = status === null;
      if (status && ((status.installationRole === "consumer" && status.phase === "following")
        || (status.installationRole === "target" && status.phase === "cancelled")
        || (status.installationRole === "source" && status.phase === "demoted"))) {
        const role = await refreshLibraryCoreDesktopRole().catch(() => null);
        const epoch = status.installationRole === "target" ? status.predecessorEpochId : status.successorEpochId;
        canResume = role?.state === "editable_consumer" && role.role === "follower"
          && role.libraryId === status.libraryId && role.authorityEpochId === epoch;
      }
      if (canResume) { pause = null; owner.resume(); }
      throw error;
    }
  });
}

export function prepareDesktopLibrarySourceHandoff(input: {
  canonicalReadiness: string;
  selectedTargetActorId: string;
}): Promise<NormalizedLibraryHandoffStatus> {
  return exclusively(async () => {
    const owner = ownPause();
    try {
      return await runSqliteLibraryHandoffLifecycle(async () => {
        stopSnapshotManager();
        const previous = await readNormalizedLibraryHandoffStatus();
        const sealedRetry = previous?.installationRole === "source" && previous.phase === "sealed"
          && previous.canonicalReadiness === input.canonicalReadiness
          && JSON.parse(previous.canonicalReadiness).body.target_actor_id === input.selectedTargetActorId;
        // Start every drain before awaiting any one. The native gate closes
        // provider admission while already accepted renderer writes can settle.
        const results = await Promise.allSettled([
          sealedRetry ? Promise.resolve(previous.handoffId)
            : beginNormalizedLibrarySourceHandoff(input.canonicalReadiness, input.selectedTargetActorId),
          stopRssPollerAndDrain({ resumable: true }),
          stopProviderSyncSchedulerAndDrain(),
          drainContent({ resumable: true }),
          drainPriorities({ resumable: true }),
          drainClassification({ resumable: true }),
          quiesceDesktopProviderAuthForHandoff(),
          owner.drain(180_000),
        ]);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw failed.reason;
        const begun = results[0];
        if (begun.status !== "fulfilled") throw new Error("Native handoff preparation did not finish");
        const checkpoint = await describeNormalizedLibraryCheckpoint();
        await sealNormalizedLibrarySourceHandoff(begun.value, checkpoint);
        const status = await readNormalizedLibraryHandoffStatus();
        if (!status || status.handoffId !== begun.value || status.installationRole !== "source" || status.phase !== "sealed") {
          throw new Error("Native handoff seal could not be verified");
        }
        return status;
      });
    } catch (error) {
      // A rejected readiness request may never have created a native fence.
      // Only successful absence readback permits undoing that temporary pause.
      // An unreadable record or any persisted transfer remains paused.
      const state = await readNormalizedLibraryHandoffStatus().catch(() => undefined);
      if (state === null) {
        pause = null;
        owner.resume();
      }
      throw error;
    }
  });
}

/** Cancellation is confirmed durably before service-start subscribers run. An
 * unsigned AUTHORIZED record already crossed the cutoff and native refuses it. */
export function cancelDesktopLibrarySourceHandoff(handoffId: string): Promise<void> {
  return exclusively(async () => {
    const owner = ownPause();
    await runSqliteLibraryHandoffLifecycle(async () => {
      await cancelNormalizedLibrarySourceHandoff(handoffId);
      const status = await readNormalizedLibraryHandoffStatus();
      if (!status || status.handoffId !== handoffId || status.installationRole !== "source"
        || status.phase !== "cancelled" || status.canonicalAuthorizationBody !== null
        || status.canonicalAuthorization !== null || status.canonicalActivation !== null) {
        throw new Error("Native handoff cancellation could not be verified");
      }
    });
    pause = null;
    owner.resume();
  });
}

/** Publish the final predecessor and commit consent. After the native cutoff,
 * retries reuse its exact body and never publish a different final checkpoint. */
export function authorizeDesktopLibrarySourceHandoff(input: {
  handoffId: string;
  accessToken: string;
  googleFetch?: GoogleDriveFetch;
  signal?: AbortSignal;
}): Promise<string> {
  return exclusively(async () => {
    ownPause();
    const status = await readNormalizedLibraryHandoffStatus();
    if (!status || status.handoffId !== input.handoffId || status.installationRole !== "source"
      || !["sealed", "authorized"].includes(status.phase)) {
      throw new Error("Handoff consent requires the selected sealed source");
    }
    let canonicalBody = status.canonicalAuthorizationBody;
    if (status.phase === "sealed") {
      const publication = await publishSealedSqliteLibraryCheckpoint(input);
      canonicalBody = await prepareNormalizedLibraryHandoffAuthorization(
        input.handoffId,
        new TextDecoder().decode(encodeLibraryCoreCanonicalValue(publication.controlPointer as unknown as LibraryCoreCanonicalValue)),
        publication.controlRevision,
        publication.controlFileId,
      );
    }
    if (canonicalBody === null) throw new Error("Committed handoff consent is missing");
    const body = canonicalBody;
    return runSqliteLibraryHandoffLifecycle(async () => {
      if (input.signal?.aborted) {
        throw new DOMException("Handoff consent was interrupted; the transfer remains paused", "AbortError");
      }
      const grant = await authorizeNormalizedLibrarySourceHandoff(input.handoffId, body);
      const committed = await readNormalizedLibraryHandoffStatus();
      if (!committed || committed.handoffId !== input.handoffId || committed.phase !== "authorized"
        || committed.canonicalAuthorizationBody !== body || committed.canonicalAuthorization !== grant) {
        throw new Error("Committed handoff consent could not be verified");
      }
      return grant;
    });
  });
}

/** Store verified consent while native keeps the target fenced. This does not
 * activate a successor or claim that its final checkpoint has been downloaded. */
export function acceptDesktopLibraryTargetHandoffCancellation(canonicalCancellation: string): Promise<void> {
  return exclusively(async () => {
    const owner = ownPause();
    await owner.drain(180_000);
    await runSqliteLibraryHandoffLifecycle(async () => {
      const handoffId = await acceptNormalizedLibraryTargetHandoffCancellation(canonicalCancellation);
      const status = await readNormalizedLibraryHandoffStatus();
      if (!status || status.handoffId !== handoffId || status.installationRole !== "target"
        || status.phase !== "cancelled" || status.canonicalCancellation !== canonicalCancellation
        || status.canonicalAuthorization !== null || status.canonicalAuthorizationBody !== null
        || status.canonicalActivation !== null || status.successorEpochId !== null) {
        throw new Error("Target cancellation could not be verified");
      }
      const role = await refreshLibraryCoreDesktopRole();
      if (role.role !== "follower" || role.state !== "editable_consumer"
        || role.libraryId !== status.libraryId || role.authorityEpochId !== status.predecessorEpochId) {
        throw new Error("Canceled target consumer role could not be verified");
      }
    });
    pause = null;
    owner.resume();
  });
}

export function acceptDesktopLibraryTargetHandoffAuthorization(canonicalAuthorization: string): Promise<NormalizedLibraryHandoffStatus> {
  return exclusively(async () => {
    ownPause();
    return runSqliteLibraryHandoffLifecycle(async () => {
      const handoffId = await acceptNormalizedLibraryTargetHandoffAuthorization(canonicalAuthorization);
      const status = await readNormalizedLibraryHandoffStatus();
      if (!status || status.handoffId !== handoffId || status.installationRole !== "target"
        || status.phase !== "preparing" || status.canonicalAuthorization !== canonicalAuthorization
        || status.canonicalAuthorizationBody === null || status.canonicalActivation !== null
        || status.successorEpochId !== null) {
        throw new Error("Target handoff consent could not be verified");
      }
      return status;
    });
  });
}

/** Keep ordinary sync and user writes paused while installing the signed final state. */
export function catchUpDesktopLibraryTargetHandoff(input: Parameters<typeof catchUpSqliteLibraryHandoffTarget>[0]) {
  return exclusively(async () => {
    ownPause();
    return catchUpSqliteLibraryHandoffTarget(input);
  });
}

/** Prepare successor state without opening admission or releasing the sync pause. */
export function stageDesktopLibraryTargetHandoff(handoffId: string): Promise<string> {
  return exclusively(async () => {
    ownPause();
    return runSqliteLibraryHandoffLifecycle(async () => {
      const before = await readNormalizedLibraryHandoffStatus();
      if (!before || before.handoffId !== handoffId || before.installationRole !== "target"
        || !["preparing", "cas_pending"].includes(before.phase)
        || before.canonicalAuthorization === null || before.canonicalActivation !== null) {
        throw new Error("Target staging requires accepted handoff consent");
      }
      const certificate = await stageNormalizedLibraryTargetHandoff(handoffId);
      const after = await readNormalizedLibraryHandoffStatus();
      if (!after || after.handoffId !== handoffId || after.installationRole !== "target"
        || after.phase !== "cas_pending" || after.successorEpochId === null
        || after.libraryId !== before.libraryId || after.predecessorEpochId !== before.predecessorEpochId
        || after.canonicalAuthorization !== before.canonicalAuthorization
        || after.canonicalActivation !== null) {
        throw new Error("Staged target handoff could not be verified");
      }
      return certificate;
    });
  });
}

/** Publish under the same pause owner; native activation remains a separate step. */
export function publishDesktopLibraryTargetHandoff(input: Parameters<typeof publishSqliteLibraryHandoffTarget>[0]) {
  return exclusively(async () => {
    ownPause();
    return publishSqliteLibraryHandoffTarget(input);
  });
}

/** Native alone verifies the remote checkpoint and opens successor admission.
 * Publish the refreshed shell role before resuming its background services. */
export function activateDesktopLibraryTargetHandoff(input: {
  handoffId: string;
  accessToken: string;
  onActivated: (installation: DesktopLibraryInstallationStatus) => void | Promise<void>;
}): Promise<NormalizedLibraryHandoffStatus> {
  return exclusively(async () => {
    const owner = ownPause();
    const result = await runSqliteLibraryHandoffLifecycle(async () => {
      const before = await readNormalizedLibraryHandoffStatus();
      if (!before || before.handoffId !== input.handoffId || before.installationRole !== "target"
        || !["cas_pending", "active"].includes(before.phase) || before.successorEpochId === null
        || before.canonicalActivation === null || before.canonicalAuthorization === null) {
        throw new Error("Target activation requires a persisted successor proposal");
      }
      const receipt = await activateNormalizedLibraryTargetHandoff(input.handoffId, input.accessToken);
      const after = await readNormalizedLibraryHandoffStatus();
      if (!after || after.phase !== "active" || after.installationRole !== "target"
        || after.handoffId !== before.handoffId || after.libraryId !== before.libraryId
        || after.successorEpochId !== before.successorEpochId
        || after.canonicalActivation !== before.canonicalActivation
        || after.canonicalAuthorization !== before.canonicalAuthorization
        || !after.observedControlRevision
        || receipt.phase !== "active" || receipt.handoffId !== after.handoffId
        || receipt.libraryId !== after.libraryId || receipt.successorEpochId !== after.successorEpochId
        || receipt.canonicalActivation !== after.canonicalActivation
        || receipt.observedControlRevision !== after.observedControlRevision) {
        throw new Error("Target activation receipt could not be verified");
      }
      const installation = await refreshLibraryCoreDesktopRole();
      if (installation.role !== "primary" || !["shared_primary", "standalone_primary"].includes(installation.state)
        || installation.libraryId !== after.libraryId || installation.authorityEpochId !== after.successorEpochId) {
        throw new Error("Activated Library role could not be verified");
      }
      await input.onActivated(installation);
      return after;
    });
    pause = null;
    owner.resume();
    return result;
  });
}

/** Recovery shares the transfer pause and sync owner, but never keeps a verified
 * consumer frozen after the local step. Archived edits remain separately visible. */
function withConsumerRecovery<T>(work: () => Promise<T>): Promise<T> {
  return exclusively(async () => {
    const before = await readNormalizedLibraryHandoffStatus();
    if (before && before.installationRole !== "consumer") throw new Error("An authority transfer must finish before consumer recovery");
    const owner = ownPause();
    try {
      await owner.drain(180_000);
      return await runSqliteLibraryHandoffLifecycle(work);
    } finally {
      const after = await readNormalizedLibraryHandoffStatus().catch(() => undefined);
      if (after === null || after?.installationRole === "consumer") {
        pause = null;
        owner.resume();
      }
    }
  });
}

export function prepareDesktopLibraryConsumerRecovery(): Promise<NormalizedLibraryConsumerRecoverySummary> {
  return withConsumerRecovery(async () => {
    const prepared = await prepareNormalizedLibraryConsumerRecovery();
    const stored = await readNormalizedLibraryConsumerRecovery();
    if (!stored || stored.recoveryId !== prepared.recoveryId || stored.libraryId !== prepared.libraryId
      || stored.successorEpochId !== prepared.successorEpochId || stored.state !== prepared.state) {
      throw new Error("Prepared consumer recovery could not be verified");
    }
    return stored;
  });
}

export function commitDesktopLibraryConsumerRecovery(recoveryId: string): Promise<NormalizedLibraryConsumerRecoverySummary> {
  return withConsumerRecovery(async () => {
    const before = await readNormalizedLibraryConsumerRecovery();
    if (!before || before.recoveryId !== recoveryId || before.state === "archived") {
      throw new Error("Prepare this consumer recovery before reconnecting");
    }
    const committed = await commitNormalizedLibraryConsumerRecovery(recoveryId);
    const after = await readNormalizedLibraryConsumerRecovery();
    if (!after || committed.recoveryId !== recoveryId || after.recoveryId !== recoveryId
      || after.libraryId !== before.libraryId || after.successorEpochId !== before.successorEpochId
      || committed.state !== "following" || after.state !== "following") {
      throw new Error("Committed consumer recovery could not be verified");
    }
    await refreshLibraryCoreDesktopRole();
    return after;
  });
}

/** Adopt only after native verification of the staged checkpoint and remote winner. */
export function adoptDesktopLibrarySourceHandoff(input: {
  handoffId: string; accessToken: string; googleFetch?: GoogleDriveFetch; signal?: AbortSignal;
}): Promise<NormalizedLibraryHandoffStatus> {
  return exclusively(async () => {
    const owner = ownPause();
    await owner.drain(180_000);
    const before = await runSqliteLibraryHandoffLifecycle(readNormalizedLibraryHandoffStatus);
    if (!before || before.handoffId !== input.handoffId || before.installationRole !== "source" || !["authorized", "demoted"].includes(before.phase)) throw new Error("Source adoption requires its stored handoff consent");
    let staged: { stageId: string; canonicalControl: string };
    if (before.phase === "demoted") {
      // Recover the original request after response loss without downloading a
      // newer checkpoint or needing a still-valid access token.
      if (!before.canonicalActivation) throw new Error("Source demotion receipt is missing");
      const receipt = decodeLibraryCoreCanonicalValue(new Uint8Array(new TextEncoder().encode(before.canonicalActivation))) as {
        format?: unknown; stage_id?: unknown; activation?: { handoff_id?: unknown; control?: LibraryCoreCanonicalValue };
      };
      if (receipt.format !== "freed_library_source_adoption_v1" || typeof receipt.stage_id !== "string"
        || receipt.activation?.handoff_id !== input.handoffId || !receipt.activation.control) throw new Error("Source demotion receipt is invalid");
      staged = { stageId: receipt.stage_id, canonicalControl: new TextDecoder().decode(encodeLibraryCoreCanonicalValue(receipt.activation.control)) };
    } else {
      staged = await stageSqliteLibraryHandoffSource(input);
    }
    const result = await runSqliteLibraryHandoffLifecycle(async () => {
      if (input.signal?.aborted) throw new DOMException("Source adoption canceled", "AbortError");
      const stored = await adoptNormalizedLibrarySourceHandoff({ handoffId: input.handoffId, accessToken: input.accessToken, ...staged });
      const after = await readNormalizedLibraryHandoffStatus();
      if (!after || after.handoffId !== input.handoffId || after.installationRole !== "source" || after.phase !== "demoted"
        || after.successorEpochId === null || after.successorEpochId !== stored.successorEpochId || after.canonicalAuthorization !== before.canonicalAuthorization
        || after.canonicalActivation !== stored.canonicalActivation || after.observedControlRevision !== stored.observedControlRevision) throw new Error("Source consumer selection could not be verified");
      const role = await refreshLibraryCoreDesktopRole();
      if (role.role !== "follower" || role.libraryId !== after.libraryId || role.authorityEpochId !== after.successorEpochId) throw new Error("Demoted source consumer role could not be verified");
      return after;
    });
    pause = null; owner.resume();
    return result;
  });
}
