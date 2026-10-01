import { describe, expect, it } from "vitest";
import { parseLibraryCoreConsumerRecoveryStatusV1, parseLibraryCoreReapplyConsumerIntentV1 } from "./consumer-recovery-contracts.js";
import { createLibraryCoreConsumerRecoveryWorkerRequest, parseLibraryCoreSqliteWorkerRequest } from "./sqlite-worker-protocol.js";
const id = "1".repeat(64), epoch = "2".repeat(64);
const plan = { recoveryId: id, oldActorId: id, actorPublicKey: id, installationIncarnation: id,
  predecessorEpochId: id, authority: { authority_key_id: id, authority_public_key: id, epoch: 2,
    epoch_id: epoch, library_id: id, observed_frontier: [] }, preparedRequest: null };
describe("closed consumer recovery worker boundary", () => {
  it("closes all three commands and snapshots their bounded signed input", () => {
    const bytes = Uint8Array.of(123, 125);
    const prepared = createLibraryCoreConsumerRecoveryWorkerRequest("prepare", {
      kind: "prepare_consumer_recovery", recovery: { recoveryId: id as never, request: { canonicalRequestBytes: bytes, createdAt: 1 } },
    });
    bytes[0] = 0;
    expect(prepared).toMatchObject({ recovery: { request: { canonicalRequestBytes: Uint8Array.of(123, 125) } } });
    for (const input of [prepared,
      createLibraryCoreConsumerRecoveryWorkerRequest("read", { kind: "read_consumer_recovery" }),
      createLibraryCoreConsumerRecoveryWorkerRequest("commit", { kind: "commit_consumer_recovery", recovery: { recoveryId: id as never, committedAt: 2 } }),
    ]) {
      expect(parseLibraryCoreSqliteWorkerRequest(input)).toEqual(input);
      expect(() => parseLibraryCoreSqliteWorkerRequest({ ...input, extra: true })).toThrow();
    }
    expect(() => parseLibraryCoreSqliteWorkerRequest({ ...prepared, recovery: { recoveryId: id, request: { canonicalRequestBytes: new Uint8Array(65_537), createdAt: 1 } } })).toThrow();
    expect(() => createLibraryCoreConsumerRecoveryWorkerRequest("commit", { kind: "commit_consumer_recovery", recovery: { recoveryId: id as never, committedAt: -1 } })).toThrow();
  });
  it("rejects contradictory state and keeps prepared bytes immutable across the boundary", () => {
    expect(parseLibraryCoreConsumerRecoveryStatusV1({ state: "none" })).toEqual({ state: "none" });
    const required = { state: "required", plan, pendingIntentCount: 1, publishedIntentCount: 2 };
    expect(parseLibraryCoreConsumerRecoveryStatusV1(required)).toEqual(required);
    expect(() => parseLibraryCoreConsumerRecoveryStatusV1({ ...required, state: "following" })).toThrow();
    expect(() => parseLibraryCoreConsumerRecoveryStatusV1({ ...required, pendingIntentCount: -1 })).toThrow();
    expect(() => parseLibraryCoreConsumerRecoveryStatusV1({ ...required, plan: { ...plan, predecessorEpochId: epoch } })).toThrow();
    expect(() => parseLibraryCoreConsumerRecoveryStatusV1({ state: "none", plan })).toThrow();
    const bytes = Uint8Array.of(123, 125);
    const status = parseLibraryCoreConsumerRecoveryStatusV1({ ...required, state: "prepared", plan: { ...plan, preparedRequest: { canonicalRequestBytes: bytes, createdAt: 3 } } });
    bytes[0] = 0;
    expect(status).toMatchObject({ plan: { preparedRequest: { canonicalRequestBytes: Uint8Array.of(123, 125) } } });
  });
  it("closes reapplication pins and snapshots replacement envelopes without inferring approval", () => {
    const bytes = Uint8Array.of(123, 125);
    const input = { review: { schemaVersion: 1, recoveryId: id, archiveDigest: id, transactionId: "original-edit", transactionDigest: id,
      reviewedGenerationId: id, reviewedRevision: 8, reviewedLocalSequence: 2, memberCount: 1 }, intent: { envelopeBytes: [bytes] } };
    const parsed = parseLibraryCoreReapplyConsumerIntentV1(input);
    const command = createLibraryCoreConsumerRecoveryWorkerRequest("reapply", { kind: "reapply_consumer_intent", recovery: parsed });
    bytes[0] = 0;
    expect(parsed.intent.envelopeBytes[0]).toEqual(Uint8Array.of(123, 125));
    expect(parseLibraryCoreSqliteWorkerRequest(command)).toEqual(command);
    for (const invalid of [{ ...input, extra: true }, { ...input, review: { ...input.review, memberCount: 1001 } },
      { ...input, review: { ...input.review, reviewedRevision: -1 } }, { ...input, review: { ...input.review, approved: true } },
      { ...input, intent: { envelopeBytes: [] } }, { ...input, intent: { envelopeBytes: [new Uint8Array(131073)] } }]) {
      expect(() => parseLibraryCoreReapplyConsumerIntentV1(invalid)).toThrow();
    }
    expect(() => parseLibraryCoreReapplyConsumerIntentV1(Object.defineProperty({ ...input }, "review", { get() { throw new Error("getter executed"); } }))).toThrow(/fields are invalid/);
    expect(() => parseLibraryCoreSqliteWorkerRequest({ ...command, sql: "DELETE" })).toThrow();
  });

});
