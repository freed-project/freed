import type { CAPI, Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  decodeLibraryCoreCanonicalBase64, decodeLibraryCoreCanonicalValue,
  decodeLibraryCoreFeedPageCursorV1, encodeLibraryCoreDigestInput, encodeLibraryCoreFeedPageCursorV1,
  isLibraryCoreEntityId, isLibraryCoreLowercaseHex64, isLibraryCoreEd25519PublicKeyHex, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS, parseLibraryCoreRecoveryIntentReviewRequestV1,
  parseLibraryCoreRecoveryIntentReviewResponseV1, parseLibraryCoreRecoveryReissueReceiptV1,
  sha256LowerHex, snapshotLibraryCoreCausalFrontier, verifyLibraryCoreActorCapabilityCertificateV2,
  verifyLibraryCoreActorEnrollmentCertificateV1, verifyLibraryCoreEd25519WithWebCrypto,
  verifyLibraryCoreFollowerResultV1, verifyLibraryCoreArchivedOperationTransactionV1,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
  type LibraryCoreArchivedIntentOutcomeV1, type LibraryCoreEd25519VerificationInput,
  type LibraryCoreRecoveryIntentReviewRequestV1, type LibraryCoreRecoveryIntentReviewResponseV1,
  type LibraryCoreArchivedOperationTransactionV1,
} from "@freed/shared/library-core";
import { readPwaLibraryStorageIdentity } from "./library-core-recovery-schema";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const encode = (text: string) => Uint8Array.from(new TextEncoder().encode(text));
const integer = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Recovery integer is invalid");
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Recovery text is invalid");
  return value;
};
const hex = (value: unknown) => {
  if (!isLibraryCoreLowercaseHex64(value)) throw new Error("Recovery digest is invalid");
  return value;
};
const publicKey = (value: unknown) => {
  if (!isLibraryCoreEd25519PublicKeyHex(value)) throw new Error("Recovery public key is invalid");
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Recovery object is invalid");
  return value as Record<string, unknown>;
};
const digest = (domain: LibraryCoreDigestDomain, value: unknown) =>
  sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue));
const select = (db: Database, sql: string, bind: SqlValue[] = []) => db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
function one(db: Database, sql: string, bind: SqlValue[] = []) {
  const rows = select(db, sql, bind);
  if (rows.length !== 1) throw new Error("Recovery evidence is missing or ambiguous");
  return rows[0]!;
}

type ArchiveTable = "library_intent_transactions" | "library_intent_members" | "library_intent_results" | "library_follower_actor_request";
/** Decode only the indexed bounded rows, retaining exact SQLite bytes and column identity. */
function archivedRows(db: Database, capi: CAPI, recoveryId: string, table: ArchiveTable, transactionId: string | null, limit: number) {
  const names = db.exec({ sql: `PRAGMA table_info(${table});`, rowMode: "array", returnValue: "resultRows" }).map(row => row[1]);
  const statement = db.prepare(`SELECT columns_json, canonical_row, row_digest FROM library_local_recovery_rows
    WHERE recovery_id = ?1 AND table_key = ?2 ${transactionId === null ? "" : "AND transaction_id = ?3"}
    ORDER BY row_ordinal LIMIT ${limit};`);
  statement.bind(transactionId === null ? [recoveryId, table] : [recoveryId, table, transactionId]);
  const rows: Record<string, string[]>[] = [];
  let retainedBytes = 0;
  try {
    while (statement.step()) {
      if (capi.sqlite3_column_bytes(statement, 0) > 16_384 || capi.sqlite3_column_bytes(statement, 1) > 2_097_152) throw new Error("Recovery archive row exceeds its bound");
      retainedBytes += capi.sqlite3_column_bytes(statement, 1);
      if (retainedBytes > 8_388_608) throw new Error("Recovery archived rows exceed their byte bound");
      const bytes = statement.getBlob(1);
      if (!bytes || sha256LowerHex(bytes) !== statement.get(2)) throw new Error("Recovery archive row integrity failed");
      const columns: unknown = JSON.parse(text(statement.get(0)));
      const cells = decodeLibraryCoreCanonicalValue(bytes, { maximumBytes: 2_097_152 });
      if (JSON.stringify(columns) !== JSON.stringify(names) || !Array.isArray(cells) || cells.length !== names.length) throw new Error("Recovery archive row shape changed");
      const row: Record<string, string[]> = Object.create(null);
      for (let index = 0; index < names.length; index++) {
        const cell = cells[index];
        if (!Array.isArray(cell) || !cell.every(value => typeof value === "string")) throw new Error("Recovery archive cell is invalid");
        row[text(names[index])] = cell as string[];
      }
      rows.push(row);
    }
  } finally { statement.finalize(); }
  return rows;
}
function cell(row: Record<string, string[]>, name: string, kind: string): string {
  const value = row[name];
  if (!value || value.length !== 2 || value[0] !== kind) throw new Error("Recovery archive cell type changed");
  return value[1]!;
}
const blob = (row: Record<string, string[]>, name: string) => decodeLibraryCoreCanonicalBase64(cell(row, name, "blob"));
const stringCell = (row: Record<string, string[]>, name: string) => utf8.decode(decodeLibraryCoreCanonicalBase64(cell(row, name, "text")));
const nullableCell = (row: Record<string, string[]>, name: string) => row[name]?.length === 1 && row[name]![0] === "null" ? null : stringCell(row, name);
function numberCell(row: Record<string, string[]>, name: string) {
  const value = cell(row, name, "integer"), result = integer(Number(value));
  if (String(result) !== value) throw new Error("Recovery archive integer is not canonical");
  return result;
}

