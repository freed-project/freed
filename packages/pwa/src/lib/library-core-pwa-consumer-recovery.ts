import { requireLibraryTransferCapability } from "./library-transfer-capability";
import type { LibraryCoreConsumerRecoveryStatusV1 } from "@freed/shared/library-core";
import { readPwaLibraryCoreRecoveryActorIdentity, signPwaLibraryCoreRecoveryActorProof } from "./library-core-browser-key-vault";
import { constructPwaFollowerEnrollmentRequest } from "./library-core-pwa-follower-enrollment";
import { readPwaConsumerRecoveryStatus, preparePwaConsumerRecoveryRequest, commitPwaConsumerRecoveryRequest } from "./library-core-sqlite-runtime";

const runtime = {
  read: readPwaConsumerRecoveryStatus, prepare: preparePwaConsumerRecoveryRequest, commit: commitPwaConsumerRecoveryRequest,
  identity: readPwaLibraryCoreRecoveryActorIdentity, sign: signPwaLibraryCoreRecoveryActorProof, now: Date.now,
};
/** Call only after the owner explicitly elects to enroll with the selected successor. */
export async function continuePwaConsumerRecovery(dependencies: typeof runtime = runtime): Promise<LibraryCoreConsumerRecoveryStatusV1> {
  requireLibraryTransferCapability();
  let status = await dependencies.read();
  if (status.state === "none") throw new Error("This browser has no authority recovery to continue.");
  if (status.state === "following") return status;
  const { plan } = status;
  const identity = await dependencies.identity(plan.authority.library_id, plan.recoveryId);
  if (identity.actorPublicKey !== plan.actorPublicKey || identity.installationIncarnation !== plan.installationIncarnation || identity.actorId === plan.oldActorId) {
    throw new Error("Recovery requires this browser's original signing key.");
  }
  if (status.state === "required") {
    const request = await constructPwaFollowerEnrollmentRequest(identity, plan.authority, dependencies.now(),
      (selected, message) => dependencies.sign(selected, plan.recoveryId, message));
    status = await dependencies.prepare({ recoveryId: plan.recoveryId, request });
  }
  if (status.state !== "prepared" || status.plan.recoveryId !== plan.recoveryId) throw new Error("Prepared recovery changed before enrollment.");
  // A response-loss retry reaches this point with persisted bytes and never signs again.
  const committed = await dependencies.commit({ recoveryId: plan.recoveryId, committedAt: dependencies.now() });
  if (committed.state !== "following" || committed.plan.recoveryId !== plan.recoveryId) throw new Error("Recovery commit could not be verified.");
  return committed;
}
