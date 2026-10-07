import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  verifyLibraryCoreHandoffCertificateV1, verifyLibraryCoreHandoffPredecessorCheckpointV1, verifyLibraryCoreEd25519WithWebCrypto,
  decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue, parseLibraryCoreNormalizedCheckpointRecordV2,
  verifyLibraryCoreHandoffChainReadsV1, createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
  verifyLibraryCoreActorCapabilityCertificateV2, verifyLibraryCoreActorEnrollmentCertificateV1,
  snapshotLibraryCoreCausalFrontier, isLibraryCoreLowercaseHex64, isLibraryCoreEd25519PublicKeyHex,
  encodeLibraryCoreDigestInput, sha256LowerHex,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
} from "@freed/shared/library-core";

import { readPwaRetainedHandoffCertificates } from "./library-core-consumer-recovery";

const verifiedBindings = new WeakMap<object, string>();
export type PwaVerifiedSuccessor = Readonly<{ epochId: string; writerId: string }>;
function rows(database: Database, sql: string, bind: SqlValue[] = []) {
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
  const chain = readPwaRetainedHandoffCertificates(database,string(requests[0]![1]),string(stage[1]));
  if (chain.at(-1) !== canonical) throw new Error("pending recovery continuation history changed");
  const decoded = decodeLibraryCoreCanonicalValue(Uint8Array.from(new TextEncoder().encode(chain[0]!)), { maximumBytes: 16_384 });
  const control = (decoded as { certificate_body: { handoff_authorization: { body: { source_control: { writerId: string } } } } }).certificate_body?.handoff_authorization?.body?.source_control;
  const predecessor = { libraryId: string(stage[0]), epochId: string(requests[0]![1]), epoch: number(old[0]),
    certificateDigest: string(old[1]), authorityPublicKey: string(old[2]), writerId: string(control?.writerId) };
  const expected = { libraryId: string(stage[0]), epochId: string(stage[1]), epoch: number(current[0]),
    certificateDigest: string(current[1]), authorityKeyId: string(current[2]), authorityPublicKey: string(current[3]), writerId: string(current[5]) };
  return { predecessor, expected, canonical, chain, actorKey: string(current[6]), sourceRevision: number(stage[2]), continuation: true,
    snapshot: JSON.stringify({ stageId, stage, accepted, history, requests, record, chain }) };
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
  return { predecessor, expected, canonical, chain: null, actorKey, sourceRevision: number(stage[2]), continuation: false,
    snapshot: JSON.stringify({ stageId, stage, trusted, requests, actorKey, record }) };
}