async function verifyInput(db: Database, capi: CAPI, request: Pick<LibraryCoreRecoveryIntentReviewRequestV1, "recoveryId" | "transactionId">,
  verifySignature: (input: LibraryCoreEd25519VerificationInput) => Promise<boolean>) {
  const archive = one(db, `SELECT archive.* FROM library_local_recovery_archives AS archive
    JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = archive.library_id
    WHERE recovery_id = ?1 AND archive.schema_sha256 = ?2;`, [request.recoveryId, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256]);
  const transactions = archivedRows(db, capi, request.recoveryId, "library_intent_transactions", request.transactionId, 2);
  if (transactions.length !== 1) throw new Error("Recovery transaction is missing or ambiguous");
  const transaction = transactions[0]!, count = numberCell(transaction, "member_count"), first = numberCell(transaction, "first_counter");
  if (stringCell(transaction, "transaction_id") !== request.transactionId || stringCell(transaction, "actor_id") !== archive.actor_id ||
      stringCell(transaction, "intent_epoch_id") !== archive.predecessor_epoch_id || count < 1 || count > 1000 || first < 1 ||
      numberCell(transaction, "last_counter") !== first + count - 1 ||
      !["pending", "published", "accepted", "rejected"].includes(stringCell(transaction, "state"))) throw new Error("Recovery transaction identity changed");
  const members = archivedRows(db, capi, request.recoveryId, "library_intent_members", request.transactionId, count + 1);
  if (members.length !== count) throw new Error("Recovery transaction members are incomplete");
  let bytes = 0;
  const envelopes = members.map((member, index) => {
    if (stringCell(member, "transaction_id") !== request.transactionId || stringCell(member, "actor_id") !== archive.actor_id ||
        numberCell(member, "member_index") !== index || numberCell(member, "actor_counter") !== first + index) throw new Error("Recovery member order changed");
    const envelope = blob(member, "canonical_member"); bytes += envelope.length;
    if (!envelope.length || envelope.length > 131_072 || bytes > 4_194_304) throw new Error("Recovery transaction exceeds its byte bound");
    return envelope;
  });
  if (bytes !== numberCell(transaction, "canonical_member_bytes")) throw new Error("Recovery transaction byte count changed");
  const actors = select(db, `SELECT public_key, canonical_enrollment_certificate, enrollment_certificate_digest,
    chain_genesis_digest FROM library_actors WHERE actor_id = ?1 AND authority_epoch_id = ?2;`, [text(archive.actor_id), text(archive.predecessor_epoch_id)]);
  let actor = actors[0];
  if (actors.length > 1) throw new Error("Recovery actor is ambiguous");
  if (!actor) {
    const requests = archivedRows(db, capi, request.recoveryId, "library_follower_actor_request", null, 2);
    if (requests.length !== 1) throw new Error("Historical enrollment is missing or ambiguous");
    const original = requests[0]!;
    if (numberCell(original, "singleton_id") !== 1 || stringCell(original, "library_id") !== archive.library_id ||
        stringCell(original, "authority_epoch_id") !== archive.predecessor_epoch_id || stringCell(original, "actor_id") !== archive.actor_id) throw new Error("Historical enrollment identity changed");
    actor = { public_key: stringCell(original, "actor_public_key"), canonical_enrollment_certificate: stringCell(original, "canonical_enrollment_certificate"),
      enrollment_certificate_digest: stringCell(original, "enrollment_certificate_digest"), chain_genesis_digest: stringCell(original, "actor_chain_genesis") };
  }
  const certificateBytes = encode(text(actor.canonical_enrollment_certificate));
  const decoded = record(decodeLibraryCoreCanonicalValue(certificateBytes, { maximumBytes: 65_536 }));
  const body = record(decoded.certificate_body), enrollment = record(body.actor_enrollment_body);
  const authority = one(db, `SELECT library_id, epoch_number AS epoch, epoch_id, authority_key_id, authority_public_key
    FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;`, [text(archive.library_id), text(archive.predecessor_epoch_id)]);
  const acceptedAuthority = { library_id: hex(authority.library_id), epoch: integer(authority.epoch), epoch_id: hex(authority.epoch_id),
    authority_key_id: hex(authority.authority_key_id), authority_public_key: publicKey(authority.authority_public_key), observed_frontier: snapshotLibraryCoreCausalFrontier(enrollment.observed_frontier, "historical enrollment frontier") };
  const verifiedEnrollment = await (Object.hasOwn(body, "actor_capability_body") ? verifyLibraryCoreActorCapabilityCertificateV2 : verifyLibraryCoreActorEnrollmentCertificateV1)(
    certificateBytes, acceptedAuthority, { digest, verifySignature });
  const signedEnrollment = verifiedEnrollment.certificate.certificate_body.actor_enrollment_body;
  if (signedEnrollment.actor_id !== archive.actor_id || signedEnrollment.actor_public_key !== actor.public_key ||
      verifiedEnrollment.certificate.certificate_digest !== actor.enrollment_certificate_digest || verifiedEnrollment.actor_chain_genesis !== actor.chain_genesis_digest) throw new Error("Recovery enrollment differs from stored identity");
  const head = record(decodeLibraryCoreCanonicalValue(envelopes[0]!, { maximumBytes: 131_072 }));
  // Historical resolution checks the signed internal chain, never current edit admission.
  const verified = await verifyLibraryCoreArchivedOperationTransactionV1(envelopes, {
    library_id: authority.library_id, epoch: authority.epoch, epoch_id: authority.epoch_id,
    actor_id: archive.actor_id, actor_public_key: actor.public_key,
    next_actor_sequence: first, previous_actor_operation_id: head.previous_actor_operation_id,
    previous_actor_chain_digest: head.previous_actor_chain_digest,
  }, { digest, verifySignature });
  if (verified.transaction_body.transaction_id !== request.transactionId || verified.transaction_digest !== stringCell(transaction, "transaction_digest")) throw new Error("Recovery signed transaction differs from archive");
  return { archive, verified };
}

