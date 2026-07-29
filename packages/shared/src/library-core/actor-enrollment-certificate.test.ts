import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreOperationDigestDomain,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorEnrollmentBodyV1,
  type LibraryCoreActorEnrollmentBodyInputV1,
} from "./actor-enrollment-contracts.js";
import {
  constructLibraryCoreActorEnrollmentCertificateV1,
  isLibraryCoreActorEnrollmentCertificateConstructionV1,
} from "./actor-enrollment-certificate.js";
import type { LibraryCoreConstructionDigestDomain } from "./operation-envelope-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  authority: "33".repeat(32),
  installation: "44".repeat(32),
  nonce: "55".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  actorProof: "66".repeat(64),
  authoritySignature: "77".repeat(64),
} as const;

function digest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(
        domain as LibraryCoreOperationDigestDomain,
        value as LibraryCoreCanonicalValue,
      ),
    )
    .digest("hex");
}

function bodyInput(): LibraryCoreActorEnrollmentBodyInputV1 {
  return {
    operation_id: "op:actor-enrollment:certificate:1",
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    authority_key_id: HEX.authority,
    installation_incarnation: HEX.installation,
    actor_incarnation_nonce: HEX.nonce,
    actor_public_key: HEX.publicKey,
    observed_frontier: [],
    created_at_ms: 1_000,
  };
}

function bodyConstruction() {
  return constructLibraryCoreActorEnrollmentBodyV1(bodyInput(), {
    digest(domain: LibraryCoreConstructionDigestDomain, value: unknown) {
      return digest(domain, value);
    },
  });
}

describe("Library Core actor enrollment certificate construction", () => {
  it("signs exact proof and authority commitments before deriving chain genesis", async () => {
    const signerInputs: string[] = [];
    const result = await constructLibraryCoreActorEnrollmentCertificateV1(
      bodyConstruction(),
      {
        async signActorProof(input) {
          signerInputs.push(new TextDecoder().decode(input));
          return HEX.actorProof;
        },
        async signAuthorityCertificate(input) {
          signerInputs.push(new TextDecoder().decode(input));
          return HEX.authoritySignature;
        },
        digest,
      },
    );

    expect(signerInputs).toStrictEqual([
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/actor-enrollment-proof\u0000\{"enrollment_body_digest":"[0-9a-f]{64}"\}$/,
      ),
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/actor-enrollment-authority\u0000\{"certificate_digest":"[0-9a-f]{64}"\}$/,
      ),
    ]);
    expect(result.certificate.certificate_body.actor_proof).toBe(
      HEX.actorProof,
    );
    expect(result.certificate.authority_signature).toBe(HEX.authoritySignature);
    expect(result.certificate.certificate_digest).toBe(
      "5b9a72bbef9a4c41492048da8d1e572a74e1d0695d43b0c8ad16ac8d2de64edd",
    );
    expect(result.actor_chain_genesis).toBe(
      "6c17e2712643f3f0a57c1ae12b235ded5aa06025d44f0ec8ee11f2db752d168f",
    );
    expect(isLibraryCoreActorEnrollmentCertificateConstructionV1(result)).toBe(
      true,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.certificate)).toBe(true);
    expect(Object.isFrozen(result.certificate.certificate_body)).toBe(true);
  });

  it("rejects a body lookalike before invoking either signer", async () => {
    const genuine = bodyConstruction();
    const signActorProof = vi.fn(async () => HEX.actorProof);
    const signAuthorityCertificate = vi.fn(async () => HEX.authoritySignature);

    await expect(
      constructLibraryCoreActorEnrollmentCertificateV1(
        Object.freeze({ ...genuine }),
        {
          signActorProof,
          signAuthorityCertificate,
          digest,
        },
      ),
    ).rejects.toThrow(/closed construction contract/);
    expect(signActorProof).not.toHaveBeenCalled();
    expect(signAuthorityCertificate).not.toHaveBeenCalled();
  });

  it("fails without an authority call after an invalid actor proof or certificate digest", async () => {
    const signAuthorityCertificate = vi.fn(async () => HEX.authoritySignature);
    await expect(
      constructLibraryCoreActorEnrollmentCertificateV1(bodyConstruction(), {
        async signActorProof() {
          return "invalid";
        },
        signAuthorityCertificate,
        digest,
      }),
    ).rejects.toThrow(/actor proof/);
    expect(signAuthorityCertificate).not.toHaveBeenCalled();

    await expect(
      constructLibraryCoreActorEnrollmentCertificateV1(bodyConstruction(), {
        async signActorProof() {
          return HEX.actorProof;
        },
        signAuthorityCertificate,
        digest(domain, value) {
          return domain === "actor-enrollment-certificate"
            ? "invalid"
            : digest(domain, value);
        },
      }),
    ).rejects.toThrow(/invalid digest/);
    expect(signAuthorityCertificate).not.toHaveBeenCalled();
  });

  it("returns no result for an invalid authority signature or genesis digest", async () => {
    await expect(
      constructLibraryCoreActorEnrollmentCertificateV1(bodyConstruction(), {
        async signActorProof() {
          return HEX.actorProof;
        },
        async signAuthorityCertificate() {
          return "invalid";
        },
        digest,
      }),
    ).rejects.toThrow(/authority signature/);

    await expect(
      constructLibraryCoreActorEnrollmentCertificateV1(bodyConstruction(), {
        async signActorProof() {
          return HEX.actorProof;
        },
        async signAuthorityCertificate() {
          return HEX.authoritySignature;
        },
        digest(domain, value) {
          return domain === "actor-chain-genesis"
            ? "invalid"
            : digest(domain, value);
        },
      }),
    ).rejects.toThrow(/invalid digest/);
  });
});
