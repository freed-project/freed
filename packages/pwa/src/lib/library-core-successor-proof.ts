import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  verifyLibraryCoreHandoffCertificateV1, verifyLibraryCoreHandoffPredecessorCheckpointV1, verifyLibraryCoreEd25519WithWebCrypto,
  decodeLibraryCoreCanonicalValue, parseLibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";

const verifiedBindings = new WeakMap<object, string>();
export type PwaVerifiedSuccessor = Readonly<{ epochId: string; writerId: string }>;
function rows(database: Database, sql: string, bind: string[] = []) {
  return database.exec({ sql, bind, rowMode: "array", returnValue: "resultRows" });
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("successor proof text is unavailable");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("successor proof integer is invalid");
  return value;
}
function continuationBinding(database: Database, stageId: string, stage: unknown[], requests: unknown[][]) {
  // Native checkpoints use a local authority writer label such as primary:desktop.
  // The cloud writer is the unique active Desktop actor, also pinned by the receipt.
  const accepted = rows(database, `SELECT epoch.epoch_number, epoch.transition_certificate_digest,
      epoch.authority_key_id, epoch.authority_public_key, epoch.canonical_transition_certificate, actor.actor_id,
      actor.public_key, meta.source_revision, receipt.checkpoint_generation
    FROM library_meta AS meta
    JOIN library_active_authority AS active ON active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
    JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
    JOIN library_actors AS actor ON actor.authority_epoch_id = epoch.epoch_id
    JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
      AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = epoch.epoch_id AND receipt.writer_actor_id = actor.actor_id
    WHERE meta.singleton_id = 1 AND active.active_key = 'active' AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
      AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id = epoch.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL) = 1;`);
  const history = rows(database, `SELECT epoch_number, transition_certificate_digest, authority_public_key
    FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;`, [string(stage[0]), string(requests[0]?.[1])]);
  if (accepted.length !== 1 || history.length !== 1) throw new Error("follower checkpoint requires authority recovery: continuation authority is unavailable");
  const current = accepted[0]!, old = history[0]!;
  const stored = rows(database, `SELECT record_canonical FROM library_checkpoint_stage_records
    WHERE stage_id = ?1 AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;`, [stageId, string(stage[1])]);
  if (stored.length !== 1 || !(stored[0]?.[0] instanceof Uint8Array)) throw new Error("pending recovery continuation authority is missing");
  const record = parseLibraryCoreNormalizedCheckpointRecordV2(decodeLibraryCoreCanonicalValue(stored[0][0], { maximumBytes: 131_072 }));
  const payload = record.payload as Record<string, unknown>;
  if (payload.epochNumber !== current[0] || payload.transitionCertificateDigest !== current[1] ||
      payload.authorityKeyId !== current[2] || payload.authorityPublicKey !== current[3] || payload.canonicalTransitionCertificate !== current[4]) {
    throw new Error("pending recovery continuation changed the accepted authority");
  }
  const canonical = string(current[4]);
  const decoded = decodeLibraryCoreCanonicalValue(Uint8Array.from(new TextEncoder().encode(canonical)), { maximumBytes: 16_384 });
  const control = (decoded as { certificate_body: { handoff_authorization: { body: { source_control: { writerId: string } } } } }).certificate_body?.handoff_authorization?.body?.source_control;
  const predecessor = { libraryId: string(stage[0]), epochId: string(requests[0]![1]), epoch: number(old[0]),
    certificateDigest: string(old[1]), authorityPublicKey: string(old[2]), writerId: string(control?.writerId) };
  const expected = { libraryId: string(stage[0]), epochId: string(stage[1]), epoch: number(current[0]),
    certificateDigest: string(current[1]), authorityKeyId: string(current[2]), authorityPublicKey: string(current[3]), writerId: string(current[5]) };
  return { predecessor, expected, canonical, actorKey: string(current[6]), sourceRevision: number(stage[2]), continuation: true,
    snapshot: JSON.stringify({ stageId, stage, accepted, history, requests, record }) };
}