function acceptance(db: Database, verified: LibraryCoreArchivedOperationTransactionV1, revision: number): LibraryCoreArchivedIntentOutcomeV1 {
  let count = 0, committed: number | null = null, acceptedAt: number | null = null;
  for (const member of verified.members) {
    const rows = select(db, `SELECT status, digest, result_text, result_blob_digest, accepted_at FROM library_receipts
      WHERE actor_id = ?1 AND operation_id = ?2;`, [member.envelope.actor_id, member.envelope.operation_id]);
    if (!rows.length) continue;
    const receipt = rows[0]!;
    if (rows.length !== 1 || receipt.status !== "accepted" || receipt.digest !== member.envelope_digest || receipt.result_blob_digest !== null) throw new Error("Recovery canonical receipt conflicts with the original edit");
    const value = record(decodeLibraryCoreCanonicalValue(encode(text(receipt.result_text)), { maximumBytes: 65_536 }));
    const at = integer(receipt.accepted_at), current = integer(value.committedRevision);
    if (Object.keys(value).length !== 2 || value.operationId !== member.envelope.operation_id || current > revision ||
        (committed !== null && (committed !== current || acceptedAt !== at))) throw new Error("Recovery receipts do not form one atomic commit");
    committed = current; acceptedAt = at; count++;
  }
  if (!count) return { state: "unresolved" };
  if (count !== verified.members.length || committed === null) throw new Error("Recovery has incomplete canonical acceptance receipts");
  return { state: "confirmed_accepted", committed_revision: committed };
}
async function outcome(db: Database, capi: CAPI, request: Pick<LibraryCoreRecoveryIntentReviewRequestV1, "recoveryId" | "transactionId">,
  verified: LibraryCoreArchivedOperationTransactionV1, revision: number,
  verifySignature: (input: LibraryCoreEd25519VerificationInput) => Promise<boolean>) {
  const accepted = acceptance(db, verified, revision);
  const rows = archivedRows(db, capi, request.recoveryId, "library_intent_results", request.transactionId, 2);
  if (!rows.length) return accepted;
  if (rows.length !== 1) throw new Error("Recovery result is ambiguous");
  const row = rows[0]!, first = verified.members[0]!.envelope;
  numberCell(row, "received_at");
  const authority = one(db, `SELECT library_id AS libraryId, epoch_number AS epoch, epoch_id AS epochId,
    authority_key_id AS authorityKeyId, authority_public_key AS authorityPublicKey FROM library_authority_epochs
    WHERE library_id = ?1 AND epoch_id = ?2;`, [first.library_id, stringCell(row, "authority_epoch_id")]);
  const result = await verifyLibraryCoreFollowerResultV1(blob(row, "canonical_result"), { libraryId: text(authority.libraryId), epoch: integer(authority.epoch), epochId: text(authority.epochId),
    authorityKeyId: text(authority.authorityKeyId), authorityPublicKey: text(authority.authorityPublicKey) }, { verifySignature });
  const value = result.envelope;
  for (const [column, expected] of Object.entries({ transaction_id: first.transaction_id, actor_id: first.actor_id,
    authority_epoch_id: value.epoch_id, intent_epoch_id: first.epoch_id, status: value.status, result_digest: value.result_body_digest })) {
    if (stringCell(row, column) !== expected) throw new Error("Recovery result metadata differs from signed evidence");
  }
  if (value.transaction_id !== first.transaction_id || value.transaction_digest !== verified.transaction_digest || value.actor_id !== first.actor_id ||
      value.intent_epoch_id !== first.epoch_id || value.intent_epoch !== first.epoch || value.result_sequence !== numberCell(row, "result_sequence") ||
      value.previous_result_digest !== nullableCell(row, "previous_result_digest") ||
      value.authoritative_source_revision !== numberCell(row, "authoritative_source_revision") || value.authoritative_source_revision > revision) throw new Error("Recovery result does not match the original edit");
  if (value.status !== "rejected" || value.epoch_id !== first.epoch_id) return accepted;
  if (!value.rejection_reason || value.rejection_reason === "epoch_stale" || value.original_result_digest !== null ||
      value.canonical_operation_ids.length || value.receipt_ids.length || accepted.state === "confirmed_accepted") throw new Error("Recovery rejection contradicts historical evidence");
  return { state: "reported_rejected", reason: value.rejection_reason, result_digest: value.result_body_digest } as const;
}