function historicalBinding(database: Database, stageId: string) {
  const selected = rows(database, "SELECT library_id,authority_epoch,source_revision FROM library_meta WHERE singleton_id=1;");
  if (selected.length === 0) return null;
  const stages = rows(database, `SELECT library_id,authority_epoch,source_revision,expected_record_count,staged_canonical_bytes
    FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;`, [stageId]);
  if (selected.length !== 1 || stages.length !== 1) throw new Error("historical successor stage is incomplete");
  const local = selected[0]!, stage = stages[0]!;
  if (local[0] !== stage[0]) throw new Error("historical successor changes the selected Library");
  if (local[1] === stage[1]) return null;
  const certificates: Uint8Array[] = [];
  let successorPayload: Record<string, unknown> | undefined;
  let epoch = string(stage[1]);
  while (epoch !== local[1]) {
    if (certificates.length === 32) throw new Error("historical successor chain exceeds its bound");
    const found = rows(database, `SELECT CASE WHEN length(record_canonical)<=131072 THEN record_canonical ELSE NULL END
      FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='01_authority_epoch' AND primary_key_canonical=?2;`,
      [stageId, encodeLibraryCoreCanonicalValue(epoch)]);
    if (found.length !== 1 || !(found[0]?.[0] instanceof Uint8Array)) throw new Error("historical authority record is missing or oversized");
    const record = parseLibraryCoreNormalizedCheckpointRecordV2(decodeLibraryCoreCanonicalValue(found[0][0], { maximumBytes: 131_072 }));
    const payload = record.payload as Record<string, unknown>;
    successorPayload ??= payload;
    const text = string(payload.canonicalTransitionCertificate);
    if (text.length > 16_384) throw new Error("historical certificate exceeds its bound");
    const bytes = Uint8Array.from(new TextEncoder().encode(text));
    const decoded = decodeLibraryCoreCanonicalValue(bytes, { maximumBytes: 16_384 }) as {
      epoch_id: unknown; certificate_body: { handoff_authorization: { body: { readiness: { body: { predecessor_epoch_id: unknown } } } } };
    };
    if (decoded.epoch_id !== epoch || record.primaryKey !== epoch) throw new Error("historical authority identity changed");
    epoch = string(decoded.certificate_body?.handoff_authorization?.body?.readiness?.body?.predecessor_epoch_id);
    certificates.push(bytes);
  }
  if (certificates.length === 1) return null;
  certificates.reverse();
  const accepted = rows(database, `SELECT old.epoch_number,old.transition_certificate_digest,old.authority_public_key,actor.actor_id
    FROM library_meta meta JOIN library_active_authority active ON active.library_id=meta.library_id AND active.epoch_id=meta.authority_epoch
    JOIN library_authority_epochs old ON old.epoch_id=active.epoch_id JOIN library_actors actor ON actor.authority_epoch_id=old.epoch_id
    WHERE meta.singleton_id=1 AND active.active_key='active' AND actor.actor_kind='desktop' AND actor.retired_at IS NULL
    AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id=old.epoch_id AND actor_kind='desktop' AND retired_at IS NULL)=1;`);
  if (accepted.length !== 1) throw new Error("historical chain requires one accepted authority");
  const requests = rows(database, `SELECT library_id,authority_epoch_id,actor_id,actor_public_key,enrollment_request_digest,canonical_enrollment_request,created_at
    FROM library_follower_actor_request WHERE singleton_id=1;`);
  if (requests.length > 1 || (requests.length === 1 && (requests[0]![0] !== local[0] || requests[0]![1] !== local[1]))) {
    throw new Error("finish consumer recovery before another authority chain");
  }
  const old = accepted[0]!;
  return { certificates, successorPayload, predecessor: { libraryId: string(local[0]), epochId: string(local[1]), epoch: number(old[0]),
    certificateDigest: string(old[1]), authorityPublicKey: string(old[2]), writerId: string(old[3]) },
    successorEpoch: string(stage[1]), localRevision: number(local[2]), sourceRevision: number(stage[2]),
    snapshot: JSON.stringify({ stageId,selected,stages,accepted,requests,successorPayload,certificates: certificates.map(bytes => new TextDecoder().decode(bytes)) }) };
}

/** Download permission only. Final import must verify all staged historical
 * contents and enrollment inside the same transaction that replaces rows. */
export async function preparePwaHistoricalChainReads(database: Database, stageId: string, subtle: SubtleCrypto) {
  const before = historicalBinding(database,stageId);
  if (!before) return null;
  const verified = await verifyHistoricalBinding(before,subtle);
  if (historicalBinding(database,stageId)?.snapshot !== before.snapshot) throw new Error("historical chain changed during verification");
  return verified.references;
}

