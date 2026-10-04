import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import { describe, expect, it } from "vitest";
import { encodeLibraryCoreFeedPageCursorV1 } from "./feed-page-contracts.js";
import {
  parseLibraryCoreRecoveryIntentReviewRequestV1,
  parseLibraryCoreRecoveryIntentReviewResponseV1,
  parseLibraryCoreRecoveryIntentPageRequestV1,
  parseLibraryCoreRecoveryIntentPageResponseV1,
} from "./recovery-intent-page-contracts.js";
import { createLibraryCoreSqliteQueryWorkerRequest, parseLibraryCoreSqliteQueryResponse } from "./sqlite-worker-protocol.js";

const request = {
  queryId: "recovery_intent_page_v1" as const, schemaVersion: 1 as const,
  recoveryId: "b".repeat(64), cancellationId: "cancel-recovery", readerSessionId: "reader-recovery", cursor: null, limit: 2,
};
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
const archiveDigest = "c".repeat(64);
const cursor = encodeLibraryCoreFeedPageCursorV1({
  ...source, generationId: source.generationId as never, sortAt: 1,
  globalId: `recovery_intent_page_v1:${request.recoveryId}:${archiveDigest}` as never,
});
const response = {
  queryId: request.queryId, schemaVersion: 1, recoveryId: request.recoveryId, archiveDigest, source,
  rows: [{ ordinal: 0, transactionId: "first" }, { ordinal: 1, transactionId: "second" }], nextCursor: cursor,
};

describe("recovery intent page contract", () => {
  it("uses the registered worker query and rejects unbounded or open requests", () => {
    expect(createLibraryCoreSqliteQueryWorkerRequest("recovery-query", request)).toMatchObject({ kind: "query", query: request });
    expect(parseLibraryCoreSqliteQueryResponse(response, request)).toEqual(response);
    for (const invalid of [{ ...request, limit: 65 }, { ...request, sql: "SELECT 1" }, { ...request, recoveryId: "foreign" }, { ...request, cursor: "x".repeat(513) }]) {
      expect(parseLibraryCoreRecoveryIntentPageRequestV1(invalid).ok).toBe(false);
    }
    const maximumRows = Array.from({ length: 64 }, (_, ordinal) => ({
      ordinal, transactionId: "\u0001".repeat(252) + String(ordinal).padStart(3, "0"),
    }));
    expect(parseLibraryCoreRecoveryIntentPageResponseV1({ ...response, rows: maximumRows, nextCursor: null }, { ...request, limit: 64 }).ok).toBe(true);
    expect(parseLibraryCoreRecoveryIntentPageRequestV1({ ...request, cursor }).ok).toBe(true);
    expect(parseLibraryCoreRecoveryIntentPageRequestV1({ ...request, recoveryId: "d".repeat(64), cursor }).ok).toBe(false);
  });
  it("binds continuation to the archive, generation, revision and last ordinal", () => {
    const continuation = { ...request, cursor };
    const final = { ...response, rows: [{ ordinal: 2, transactionId: "third" }], nextCursor: null };
    expect(parseLibraryCoreRecoveryIntentPageResponseV1(final, continuation).ok).toBe(true);
    for (const invalid of [
      { ...final, archiveDigest: "d".repeat(64) },
      { ...final, source: { ...source, generationId: "e".repeat(64) } },
      { ...final, source: { ...source, projectionRevision: 8, transitionSequence: 8 } },
      { ...final, rows: [{ ordinal: 1, transactionId: "second" }] },
      { ...response, rows: [response.rows[1], response.rows[0]] },
      { ...response, rows: [{ ordinal: 0, transactionId: "first" }, { ordinal: 1, transactionId: "first" }] },
      { ...response, rows: [{ ordinal: 0, transactionId: "x".repeat(256) }] },
      { ...response, rows: [{ ordinal: 0, transactionId: "first", accepted: true }] },
      { ...final, nextCursor: cursor },
    ]) expect(parseLibraryCoreRecoveryIntentPageResponseV1(invalid, continuation).ok).toBe(false);
  });
});


