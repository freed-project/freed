import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import chain from "./handoff-chain-vectors-v1.json";
import vector from "./handoff-certificate-vectors-v1.json";
import { verifyLibraryCoreHandoffCertificateV1 } from "./handoff-certificate.js";
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