function binding(database: Database, stageId: string, allowMissingEnrollment = false) {
  const stages = rows(database, `SELECT library_id, authority_epoch, source_revision, expected_record_count, staged_canonical_bytes
    FROM library_checkpoint_stages WHERE stage_id = ?1 AND staged_record_count = expected_record_count;`, [stageId]);
  if (stages.length !== 1) throw new Error("successor checkpoint stage is incomplete");
  const stage = stages[0]!;
  const selected = rows(database, "SELECT library_id, authority_epoch FROM library_meta WHERE singleton_id = 1;");
  if (selected.length === 0) return null;
  if (selected.length !== 1 || selected[0]?.[0] !== stage[0]) throw new Error("successor checkpoint Library changed");
  const requests = rows(database, "SELECT library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest, canonical_enrollment_request, created_at FROM library_follower_actor_request WHERE singleton_id = 1;");
  if (requests.length > 1 || (requests.length === 1 && requests[0]?.[0] !== stage[0])) throw new Error("follower checkpoint requires authority recovery: enrollment Library changed");
  if (selected[0]?.[1] === stage[1]) {
    if (requests.length === 0 || requests[0]?.[1] === stage[1]) return null;
    return continuationBinding(database, stageId, stage, requests);
  }
  const trusted = rows(database, `SELECT meta.library_id, old.epoch_id, old.epoch_number, old.transition_certificate_digest,
      old.authority_public_key, (SELECT actor_id FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL)
    FROM library_meta AS meta JOIN library_active_authority AS active ON active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
    JOIN library_authority_epochs AS old ON old.epoch_id = active.epoch_id
    WHERE meta.singleton_id = 1 AND active.active_key = 'active'
      AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL) = 1;`);
  if (trusted.length !== 1) throw new Error("successor requires one accepted predecessor");
  const old = trusted[0]!;
  if (requests.length > 1 || (requests.length === 1 && (requests[0]?.[0] !== old[0] || requests[0]?.[1] !== old[1]))) throw new Error("finish consumer recovery before another successor");
  const stored = rows(database, `SELECT record_canonical FROM library_checkpoint_stage_records
    WHERE stage_id = ?1 AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;`, [stageId, string(stage[1])]);
  if (stored.length !== 1 || !(stored[0]?.[0] instanceof Uint8Array)) throw new Error("successor authority record is missing");
  const record = parseLibraryCoreNormalizedCheckpointRecordV2(decodeLibraryCoreCanonicalValue(stored[0][0], { maximumBytes: 131_072 }));
  const payload = record.payload as Record<string, unknown>;
  const canonical = string(payload.canonicalTransitionCertificate);
  if (new TextEncoder().encode(canonical).length > 16_384) throw new Error("successor certificate exceeds its bound");
  const target = JSON.parse(canonical)?.certificate_body?.target_writer_id;
  if (typeof target !== "string" || target.length !== 64 || /[^0-9a-f]/.test(target)) throw new Error("successor target is invalid");
  const enrollment = rows(database, "SELECT public_key FROM library_actors WHERE actor_id = ?1 AND authority_epoch_id = ?2 AND retired_at IS NULL;", [target, string(old[1])]);
  if (enrollment.length !== 1 && (!allowMissingEnrollment || enrollment.length !== 0)) throw new Error("successor target is not enrolled in the accepted predecessor");
  if (allowMissingEnrollment && enrollment.length === 0 && rows(database,
    "SELECT actor_id FROM library_actors WHERE actor_id=?1;", [target]).length !== 0) {
    throw new Error("predecessor catch-up cannot replace a retired or conflicting target");
  }
  const predecessor = { libraryId: string(old[0]), epochId: string(old[1]), epoch: number(old[2]),
    certificateDigest: string(old[3]), authorityPublicKey: string(old[4]), writerId: string(old[5]) };
  const expected = { libraryId: string(stage[0]), epochId: string(stage[1]), epoch: number(payload.epochNumber),
    certificateDigest: string(payload.transitionCertificateDigest), authorityKeyId: string(payload.authorityKeyId),
    authorityPublicKey: string(payload.authorityPublicKey), writerId: target };
  const actorKey = enrollment.length === 1 ? string(enrollment[0]![0]) : null;
  return { predecessor, expected, canonical, actorKey, sourceRevision: number(stage[2]), continuation: false,
    snapshot: JSON.stringify({ stageId, stage, trusted, requests, actorKey, record }) };
}

