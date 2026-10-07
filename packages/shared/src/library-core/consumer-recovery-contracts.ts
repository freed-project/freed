import { parseLibraryCoreFollowerIntentCommitV1, type LibraryCoreFollowerIntentCommitV1 } from "./follower-intent-contracts.js";
import { isLibraryCoreOperationInstanceId } from "./protocol-scalars.js";
import {
  parseLibraryCoreFollowerActorEnrollmentContextV2, parseLibraryCoreStoreFollowerActorRequestV2,
  type LibraryCoreFollowerActorEnrollmentContextV2, type LibraryCoreStoreFollowerActorRequestV2,
} from "./follower-actor-enrollment-contracts.js";
import { isLibraryCoreLowercaseHex64, isLibraryCoreEd25519PublicKeyHex, isLibraryCoreNonnegativeSafeInteger, type LibraryCoreLowercaseHex64, type LibraryCoreEd25519PublicKeyHex } from "./protocol-scalars.js";

export interface LibraryCoreConsumerRecoveryPlanV1 {
  readonly recoveryId: LibraryCoreLowercaseHex64;
  readonly oldActorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly installationIncarnation: LibraryCoreLowercaseHex64;
  readonly predecessorEpochId: LibraryCoreLowercaseHex64;
  readonly authority: LibraryCoreFollowerActorEnrollmentContextV2["authority"];
  readonly preparedRequest: LibraryCoreStoreFollowerActorRequestV2 | null;
}
export type LibraryCoreConsumerRecoveryStatusV1 = Readonly<{ state: "none" }> | Readonly<{
  state: "required" | "prepared" | "following";
  plan: LibraryCoreConsumerRecoveryPlanV1;
  pendingIntentCount: number;
  publishedIntentCount: number;
}>;
export interface LibraryCorePrepareConsumerRecoveryV1 {
  readonly recoveryId: LibraryCoreLowercaseHex64;
  readonly request: LibraryCoreStoreFollowerActorRequestV2;
}
export interface LibraryCoreCommitConsumerRecoveryV1 {
  readonly recoveryId: LibraryCoreLowercaseHex64;
  readonly committedAt: number;
}
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) throw new TypeError("consumer recovery fields are invalid");
  return value as Record<string, unknown>;
}
function hex(value: unknown): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) throw new TypeError("consumer recovery identity is invalid");
  return value;
}
function count(value: unknown): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) throw new TypeError("consumer recovery count or time is invalid");
  return value;
}
export function parseLibraryCoreConsumerRecoveryPlanV1(value: unknown): LibraryCoreConsumerRecoveryPlanV1 {
  const plan = closed(value, ["recoveryId", "oldActorId", "actorPublicKey", "installationIncarnation", "predecessorEpochId", "authority", "preparedRequest"]);
  const authority = parseLibraryCoreFollowerActorEnrollmentContextV2({ authority: plan.authority, request: null, schemaVersion: 2 }).authority;
  const predecessorEpochId = hex(plan.predecessorEpochId);
  if (predecessorEpochId === authority.epoch_id) throw new TypeError("consumer recovery successor is unchanged");
  if (!isLibraryCoreEd25519PublicKeyHex(plan.actorPublicKey)) throw new TypeError("consumer recovery actor key is invalid");
  return Object.freeze({ recoveryId: hex(plan.recoveryId), oldActorId: hex(plan.oldActorId), actorPublicKey: plan.actorPublicKey,
    installationIncarnation: hex(plan.installationIncarnation), predecessorEpochId, authority,
    preparedRequest: plan.preparedRequest === null ? null : parseLibraryCoreStoreFollowerActorRequestV2(plan.preparedRequest) });
}
export function parseLibraryCoreConsumerRecoveryStatusV1(value: unknown): LibraryCoreConsumerRecoveryStatusV1 {
  if (value && typeof value === "object" && "state" in value && value.state === "none") {
    closed(value, ["state"]); return Object.freeze({ state: "none" });
  }
  const status = closed(value, ["state", "plan", "pendingIntentCount", "publishedIntentCount"]);
  if (status.state !== "required" && status.state !== "prepared" && status.state !== "following") throw new TypeError("consumer recovery state is invalid");
  const plan = parseLibraryCoreConsumerRecoveryPlanV1(status.plan);
  if ((status.state === "required") !== (plan.preparedRequest === null)) throw new TypeError("consumer recovery prepared state is inconsistent");
  return Object.freeze({ state: status.state, plan, pendingIntentCount: count(status.pendingIntentCount), publishedIntentCount: count(status.publishedIntentCount) });
}
export function parseLibraryCorePrepareConsumerRecoveryV1(value: unknown): LibraryCorePrepareConsumerRecoveryV1 {
  const input = closed(value, ["recoveryId", "request"]);
  return Object.freeze({ recoveryId: hex(input.recoveryId), request: parseLibraryCoreStoreFollowerActorRequestV2(input.request) });
}
export function parseLibraryCoreCommitConsumerRecoveryV1(value: unknown): LibraryCoreCommitConsumerRecoveryV1 {
  const input = closed(value, ["recoveryId", "committedAt"]);
  return Object.freeze({ recoveryId: hex(input.recoveryId), committedAt: count(input.committedAt) });
}

export interface LibraryCoreRecoveryReissueRequestV1 {
  readonly schemaVersion: 1;
  readonly recoveryId: LibraryCoreLowercaseHex64;
  readonly archiveDigest: LibraryCoreLowercaseHex64;
  readonly transactionId: string;
  readonly transactionDigest: LibraryCoreLowercaseHex64;
  readonly reviewedGenerationId: LibraryCoreLowercaseHex64;
  readonly reviewedRevision: number;
  readonly reviewedLocalSequence: number;
  readonly memberCount: number;
}
export interface LibraryCoreReapplyConsumerIntentV1 {
  readonly review: LibraryCoreRecoveryReissueRequestV1;
  readonly intent: LibraryCoreFollowerIntentCommitV1;
}
function closedReissue(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length ||
      keys.some(key => { const field = Object.getOwnPropertyDescriptor(value, key); return !field?.enumerable || !("value" in field); })) {
    throw new TypeError("Recovery replacement fields are invalid");
  }
  return closed(value, keys);
}
/** Pins the reviewed original separately from the fresh signed replacement. */
export function parseLibraryCoreReapplyConsumerIntentV1(value: unknown): LibraryCoreReapplyConsumerIntentV1 {
  const input = closedReissue(value, ["review", "intent"]);
  const review = closedReissue(input.review, ["schemaVersion", "recoveryId", "archiveDigest", "transactionId", "transactionDigest",
    "reviewedGenerationId", "reviewedRevision", "reviewedLocalSequence", "memberCount"]);
  if (review.schemaVersion !== 1 || !isLibraryCoreOperationInstanceId(review.transactionId) ||
      count(review.memberCount) < 1 || count(review.memberCount) > 1000) throw new TypeError("Recovery replacement review is invalid");
  return Object.freeze({ review: Object.freeze({ schemaVersion: 1, recoveryId: hex(review.recoveryId), archiveDigest: hex(review.archiveDigest),
    transactionId: review.transactionId, transactionDigest: hex(review.transactionDigest), reviewedGenerationId: hex(review.reviewedGenerationId),
    reviewedRevision: count(review.reviewedRevision), reviewedLocalSequence: count(review.reviewedLocalSequence), memberCount: count(review.memberCount) }),
    intent: parseLibraryCoreFollowerIntentCommitV1(input.intent) });
}