async function verifyHistoricalBinding(before: NonNullable<ReturnType<typeof historicalBinding>>, subtle: SubtleCrypto) {
  const verified = await verifyLibraryCoreHandoffChainReadsV1(before.certificates,before.predecessor,before.successorEpoch,
    { verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input,subtle) });
  let revision = before.localRevision;
  for (const reference of verified.references) {
    if (reference.sourceRevision < revision || reference.sourceRevision > before.sourceRevision) {
      throw new Error("historical checkpoints regress the selected source");
    }
    revision = reference.sourceRevision;
  }
  const proof = verified.successor, expected = before.successorPayload;
  if (!expected || expected.libraryId !== proof.libraryId || expected.epochNumber !== proof.epoch ||
      expected.authorityKeyId !== proof.authorityKeyId || expected.authorityPublicKey !== proof.authorityPublicKey ||
      expected.transitionCertificateDigest !== proof.certificateDigest) throw new Error("historical successor authority fields changed");
  return verified;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("historical proof object is invalid");
  return value as Record<string, unknown>;
}
function hex(value: unknown) {
  if (!isLibraryCoreLowercaseHex64(value)) throw new Error("historical proof identity is invalid");
  return value;
}
const digest = (domain: LibraryCoreDigestDomain, value: unknown) => sha256LowerHex(encodeLibraryCoreDigestInput(domain,value as LibraryCoreCanonicalValue));
type HistoricalReference = Awaited<ReturnType<typeof verifyLibraryCoreHandoffChainReadsV1>>["references"][number];
function historicalActor(database: Database, reference: HistoricalReference, actorId: string) {
  const found = rows(database, `SELECT CASE WHEN length(record_canonical)<=131072 THEN record_canonical ELSE NULL END
    FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='90_actor_state' AND primary_key_canonical=?2;`,
    [reference.pointer.manifest.descriptor.contentDigest,encodeLibraryCoreCanonicalValue(actorId)]);
  if (found.length !== 1 || !(found[0]?.[0] instanceof Uint8Array)) throw new Error("historical target enrollment is missing or oversized");
  const bytes = Uint8Array.from(found[0][0]);
  const record = parseLibraryCoreNormalizedCheckpointRecordV2(decodeLibraryCoreCanonicalValue(bytes,{maximumBytes:131_072}));
  if (record.primaryKey !== actorId) throw new Error("historical target identity changed");
  return { record, canonical: new TextDecoder("utf-8",{fatal:true}).decode(bytes) };
}
function requireHistoricalContents(database: Database, reference: HistoricalReference, onRecord: () => void) {
  const id = reference.pointer.manifest.descriptor.contentDigest;
  const stages = rows(database, `SELECT library_id,authority_epoch,source_revision,expected_record_count,staged_canonical_bytes
    FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;`,[id]);
  if (stages.length !== 1 || stages[0]![0] !== reference.pointer.libraryId || stages[0]![1] !== reference.pointer.storageEpoch ||
      stages[0]![2] !== reference.sourceRevision) throw new Error("historical checkpoint identity differs from signed consent");
  const accumulator = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
  const statement = database.prepare(`SELECT CASE WHEN length(record_canonical)<=131072 THEN record_canonical ELSE NULL END
    FROM library_checkpoint_stage_records WHERE stage_id=?1 ORDER BY registry_key,primary_key_canonical;`);
  let header = false;
  try {
    statement.bind([id]);
    while (statement.step()) {
      const value = statement.getBlob(0);
      if (!value) throw new Error("historical checkpoint record exceeds its bound");
      const bytes = Uint8Array.from(value);
      const record = parseLibraryCoreNormalizedCheckpointRecordV2(decodeLibraryCoreCanonicalValue(bytes,{maximumBytes:131_072}));
      const canonical = encodeLibraryCoreCanonicalValue(record as unknown as LibraryCoreCanonicalValue,{maximumBytes:131_072});
      if (canonical.length !== bytes.length || canonical.some((byte,index) => byte !== bytes[index])) throw new Error("historical checkpoint bytes are not canonical");
      if (record.registryKey === "00_checkpoint_header") {
        const payload = object(record.payload);
        if (header || payload.libraryId !== reference.pointer.libraryId || payload.authorityEpoch !== reference.pointer.storageEpoch ||
            payload.sourceRevision !== reference.sourceRevision) throw new Error("historical checkpoint header changed");
        header = true;
      }
      accumulator.push(record);
      onRecord();
    }
  } finally { statement.finalize(); }
  const completed = accumulator.finish();
  if (!header || completed.checkpointDigest !== reference.checkpointDigest || completed.recordCount !== stages[0]![3] ||
      completed.canonicalBytes !== stages[0]![4]) throw new Error("historical checkpoint contents differ from signed consent");
}
const historicalProofs = new WeakMap<object, { database: Database; snapshot: string;
  references: readonly HistoricalReference[]; actors: { id: string; canonical: string }[] }>();