describe("verified recovery review contract", () => {
  const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
  const selected = { ...request, queryId: "recovery_intent_review_v1" as const, transactionId: "selected-edit", limit: 1 };
  const transactionDigest = "d".repeat(64);
  const reviewCursor = encodeLibraryCoreFeedPageCursorV1({ ...source, generationId: source.generationId as never,
    sortAt: 0, globalId: `recovery_intent_review_v1:${request.recoveryId}:${archiveDigest}:${transactionDigest}` as never });
  const review = { queryId: selected.queryId, schemaVersion: 1, recoveryId: selected.recoveryId,
    archiveDigest, transactionId: selected.transactionId, transactionDigest, memberCount: 2,
    outcome: { state: "confirmed_accepted", committed_revision: 7 }, replacement: null, source, nextCursor: reviewCursor,
    rows: [{ personState: null, rssFeedState: null, originalEnvelopeJson: null, authorName: "Author", itemPresent: true, itemState: "present", itemText: "Current item text", assigned: true, assignedAt: 100, readAt: null, createdAt: 100, entityId: "item-1", memberIndex: 0, operationType: "feed_item_saved_assignment" }],
  };
  it("registers proof-backed review without accepting caller evidence or changed members", () => {
    expect(createLibraryCoreSqliteQueryWorkerRequest("review-query", selected)).toMatchObject({ kind: "query", query: selected });
    expect(parseLibraryCoreSqliteQueryResponse(review, selected)).toEqual(review);
    for (const bad of [{ ...selected, outcome: review.outcome }, { ...selected, limit: 17 }, { ...selected, cursor }])
      expect(parseLibraryCoreRecoveryIntentReviewRequestV1(bad).ok).toBe(false);
    for (const bad of [
      { ...review, transactionId: "other" }, { ...review, memberCount: 1001 },
      { ...review, outcome: { state: "confirmed_accepted", committed_revision: 8 } },
      { ...review, outcome: { state: "unresolved", accepted: true } },
      { ...review, rows: [{ ...review.rows[0], assigned: null }] },
      { ...review, rows: [{ ...review.rows[0], memberIndex: 1 }] },
      { ...review, rows: [{ ...review.rows[0], assigned: 1 }] },
      { ...review, nextCursor: null },
    ]) expect(parseLibraryCoreRecoveryIntentReviewResponseV1(bad, selected).ok).toBe(false);
    const next = { ...selected, cursor: reviewCursor };
    expect(parseLibraryCoreRecoveryIntentReviewRequestV1(next).ok).toBe(true);
    expect(createLibraryCoreSqliteQueryWorkerRequest("review-next", next)).toMatchObject({ query: next });
    const final = { ...review, rows: [{ ...review.rows[0], memberIndex: 1 }], nextCursor: null };
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1(final, next).ok).toBe(true);
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...final, source: { ...source, transitionSequence: 10 } }, next).ok).toBe(false);
    const editorRequest = { ...selected, includeOriginal: true, limit: 16 };
    // Transport binding fixture; signature verification is exercised natively.
    const envelope = { schema_version: 1, transaction_id: selected.transactionId, transaction_digest: transactionDigest,
      transaction_member_index: 0, transaction_member_count: 2, operation_type: review.rows[0].operationType,
      entity_type: "FeedItem", entity_id: review.rows[0].entityId, payload: { assigned: true, assigned_at_ms: 100 }, blob_references: [] };
    const originalEnvelopeJson = new TextDecoder().decode(encodeLibraryCoreCanonicalValue(envelope));
    const editorCursor = encodeLibraryCoreFeedPageCursorV1({ ...source, generationId: source.generationId as never,
      sortAt: 0, globalId: `recovery_intent_review_v1:${selected.recoveryId}:${archiveDigest}:${transactionDigest}:original` as never });
    const editorPage = { ...review, rows: [{ ...review.rows[0], originalEnvelopeJson }], nextCursor: editorCursor };
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1(editorPage, editorRequest).ok).toBe(true);
    expect(parseLibraryCoreRecoveryIntentReviewRequestV1({ ...editorRequest, cursor: editorCursor }).ok).toBe(true);
    expect(parseLibraryCoreRecoveryIntentReviewRequestV1({ ...editorRequest, cursor: reviewCursor }).ok).toBe(false);
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1(editorPage, selected).ok).toBe(false);
    for (const raw of [null, "{bad", originalEnvelopeJson.replace("item-1", "item-x")])
      expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...editorPage, rows: [{ ...review.rows[0], personState: null, rssFeedState: null, originalEnvelopeJson: raw }] }, editorRequest).ok).toBe(false);
    const replacement = { schemaVersion: 1, recoveryId: selected.recoveryId, originalTransactionId: selected.transactionId,
      replacementTransactionId: "recovery:replacement", replacementTransactionDigest: "e".repeat(64),
      replacementEpochId: "f".repeat(64), replacementActorId: "1".repeat(64), firstCounter: 4, lastCounter: 5,
      memberCount: 2, createdAt: 900 };
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...final, replacement }, next).ok).toBe(true);
    for (const bad of [{ ...replacement, originalTransactionId: "wrong" }, { ...replacement, memberCount: 1 },
      { ...replacement, accepted: true }, { ...replacement, lastCounter: 6 }, { ...replacement, createdAt: -1 },
      { ...replacement, replacementEpochId: "wrong" }, { ...replacement, replacementTransactionId: selected.transactionId }]) {
      expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...final, replacement: bad }, next).ok).toBe(false);
    }

    expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...final, transactionDigest: "e".repeat(64) }, next).ok).toBe(false);
    expect(parseLibraryCoreRecoveryIntentReviewResponseV1({ ...final, outcome: { state: "reported_rejected", reason: "epoch_stale", result_digest: "e".repeat(64) } }, next).ok).toBe(false);
  });
});

