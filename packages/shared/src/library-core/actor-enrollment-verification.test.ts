import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorEnrollmentBodyV1,
  type LibraryCoreActorEnrollmentBodyInputV1,
} from "./actor-enrollment-contracts.js";
import { constructLibraryCoreActorEnrollmentCertificateV1 } from "./actor-enrollment-certificate.js";
import {
  isLibraryCoreVerifiedActorEnrollmentCertificateV1,
  verifyLibraryCoreActorEnrollmentCertificateV1,
} from "./actor-enrollment-verification.js";
import type { LibraryCoreConstructionDigestDomain } from "./operation-envelope-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  installation: "33".repeat(32),
  nonce: "44".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  actorProof: "55".repeat(64),
  authoritySignature: "66".repeat(64),
} as const;

function digest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(
        domain as LibraryCoreDigestDomain,
        value as LibraryCoreCanonicalValue,
      ),
    )
    .digest("hex");
}

function authorityKeyId(): string {
  return digest("authority-key", {
    signature_algorithm: "ed25519",
    authority_public_key: HEX.publicKey,
  });
}

function bodyInput(): LibraryCoreActorEnrollmentBodyInputV1 {
  return {
    operation_id: "op:actor-enrollment:verification:1",
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    authority_key_id: authorityKeyId(),
    installation_incarnation: HEX.installation,
    actor_incarnation_nonce: HEX.nonce,
    actor_public_key: HEX.publicKey,
    observed_frontier: [],
    created_at_ms: 1_000,
  };
}

async function certificateFixture() {
  const body = constructLibraryCoreActorEnrollmentBodyV1(bodyInput(), {
    digest(domain: LibraryCoreConstructionDigestDomain, value: unknown) {
      return digest(domain, value);
    },
  });
  return constructLibraryCoreActorEnrollmentCertificateV1(body, {
    async signActorProof() {
      return HEX.actorProof;
    },
    async signAuthorityCertificate() {
      return HEX.authoritySignature;
    },
    digest,
  });
}

function authorityState(): Record<string, unknown> {
  return {
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    authority_key_id: authorityKeyId(),
    authority_public_key: HEX.publicKey,
    observed_frontier: [],
  };
}

describe("Library Core actor enrollment verification", () => {
  it("verifies canonical body derivation, actor proof, authority signature, and chain genesis in order", async () => {
    const fixture = await certificateFixture();
    const certificateBytes = encodeLibraryCoreCanonicalValue(
      fixture.certificate as never,
    );
    const messages: string[] = [];
    const result = await verifyLibraryCoreActorEnrollmentCertificateV1(
      certificateBytes,
      authorityState(),
      {
        digest,
        async verifySignature(input) {
          messages.push(new TextDecoder().decode(input.message));
          return true;
        },
      },
    );

    expect(messages).toStrictEqual([
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/actor-enrollment-proof\u0000/,
      ),
      expect.stringMatching(
        /^freed\.library-core\.v1\/signature\/actor-enrollment-authority\u0000/,
      ),
    ]);
    expect(result.actor_chain_genesis).toBe(fixture.actor_chain_genesis);
    expect(
      encodeLibraryCoreCanonicalValue(result.certificate as never),
    ).toEqual(certificateBytes);
    expect(isLibraryCoreVerifiedActorEnrollmentCertificateV1(result)).toBe(
      true,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.certificate)).toBe(true);
    expect(Object.isFrozen(result.authority_state)).toBe(true);
    expect(Object.getOwnPropertySymbols(result)).toStrictEqual([]);
    expect(
      isLibraryCoreVerifiedActorEnrollmentCertificateV1(
        Object.freeze({ ...result }),
      ),
    ).toBe(false);
    expect(
      isLibraryCoreVerifiedActorEnrollmentCertificateV1(
        Object.freeze(Object.create(result)),
      ),
    ).toBe(false);
  });

  it("rejects noncanonical bytes, derived-body tampering, and authority-state mismatch before signature verification", async () => {
    const fixture = await certificateFixture();
    const verifySignature = vi.fn(async () => true);
    const noncanonical = new TextEncoder().encode(
      JSON.stringify(fixture.certificate),
    );
    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        noncanonical,
        authorityState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/not RFC 8785 canonical/);

    const decoded = decodeLibraryCoreCanonicalValue(
      encodeLibraryCoreCanonicalValue(fixture.certificate as never),
    ) as Record<string, unknown>;
    const certificateBody = decoded.certificate_body as Record<string, unknown>;
    const actorBody = certificateBody.actor_enrollment_body as Record<
      string,
      unknown
    >;
    const tampered = {
      ...decoded,
      certificate_body: {
        ...certificateBody,
        actor_enrollment_body: {
          ...actorBody,
          actor_id: "77".repeat(32),
        },
      },
    };
    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        encodeLibraryCoreCanonicalValue(tampered as never),
        authorityState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/derived canonical value/);

    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        encodeLibraryCoreCanonicalValue(fixture.certificate as never),
        { ...authorityState(), epoch_id: "88".repeat(32) },
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/accepted authority state/);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("fails closed at the first invalid cryptographic proof", async () => {
    const fixture = await certificateFixture();
    const certificateBytes = encodeLibraryCoreCanonicalValue(
      fixture.certificate as never,
    );
    const digestDomains: string[] = [];
    const verifySignature = vi.fn(async (): Promise<boolean> => false);
    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        certificateBytes,
        authorityState(),
        {
          digest(domain, value) {
            digestDomains.push(domain);
            return digest(domain, value);
          },
          verifySignature,
        },
      ),
    ).rejects.toThrow(/proof signature/);
    expect(verifySignature).toHaveBeenCalledTimes(1);
    expect(digestDomains).not.toContain("actor-enrollment-certificate");

    verifySignature.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        certificateBytes,
        authorityState(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/authority signature/);
  });

  it("snapshots accepted authority descriptors without reading proxy values", async () => {
    const fixture = await certificateFixture();
    const source = authorityState();
    const proxiedAuthority = new Proxy(source, {
      get(_target, property) {
        throw new Error(`unexpected property read: ${String(property)}`);
      },
    });

    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        encodeLibraryCoreCanonicalValue(fixture.certificate as never),
        proxiedAuthority,
        { digest, verifySignature: async () => true },
      ),
    ).resolves.toMatchObject({
      actor_chain_genesis: fixture.actor_chain_genesis,
    });
  });

  it("uses verification capabilities captured before the first await", async () => {
    const fixture = await certificateFixture();
    let calls = 0;
    const dependencies = {
      digest,
      async verifySignature() {
        calls += 1;
        if (calls === 1) {
          dependencies.digest = () => {
            throw new Error("swapped digest");
          };
          dependencies.verifySignature = async () => {
            throw new Error("swapped verifier");
          };
        }
        return true;
      },
    };

    await expect(
      verifyLibraryCoreActorEnrollmentCertificateV1(
        encodeLibraryCoreCanonicalValue(fixture.certificate as never),
        authorityState(),
        dependencies,
      ),
    ).resolves.toMatchObject({
      actor_chain_genesis: fixture.actor_chain_genesis,
    });
    expect(calls).toBe(2);
  });
});