async function verifyHistoricalSuccessor(database: Database, stageId: string, subtle: SubtleCrypto,
  before: NonNullable<ReturnType<typeof historicalBinding>>): Promise<PwaVerifiedSuccessor> {
  const verified = await verifyHistoricalBinding(before,subtle);
  let authorityPublicKey = before.predecessor.authorityPublicKey, epoch = before.predecessor.epoch;
  const actors: { id: string; canonical: string }[] = [];
  for (let index=0;index<verified.references.length;index++) {
    const reference = verified.references[index]!;
    const certificate = object(decodeLibraryCoreCanonicalValue(before.certificates[index]!,{maximumBytes:16_384}));
    const body = object(certificate.certificate_body), grant = object(object(body.handoff_authorization).body);
    const ready = object(object(grant.readiness).body), actorId = string(body.target_writer_id);
    const actor = historicalActor(database,reference,actorId), fields = object(actor.record.payload);
    if (fields.authorityEpochId !== reference.pointer.storageEpoch || fields.publicKey !== ready.target_actor_public_key ||
        fields.actorKind !== "pwa" || fields.retiredAt !== null) throw new Error("historical target is not an active predecessor consumer");
    const enrollmentText = string(fields.canonicalEnrollmentCertificate);
    if (enrollmentText.length > 65_536) throw new Error("historical target certificate exceeds its bound");
    const enrollmentBytes = Uint8Array.from(new TextEncoder().encode(enrollmentText));
    const decoded = object(decodeLibraryCoreCanonicalValue(enrollmentBytes,{maximumBytes:65_536}));
    const enrollmentBody = object(decoded.certificate_body), enrollment = object(enrollmentBody.actor_enrollment_body);
    if (!isLibraryCoreEd25519PublicKeyHex(authorityPublicKey)) throw new Error("historical authority key is invalid");
    const authority = { library_id:hex(reference.pointer.libraryId),epoch,epoch_id:hex(reference.pointer.storageEpoch),
      authority_key_id:hex(digest("authority-key",{authority_public_key:authorityPublicKey,signature_algorithm:"ed25519"})),
      authority_public_key:authorityPublicKey,observed_frontier:snapshotLibraryCoreCausalFrontier(enrollment.observed_frontier,"historical enrollment frontier") };
    const checked = await (Object.hasOwn(enrollmentBody,"actor_capability_body") ? verifyLibraryCoreActorCapabilityCertificateV2 : verifyLibraryCoreActorEnrollmentCertificateV1)(
      enrollmentBytes,authority,{digest,verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input,subtle)});
    const signed = checked.certificate.certificate_body.actor_enrollment_body;
    if (signed.actor_id !== actorId || signed.actor_public_key !== fields.publicKey || signed.operation_id !== fields.enrollmentOperationId ||
        checked.certificate.certificate_digest !== fields.enrollmentCertificateDigest || checked.actor_chain_genesis !== fields.chainGenesisDigest) {
      throw new Error("historical target row differs from its verified enrollment");
    }
    actors.push({id:actorId,canonical:actor.canonical});
    authorityPublicKey = string(body.target_authority_public_key); epoch = number(body.target_epoch);
  }
  if (historicalBinding(database,stageId)?.snapshot !== before.snapshot) throw new Error("historical chain changed during verification");
  const result = Object.freeze({epochId:verified.successor.epochId,writerId:verified.successor.writerId});
  historicalProofs.set(result,{database,snapshot:before.snapshot,references:verified.references,actors});
  return result;
}
/** Counts immutable stage work under activation's transaction. This grants no
 * admission; every counted record is still authenticated before replacement. */