/** Caller retains transaction ownership; this function never commits or grants edit admission. */
export async function inspectPwaRecoveryIntentInTransaction(db: Database, capi: CAPI,
  request: Pick<LibraryCoreRecoveryIntentReviewRequestV1, "recoveryId" | "transactionId">,
  verifySignature: (input: LibraryCoreEd25519VerificationInput) => Promise<boolean>) {
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 0 || ![2,5].includes(readPwaLibraryStorageIdentity(db).schemaVersion)) {
    throw new Error("Recovery inspection requires an owned recovery transaction");
  }
  const source = one(db, `SELECT generation.generation_id AS generationId, meta.source_revision AS projectionRevision,
    changes.revision AS changeRevision, local.sequence AS transitionSequence FROM library_materialization_generation AS generation
    JOIN library_meta AS meta ON meta.singleton_id = generation.singleton_id
    JOIN library_change_state AS changes ON changes.singleton_id = generation.singleton_id
    JOIN library_local_change_state AS local ON local.singleton_id = generation.singleton_id WHERE generation.singleton_id = 1;`);
  if (!isLibraryCoreLowercaseHex64(source.generationId) || integer(source.projectionRevision) !== integer(source.changeRevision)) throw new Error("Recovery source is invalid");
  const local = integer(source.transitionSequence), revision = integer(source.projectionRevision);
  const { archive, verified } = await verifyInput(db, capi, request, verifySignature);
  const evidence = await outcome(db, capi, request, verified, revision, verifySignature);
  const archiveDigest = text(archive.archive_digest);
  if (!isLibraryCoreLowercaseHex64(archiveDigest)) throw new Error("Recovery archive digest is invalid");
  const links = select(db, `SELECT archive_digest, original_transaction_digest, replacement_transaction_id AS replacementTransactionId,
    replacement_transaction_digest AS replacementTransactionDigest, replacement_epoch_id AS replacementEpochId,
    replacement_actor_id AS replacementActorId, first_counter AS firstCounter, last_counter AS lastCounter,
    member_count AS memberCount, created_at AS createdAt FROM library_local_recovery_reissues WHERE recovery_id = ?1 AND original_transaction_id = ?2;`, [request.recoveryId, request.transactionId]);
  let replacement = null;
  if (links.length) {
    const link = links[0]!;
    if (links.length !== 1 || link.archive_digest !== archiveDigest || link.original_transaction_digest !== verified.transaction_digest) throw new Error("Recovery replacement link conflicts with archive");
    const fields = { ...link };
    delete fields.archive_digest; delete fields.original_transaction_digest;
    const parsed = parseLibraryCoreRecoveryReissueReceiptV1({ ...fields, schemaVersion: 1, recoveryId: request.recoveryId, originalTransactionId: request.transactionId },
      { recoveryId: request.recoveryId, transactionId: request.transactionId, memberCount: verified.members.length });
    if (!parsed.ok) throw new Error(parsed.error); replacement = parsed.value;
  }
  return { verified, archiveDigest, outcome: evidence, replacement,
    source: { generationId: source.generationId, projectionRevision: revision, transitionSequence: local } };
}