it("discovers archives with closed ordered pages and handoff-bound continuations", async () => {
  const { parseLibraryCoreRecoveryArchivePageResponseV1: parse, parseLibraryCoreRecoveryArchivePageRequestV1: parseRequest } = await import("./recovery-intent-page-contracts.js");
  const req = { queryId: "recovery_archive_page_v1" as const, schemaVersion: 1 as const,
    cancellationId: "archive-cancel", readerSessionId: "archive-reader", cursor: null, limit: 1 };
  const handoffId = "d".repeat(64);
  const row = { recoveryId: "b".repeat(64), predecessorEpochId: "e".repeat(64), successorEpochId: "f".repeat(64), pendingEdits: 2, publishedEdits: 1, createdAt: 7 };
  const token = encodeLibraryCoreFeedPageCursorV1({ ...source, generationId: source.generationId as never,
    sortAt: 0, globalId: `recovery_archive_page_v1:${handoffId}:${row.recoveryId}` as never });
  const result = { queryId: req.queryId, schemaVersion: 1, handoffId, source, rows: [row], nextCursor: token };
  expect(createLibraryCoreSqliteQueryWorkerRequest("archive-request", req)).toMatchObject({ query: req });
  expect(parseLibraryCoreSqliteQueryResponse(result, req)).toEqual(result);
  for (const invalid of [{ ...req, limit: 65 }, { ...req, sql: "SELECT 1" }, { ...req, cursor }]) expect(parseRequest(invalid).ok).toBe(false);
  expect(parse({ ...result, handoffId: "0".repeat(64) }, { ...req, cursor: token }).ok).toBe(false);
  expect(parse(result, { ...req, cursor: token }).ok).toBe(false);
  expect(parse({ ...result, rows: [{ ...row, recoveryId: "c".repeat(64) }], nextCursor: null }, { ...req, cursor: token }).ok).toBe(true);
  for (const rows of [[{ ...row, pendingEdits: -1 }], [{ ...row, recoveryId: "X".repeat(64) }], [{ ...row, accepted: true }], [row, row]])
    expect(parse({ ...result, rows }, req).ok).toBe(false);
});