export function describePwaHistoricalVerificationStages(database: Database, stageId: string, proof: PwaVerifiedSuccessor | null) {
  const current = historicalBinding(database,stageId);
  if (!current) return { recordCount: 0, stageIds: [] as string[] };
  const retained = proof ? historicalProofs.get(proof) : undefined;
  if (!retained || retained.snapshot !== current.snapshot) throw new Error("historical stages require a current verified proof");
  if (retained.database !== database) throw new Error("historical progress belongs to another database");
  let total = 0;
  const stageIds: string[] = [];
  for (const reference of retained.references) {
    const value = database.selectValue(`SELECT expected_record_count FROM library_checkpoint_stages
      WHERE stage_id=?1 AND staged_record_count=expected_record_count;`,[reference.pointer.manifest.descriptor.contentDigest]);
    total = number(total + number(value));
    stageIds.push(reference.pointer.manifest.descriptor.contentDigest);
  }
  return { recordCount: total, stageIds };
}
function requireHistoricalSuccessor(database: Database, stageId: string, proof: PwaVerifiedSuccessor | null, writerId: string,
  onProgress?: (completedRecords: number) => void): boolean {
  const current = historicalBinding(database,stageId);
  if (!current) return false;
  const retained = proof ? historicalProofs.get(proof) : undefined;
  if (!retained || retained.database !== database || retained.snapshot !== current.snapshot || proof?.writerId !== writerId) {
    throw new Error("historical successor requires a current verified proof");
  }
  let completed = 0;
  for (let index=0;index<retained.references.length;index++) {
    const reference = retained.references[index]!, actor = retained.actors[index]!;
    requireHistoricalContents(database,reference,() => {
      completed += 1;
      if (completed % 256 === 0) onProgress?.(completed);
    });
    if (historicalActor(database,reference,actor.id).canonical !== actor.canonical) throw new Error("historical enrollment changed during verification");
  }
  if (completed % 256 !== 0) onProgress?.(completed);
  return true;
}

/** No proof survives a change to its locally trusted predecessor or staged row. */
export async function verifyPwaCheckpointSuccessor(
  database: Database, stageId: string, subtle: SubtleCrypto,
): Promise<PwaVerifiedSuccessor | null> {
  // Capture the applicable proof before the first yield, including direct transfers.
  const historical = historicalBinding(database,stageId);
  if (historical) return verifyHistoricalSuccessor(database,stageId,subtle,historical);
  const before = binding(database, stageId);
  if (!before) return null;
  if (before.actorKey === null) throw new Error("successor target is not enrolled in the accepted predecessor");
  // A continuation is already admitted locally. Reauthenticate its retained
  // path without demanding historical downloads or replacing old enrollment.
  const verifier = { verifySignature: (input: Parameters<typeof verifyLibraryCoreEd25519WithWebCrypto>[0]) => verifyLibraryCoreEd25519WithWebCrypto(input, subtle) };
  const proof = before.chain
    ? (await verifyLibraryCoreHandoffChainReadsV1(before.chain.map(value => Uint8Array.from(new TextEncoder().encode(value))),
      before.predecessor,before.expected.epochId,verifier)).successor
    : await verifyLibraryCoreHandoffCertificateV1(new TextEncoder().encode(before.canonical), before.predecessor,before.actorKey,verifier);
  if (before.chain) {
    const final = object(decodeLibraryCoreCanonicalValue(Uint8Array.from(new TextEncoder().encode(before.canonical)),{maximumBytes:16_384}));
    const grant = object(object(object(final.certificate_body).handoff_authorization).body);
    if (object(object(grant.readiness).body).target_actor_public_key !== before.actorKey) throw new Error("continuation writer key differs from signed consent");
  }
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
  onHistoricalProgress?: (completedRecords: number) => void,
): "successor" | "continuation" | null {
  if (requireHistoricalSuccessor(database,stageId,proof,writerId,onHistoricalProgress)) return "successor";
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
