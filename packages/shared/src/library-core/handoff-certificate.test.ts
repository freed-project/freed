import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import chain from "./handoff-chain-vectors-v1.json";
import vector from "./handoff-certificate-vectors-v1.json";
import { verifyLibraryCoreHandoffCertificateV1, verifyLibraryCoreHandoffChainReadsV1, verifyLibraryCoreHandoffPredecessorCheckpointV1, parseLibraryCorePredecessorCheckpointReadV1, parseLibraryCorePredecessorCheckpointReadsV1 } from "./handoff-certificate.js";
import { verifyLibraryCoreEd25519WithWebCrypto } from "./ed25519-verification.js";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";

const bytes = () => new TextEncoder().encode(vector.canonicalCertificate);
const verifySignature = (input: Parameters<typeof verifyLibraryCoreEd25519WithWebCrypto>[0]) =>
  verifyLibraryCoreEd25519WithWebCrypto(input, webcrypto.subtle as unknown as SubtleCrypto);
const verify = (input: Uint8Array = bytes(), pin = vector.predecessor, actor = vector.enrolledActorPublicKey) =>
  verifyLibraryCoreHandoffCertificateV1(input, pin, actor, { verifySignature });

describe("native cooperative successor certificate parity", () => {
  it("verifies native-produced bytes with platform Ed25519 and matches both epoch digests", async () => {
    const signature = vi.fn(verifySignature);
    const result = await verifyLibraryCoreHandoffCertificateV1(bytes(), vector.predecessor,
      vector.enrolledActorPublicKey, { verifySignature: signature });
    expect(result).toMatchObject(vector.expected);
    expect(result.epoch).toBe(vector.predecessor.epoch + 1);
    expect(signature).toHaveBeenCalledTimes(5);
    expect(result.canonicalBytes).toEqual(bytes());
  });

  it("authenticates a bounded predecessor read without granting target enrollment", async () => {
    const original = bytes();
    const pin = { ...vector.predecessor };
    const pending = verifyLibraryCoreHandoffPredecessorCheckpointV1(original, pin, { verifySignature });
    original.fill(0);
    pin.authorityPublicKey = "0".repeat(64);
    const result = await pending;
    const grant = JSON.parse(vector.canonicalCertificate).certificate_body.handoff_authorization;
    expect(result).toEqual({ purpose: "predecessor_checkpoint_read", pointer: grant.body.source_control,
      controlRevision: grant.body.source_control_revision, controlFileId: grant.body.source_control_file_id,
      checkpointDigest: grant.body.final_checkpoint_digest, sourceRevision: grant.body.final_source_revision,
      successorEpochId: vector.expected.epochId, authorizationDigest: grant.authorization_digest });
    expect(Object.isFrozen(result.pointer.manifest.descriptor)).toBe(true);
    expect(parseLibraryCorePredecessorCheckpointReadV1(null)).toBeNull();
    const transported = JSON.parse(JSON.stringify(result));
    const parsed = parseLibraryCorePredecessorCheckpointReadV1(transported);
    expect(parsed).toEqual(result);
    transported.pointer.manifest.transportObjectId = "changed";
    expect(parsed).toEqual(result);
    for (const change of [{ proof: {} }, { purpose: "activate" }, { sourceRevision: -1 },
      { checkpointDigest: "wrong" }, { controlFileId: "x".repeat(1025) }, { controlRevision: "unquoted" }]) {
      expect(() => parseLibraryCorePredecessorCheckpointReadV1({ ...result, ...change })).toThrow();
    }

    await expect(verifyLibraryCoreHandoffPredecessorCheckpointV1(bytes(), vector.predecessor,
      { verifySignature: () => false })).rejects.toThrow("signature is invalid");
    await expect(verifyLibraryCoreHandoffPredecessorCheckpointV1(bytes(),
      { ...vector.predecessor, epochId: "0".repeat(64) }, { verifySignature })).rejects.toThrow();
    // Read authentication cannot replace ordinary locally pinned enrollment.
    await expect(verify(bytes(), vector.predecessor, "0".repeat(64))).rejects.toThrow();
  });

  it("verifies both native return-transfer certificates against the preceding verified authority", async () => {
    const first = await verifyLibraryCoreHandoffCertificateV1(new TextEncoder().encode(chain[0]!.canonicalCertificate),
      chain[0]!.predecessor, chain[0]!.enrolledActorPublicKey, { verifySignature });
    const previous = { libraryId: first.libraryId, epochId: first.epochId, epoch: first.epoch,
      certificateDigest: first.certificateDigest, authorityPublicKey: first.authorityPublicKey, writerId: first.writerId };
    expect(previous).toEqual(chain[1]!.predecessor);
    const second = await verifyLibraryCoreHandoffCertificateV1(new TextEncoder().encode(chain[1]!.canonicalCertificate),
      previous, chain[1]!.enrolledActorPublicKey, { verifySignature });
    expect(second).toMatchObject(chain[1]!.expected);
    expect(second.epoch).toBe(first.epoch + 1);
    await expect(verifyLibraryCoreHandoffCertificateV1(new TextEncoder().encode(chain[1]!.canonicalCertificate),
      chain[0]!.predecessor, chain[1]!.enrolledActorPublicKey, { verifySignature })).rejects.toThrow();
  });

  it("authenticates a complete missed-transfer read chain without accepting a gap or mutable later input", async () => {
    const inputs = chain.map(entry => new TextEncoder().encode(entry.canonicalCertificate));
    const original = inputs.map(bytes => bytes.slice());
    const pin = { ...chain[0]!.predecessor };
    const signatures = vi.fn(verifySignature);
    const pending = verifyLibraryCoreHandoffChainReadsV1(inputs, pin, chain[1]!.expected.epochId,
      { verifySignature: signatures });
    inputs[1]!.fill(0);
    pin.authorityPublicKey = "0".repeat(64);
    const { references, successor } = await pending;
    expect(successor).toMatchObject(chain[1]!.expected);
    expect(signatures).toHaveBeenCalledTimes(10);
    expect(references).toEqual(chain.map(entry => {
      const grant = JSON.parse(entry.canonicalCertificate).certificate_body.handoff_authorization;
      return { purpose: "predecessor_checkpoint_read", pointer: grant.body.source_control,
        controlRevision: grant.body.source_control_revision, controlFileId: grant.body.source_control_file_id,
        checkpointDigest: grant.body.final_checkpoint_digest, sourceRevision: grant.body.final_source_revision,
        successorEpochId: entry.expected.epochId, authorizationDigest: grant.authorization_digest };
    }));
    expect(Object.isFrozen(references)).toBe(true);
    expect(parseLibraryCorePredecessorCheckpointReadsV1(references)).toEqual(references);
    expect(parseLibraryCorePredecessorCheckpointReadsV1(references[0])).toEqual([references[0]]);
    expect(parseLibraryCorePredecessorCheckpointReadsV1(null)).toBeNull();
    expect(() => parseLibraryCorePredecessorCheckpointReadsV1([...references].reverse())).toThrow();
    expect(() => parseLibraryCorePredecessorCheckpointReadsV1([references[0], references[0]])).toThrow();
    expect(() => parseLibraryCorePredecessorCheckpointReadsV1(Array(33).fill(references[0]))).toThrow();
    expect(() => parseLibraryCorePredecessorCheckpointReadsV1([null])).toThrow();
    expect(() => parseLibraryCorePredecessorCheckpointReadsV1(new Array(2))).toThrow();
    await expect(verifyLibraryCoreHandoffChainReadsV1([original[1]!], chain[0]!.predecessor,
      chain[1]!.expected.epochId, { verifySignature })).rejects.toThrow();
    await expect(verifyLibraryCoreHandoffChainReadsV1([original[0]!], chain[0]!.predecessor,
      chain[1]!.expected.epochId, { verifySignature })).rejects.toThrow();
    await expect(verifyLibraryCoreHandoffChainReadsV1(original, chain[0]!.predecessor,
      chain[1]!.expected.epochId, { verifySignature: () => false })).rejects.toThrow();
    signatures.mockClear();
    await expect(verifyLibraryCoreHandoffChainReadsV1(Array(33).fill(original[0]), chain[0]!.predecessor,
      chain[1]!.expected.epochId, { verifySignature: signatures })).rejects.toThrow();
    expect(signatures).not.toHaveBeenCalled();
  });

  it.each(["libraryId", "epochId", "certificateDigest", "authorityPublicKey", "writerId"] as const)("pins trusted predecessor %s", async key => {
    await expect(verify(bytes(), { ...vector.predecessor, [key]: "0".repeat(64) })).rejects.toThrow();
  });

  it("refuses skipped epochs and an unrecognized target enrollment", async () => {
    await expect(verify(bytes(), { ...vector.predecessor, epoch: 2 })).rejects.toThrow();
    await expect(verify(bytes(), vector.predecessor, "0".repeat(64))).rejects.toThrow();
  });

  it.each([
    ["certificate_body", "extra"],
    ["certificate_body", "handoff_authorization", "extra"],
    ["certificate_body", "handoff_authorization", "body", "extra"],
    ["certificate_body", "handoff_authorization", "body", "readiness", "extra"],
    ["certificate_body", "handoff_authorization", "body", "readiness", "body", "extra"],
    ["certificate_body", "handoff_authorization", "body", "source_control", "extra"],
    ["certificate_body", "handoff_authorization", "body", "source_control", "manifest", "extra"],
    ["certificate_body", "handoff_authorization", "body", "source_control", "manifest", "descriptor", "extra"],
  ])("rejects unknown nested fields at %j", async (...path) => {
    const value = JSON.parse(vector.canonicalCertificate);
    let target = value;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)!] = true;
    await expect(verify(encodeLibraryCoreCanonicalValue(value))).rejects.toThrow(/fields/);
  });

  it("rejects unsupported compatibility, noncanonical and oversized data before crypto", async () => {
    const value = JSON.parse(vector.canonicalCertificate);
    value.certificate_body.handoff_authorization.body.readiness.body.native_storage_version = 3;
    const signature = vi.fn(verifySignature);
    await expect(verifyLibraryCoreHandoffCertificateV1(encodeLibraryCoreCanonicalValue(value), vector.predecessor,
      vector.enrolledActorPublicKey, { verifySignature: signature })).rejects.toThrow();
    expect(signature).not.toHaveBeenCalled();
    await expect(verify(new TextEncoder().encode(JSON.stringify(JSON.parse(vector.canonicalCertificate), null, 2)))).rejects.toThrow();
    await expect(verify(new Uint8Array(16_385))).rejects.toThrow(/bound/);
  });

  it.each(["source_control_revision", "source_control_file_id"])("rejects trailing newlines in %s", async field => {
    const value = JSON.parse(vector.canonicalCertificate);
    value.certificate_body.handoff_authorization.body[field] += "\n";
    const signature = vi.fn(verifySignature);
    await expect(verifyLibraryCoreHandoffCertificateV1(encodeLibraryCoreCanonicalValue(value), vector.predecessor,
      vector.enrolledActorPublicKey, { verifySignature: signature })).rejects.toThrow();
    expect(signature).not.toHaveBeenCalled();
  });

  it.each(["epoch_signature", "authority_key_possession_signature"])("checks successor %s", async field => {
    const value = JSON.parse(vector.canonicalCertificate);
    value[field] = "00".repeat(64);
    await expect(verify(encodeLibraryCoreCanonicalValue(value))).rejects.toThrow(/signature/);
  });

  it.each([0, 1, 2, 3, 4])("requires signature verification step %i", async failedIndex => {
    let index = 0;
    await expect(verifyLibraryCoreHandoffCertificateV1(bytes(), vector.predecessor, vector.enrolledActorPublicKey, {
      verifySignature: input => index++ === failedIndex ? false : verifySignature(input),
    })).rejects.toThrow(/signature/);
  });

  it("snapshots caller bytes and predecessor before asynchronous verification", async () => {
    const input = bytes(), pin = { ...vector.predecessor };
    let mutated = false;
    const result = await verifyLibraryCoreHandoffCertificateV1(input, pin, vector.enrolledActorPublicKey, {
      async verifySignature(signature) {
        if (!mutated) { input.fill(0); pin.epochId = "0".repeat(64); mutated = true; }
        return verifySignature(signature);
      },
    });
    expect(result).toMatchObject(vector.expected);
    expect(result.canonicalBytes).toEqual(bytes());
  });
});