/** No proof survives a change to its locally trusted predecessor or staged row. */
export async function verifyPwaCheckpointSuccessor(
  database: Database, stageId: string, subtle: SubtleCrypto,
): Promise<PwaVerifiedSuccessor | null> {
  const before = binding(database, stageId);
  if (!before) return null;
  if (before.actorKey === null) throw new Error("successor target is not enrolled in the accepted predecessor");
  const proof = await verifyLibraryCoreHandoffCertificateV1(new TextEncoder().encode(before.canonical), before.predecessor,
    before.actorKey, { verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input, subtle) });
  if (before.sourceRevision < proof.finalSourceRevision) throw new Error("successor checkpoint predates the authorized frontier");
  for (const key of Object.keys(before.expected) as (keyof typeof before.expected)[]) {
    if (proof[key] !== before.expected[key]) throw new Error("successor authority fields differ from signed proof");
  }
  if (binding(database, stageId)?.snapshot !== before.snapshot) throw new Error("successor proof changed during verification");
  const result = Object.freeze({ epochId: proof.epochId, writerId: proof.writerId });
  verifiedBindings.set(result, before.snapshot);
  return result;
}

/** Called synchronously inside activation's write transaction, before deletion. */
export function requirePwaCheckpointSuccessor(
  database: Database, stageId: string, proof: PwaVerifiedSuccessor | null, writerId: string,
): "successor" | "continuation" | null {
  const current = binding(database, stageId);
  if (!current) return null;
  if (!proof || proof.writerId !== writerId || verifiedBindings.get(proof) !== current.snapshot) throw new Error("successor checkpoint requires a current verified proof");
  return current.continuation ? "continuation" : "successor";
}

export type PwaVerifiedPredecessorRead = Awaited<ReturnType<typeof verifyLibraryCoreHandoffPredecessorCheckpointV1>>;
const predecessorReads = new WeakMap<object, { database: Database; snapshot: string }>();
function predecessorReadBinding(database: Database, stageId: string) {
  const source = binding(database, stageId, true);
  if (!source || source.continuation || source.actorKey !== null) return null;
  const localRevision = number(database.selectValue("SELECT source_revision FROM library_meta WHERE singleton_id=1;"));
  return { source, localRevision, snapshot: JSON.stringify({ stageId, source: source.snapshot, localRevision }) };
}

/** Read-only preparation. This grants no permission to activate either checkpoint. */
export async function preparePwaPredecessorCheckpointRead(
  database: Database, stageId: string, subtle: SubtleCrypto,
): Promise<PwaVerifiedPredecessorRead | null> {
  const before = predecessorReadBinding(database, stageId);
  if (!before) return null;
  const result = await verifyLibraryCoreHandoffPredecessorCheckpointV1(
    new TextEncoder().encode(before.source.canonical), before.source.predecessor,
    { verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input, subtle) },
  );
  if (result.successorEpochId !== before.source.expected.epochId ||
      result.sourceRevision < before.localRevision || result.sourceRevision > before.source.sourceRevision) {
    throw new Error("predecessor checkpoint does not cover the selected source");
  }
  if (predecessorReadBinding(database, stageId)?.snapshot !== before.snapshot) {
    throw new Error("predecessor checkpoint read changed during verification");
  }
  predecessorReads.set(result, { database, snapshot: before.snapshot });
  return result;
}

/** Recheck before using the read reference. Import still owns all write admission. */
export function requirePwaPredecessorCheckpointRead(
  database: Database, stageId: string, proof: PwaVerifiedPredecessorRead,
): void {
  const retained = predecessorReads.get(proof);
  if (!retained || retained.database !== database ||
      predecessorReadBinding(database, stageId)?.snapshot !== retained.snapshot) {
    throw new Error("predecessor checkpoint read requires a current verified binding");
  }
}
