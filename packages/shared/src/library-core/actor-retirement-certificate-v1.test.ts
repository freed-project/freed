import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signEd25519,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorRetirementCertificateV1,
  isLibraryCoreVerifiedActorRetirementCertificateV1,
  verifyLibraryCoreActorRetirementCertificateV1,
  type LibraryCoreActorRetirementAuthorityV1,
  type LibraryCoreActorRetirementTargetV1,
} from "./actor-retirement-certificate-v1.js";
import { verifyLibraryCoreEd25519WithWebCrypto } from "./ed25519-verification.js";

const AUTHORITY_SEED =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function authorityPrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_SEED_PREFIX,
      Buffer.from(AUTHORITY_SEED, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

function authorityPublicKeyHex(): string {
  const bytes = createPublicKey(authorityPrivateKey()).export({
    format: "der",
    type: "spki",
  });
  return bytes.subarray(bytes.byteLength - 32).toString("hex");
}

function digest(domain: LibraryCoreDigestDomain, value: unknown): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
    )
    .digest("hex");
}

function authority(): LibraryCoreActorRetirementAuthorityV1 {
  const authorityPublicKey = authorityPublicKeyHex();
  return {
    library_id: "11".repeat(32),
    epoch: 1,
    epoch_id: "22".repeat(32),
    authority_key_id: digest("authority-key", {
      signature_algorithm: "ed25519",
      authority_public_key: authorityPublicKey,
    }),
    authority_public_key: authorityPublicKey,
  } as LibraryCoreActorRetirementAuthorityV1;
}

async function certificate() {
  return constructLibraryCoreActorRetirementCertificateV1(
    authority(),
    {
      actor_id: "33".repeat(32),
      capability_id: "44".repeat(32),
      capability_certificate_digest: "44".repeat(32),
      retirement_identity: "55".repeat(32),
    } as LibraryCoreActorRetirementTargetV1,
    "device_removed",
    1_234,
    {
      digest,
      async signAuthority(message) {
        return signEd25519(null, message, authorityPrivateKey()).toString(
          "hex",
        );
      },
    },
  );
}

describe("Library Core actor retirement certificate v1", () => {
  it("constructs and verifies one closed authority-signed retirement", async () => {
    const created = await certificate();
    const verified = await verifyLibraryCoreActorRetirementCertificateV1(
      encodeLibraryCoreCanonicalValue(created as never),
      authority(),
      { digest, verifySignature: verifyLibraryCoreEd25519WithWebCrypto },
    );
    expect(isLibraryCoreVerifiedActorRetirementCertificateV1(verified)).toBe(
      true,
    );
    expect(verified.certificate.retirement_body).toStrictEqual({
      format: "freed_library_core_actor_retirement_v1",
      library_id: "11".repeat(32),
      epoch: 1,
      epoch_id: "22".repeat(32),
      authority_key_id: authority().authority_key_id,
      actor_id: "33".repeat(32),
      capability_id: "44".repeat(32),
      capability_certificate_digest: "44".repeat(32),
      retirement_identity: "55".repeat(32),
      reason: "device_removed",
      retired_at_ms: 1_234,
      signature_algorithm: "ed25519",
    });
  });

  it("rejects changed reason bytes before signature verification", async () => {
    const created = await certificate();
    const decoded = decodeLibraryCoreCanonicalValue(
      encodeLibraryCoreCanonicalValue(created as never),
    ) as Record<string, unknown>;
    const body = decoded.retirement_body as Record<string, unknown>;
    const verifySignature = vi.fn(async () => true);
    await expect(
      verifyLibraryCoreActorRetirementCertificateV1(
        encodeLibraryCoreCanonicalValue({
          ...decoded,
          retirement_body: { ...body, reason: "key_compromised" },
        } as never),
        authority(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/body digest changed/);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("rejects a foreign accepted authority before the signature check", async () => {
    const created = await certificate();
    const foreign = {
      ...authority(),
      library_id: "66".repeat(32),
    } as LibraryCoreActorRetirementAuthorityV1;
    const verifySignature = vi.fn(async () => true);
    await expect(
      verifyLibraryCoreActorRetirementCertificateV1(
        encodeLibraryCoreCanonicalValue(created as never),
        foreign,
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/body changed/);
    expect(verifySignature).not.toHaveBeenCalled();
  });
});