/** Worker command serialization owns this read snapshot across asynchronous signatures. */
export async function queryPwaRecoveryIntentReview(db: Database, capi: CAPI, subtle: SubtleCrypto,
  input: LibraryCoreRecoveryIntentReviewRequestV1): Promise<LibraryCoreRecoveryIntentReviewResponseV1> {
  const parsedRequest = parseLibraryCoreRecoveryIntentReviewRequestV1(input);
  if (!parsedRequest.ok) throw new TypeError(parsedRequest.error);
  const request = parsedRequest.value;
  if (![2,5].includes(readPwaLibraryStorageIdentity(db).schemaVersion)) throw new Error("Recovery archives are unavailable in this storage version");
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 1) throw new Error("Recovery reader requires its own transaction");
  const deadline = performance.now() + 30_000;
  const check = () => { if (performance.now() >= deadline) throw new Error("Recovery review deadline exceeded"); };
  const verifySignature = async (input: LibraryCoreEd25519VerificationInput) => {
    check(); const valid = await verifyLibraryCoreEd25519WithWebCrypto(input, subtle); check(); return valid;
  };
  db.exec("BEGIN DEFERRED;");
  try {
    const { verified, archiveDigest, outcome: evidence, replacement, source } = await inspectPwaRecoveryIntentInTransaction(db, capi, request, verifySignature);
    const local = source.transitionSequence, revision = source.projectionRevision;
    const binding = `recovery_intent_review_v1:${request.recoveryId}:${archiveDigest}:${verified.transaction_digest}${request.includeOriginal ? ":original" : ""}`;
    if (!isLibraryCoreEntityId(binding)) throw new Error("Recovery cursor identity is invalid");
    let start = 0;
    if (request.cursor !== null) {
      const cursor = decodeLibraryCoreFeedPageCursorV1(request.cursor);
      if (!cursor.ok || cursor.value.globalId !== binding || cursor.value.generationId !== source.generationId ||
          cursor.value.projectionRevision !== revision || cursor.value.transitionSequence !== local || cursor.value.sortAt >= 1000) throw new Error("CURSOR_STALE");
      start = cursor.value.sortAt + 1;
      if (start >= verified.members.length) throw new Error("Recovery cursor is outside its transaction");
    }
    const rows = [], program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.recovery_intent_review_v1;
    let rowBytes = 0;
    for (let index = start; index < Math.min(start + request.limit, verified.members.length); index++) {
      check();
      const member = verified.members[index]!, envelope = member.envelope;
      const item = envelope.entity_type === "FeedItem" ? db.exec({ sql: program.variants.item_context.sql,
        bind: [envelope.entity_id], rowMode: "array", returnValue: "resultRows" })[0] : undefined;
      const payload = record(envelope.payload), assignment = ["feed_item_saved_assignment", "feed_item_archive_assignment", "feed_item_like_assignment"].includes(envelope.operation_type);
      const rssFeedState = envelope.entity_type === "RssFeed" ? db.selectValue(program.variants.rss_context.sql, [envelope.entity_id]) : null;
      const personState = envelope.entity_type === "Person" ? db.selectValue(program.variants.person_context.sql, [envelope.entity_id]) : null;
      const itemState = envelope.entity_type === "FeedItem" ? db.selectValue(program.variants.item_state.sql, [envelope.entity_id]) : null;
      const row = { itemState, personState, rssFeedState, assigned: assignment ? payload.assigned : null, assignedAt: assignment ? payload.assigned_at_ms : null,
        readAt: envelope.operation_type === "feed_item_read_assignment" ? payload.read_at_ms : null,
        createdAt: envelope.created_at_ms, entityId: envelope.entity_id, operationType: envelope.operation_type, memberIndex: index,
        authorName: item?.[0] ?? null, itemText: item?.[1] ?? null, itemPresent: envelope.entity_type === "FeedItem" ? Boolean(item) : null,
        originalEnvelopeJson: request.includeOriginal ? member.canonical_envelope_json : null };
      const size = encode(JSON.stringify(row)).length + 1;
      if (rowBytes + size > 524_288 - 16_384) { if (!rows.length) throw new Error("Recovery member exceeds its page bound"); break; }
      rows.push(row); rowBytes += size;
    }
    const end = start + rows.length;
    const parsed = parseLibraryCoreRecoveryIntentReviewResponseV1({ queryId: request.queryId, schemaVersion: 1,
      recoveryId: request.recoveryId, archiveDigest, transactionId: request.transactionId, transactionDigest: verified.transaction_digest,
      memberCount: verified.members.length, outcome: evidence, replacement, rows,
      nextCursor: end < verified.members.length ? encodeLibraryCoreFeedPageCursorV1({ generationId: source.generationId, globalId: binding,
        sortAt: end - 1, projectionRevision: revision, transitionSequence: local }) : null,
      source: { generationId: source.generationId, projectionRevision: revision, transitionSequence: local } }, request);
    if (!parsed.ok) throw new Error(parsed.error);
    check(); db.exec("COMMIT;"); return parsed.value;
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
}
