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
import { constructLibraryCoreActorEnrollmentBodyV1 } from "./actor-enrollment-contracts.js";
import capabilityVectors from "./actor-capability-certificate-v2-vectors.json" with { type: "json" };
import {
  constructLibraryCoreActorCapabilityCertificateV2,
  constructLibraryCoreActorCapabilityRequestV2,
  isLibraryCoreActorCapabilityCertificateConstructionV2,
  isLibraryCoreActorCapabilityRequestConstructionV2,
  isLibraryCoreVerifiedActorCapabilityCertificateV2,
  LIBRARY_CORE_ACTOR_CAPABILITY_OPERATION_TYPES_V2,
  LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2,
  type LibraryCoreActorCapabilityAuthorityStateV2,
  verifyLibraryCoreActorCapabilityCertificateV2,
} from "./actor-capability-certificate-v2.js";
import { verifyLibraryCoreEd25519WithWebCrypto } from "./ed25519-verification.js";

const AUTHORITY_SEED =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ACTOR_SEED =
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function privateKey(seedHex: string) {
  return createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_SEED_PREFIX,
      Buffer.from(seedHex, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeyHex(seedHex: string): string {
  const spki = createPublicKey(privateKey(seedHex)).export({
    format: "der",
    type: "spki",
  });
  return spki.subarray(spki.byteLength - 32).toString("hex");
}

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  authorityPublicKey:
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  actorPublicKey:
    "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
  installation: "33".repeat(32),
  nonce: "44".repeat(32),
  actorProof: "55".repeat(64),
  authoritySignature: "66".repeat(64),
} as const;

function digest(domain: LibraryCoreDigestDomain, value: unknown): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
    )
    .digest("hex");
}

function authorityKeyId(): string {
  return digest("authority-key", {
    signature_algorithm: "ed25519",
    authority_public_key: HEX.authorityPublicKey,
  });
}

function enrollment() {
  return constructLibraryCoreActorEnrollmentBodyV1(
    {
      operation_id: "actor-enrolled:capability-vector",
      library_id: HEX.library,
      epoch: 1,
      epoch_id: HEX.epoch,
      authority_key_id: authorityKeyId(),
      installation_incarnation: HEX.installation,
      actor_incarnation_nonce: HEX.nonce,
      actor_public_key: HEX.actorPublicKey,
      observed_frontier: [],
      created_at_ms: 1_234,
    },
    { digest },
  );
}

function authority(): LibraryCoreActorCapabilityAuthorityStateV2 {
  return {
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    authority_key_id: authorityKeyId(),
    authority_public_key: HEX.authorityPublicKey,
    observed_frontier: [],
  } as unknown as LibraryCoreActorCapabilityAuthorityStateV2;
}

async function certificate(
  scope:
    | { readonly mode: "library_wide" }
    | {
        readonly mode: "bounded";
        readonly scope_kind: "provider" | "source";
        readonly scope_id: string;
      } = { mode: "library_wide" },
) {
  return constructLibraryCoreActorCapabilityCertificateV2(
    enrollment(),
    {
      actor_class: "agent",
      allowed_operation_types: [
        "feed_item_read_assignment",
        "feed_item_saved_assignment",
      ],
      scope,
    },
    {
      digest,
      async signActorProof() {
        return HEX.actorProof;
      },
      async signAuthorityCertificate() {
        return HEX.authoritySignature;
      },
    },
  );
}

describe("Library Core actor capability certificate v2", () => {
  it("constructs the same proof-only bytes that the full certificate countersigns", async () => {
    const request = await constructLibraryCoreActorCapabilityRequestV2(
      enrollment(),
      {
        actor_class: "agent",
        allowed_operation_types: [
          "feed_item_read_assignment",
          "feed_item_saved_assignment",
        ],
        scope: { mode: "library_wide" },
      },
      {
        digest,
        async signActorProof() {
          return HEX.actorProof;
        },
      },
    );
    const complete = await certificate();

    expect(isLibraryCoreActorCapabilityRequestConstructionV2(request)).toBe(
      true,
    );
    expect(request.request).toStrictEqual({
      certificate_body: complete.certificate.certificate_body,
      certificate_digest: complete.certificate.certificate_digest,
    });
    expect(request.actor_chain_genesis).toBe(complete.actor_chain_genesis);
    expect(request.request).not.toHaveProperty("authority_signature");
  });

  it("matches and verifies the deterministic cross-runtime certificate vector", async () => {
    const vector = capabilityVectors.vectors[0];
    expect(vector.authority_seed_hex).toBe(AUTHORITY_SEED);
    expect(vector.actor_seed_hex).toBe(ACTOR_SEED);
    const actorKey = privateKey(ACTOR_SEED);
    const authorityKey = privateKey(AUTHORITY_SEED);
    const result = await constructLibraryCoreActorCapabilityCertificateV2(
      enrollment(),
      {
        actor_class: "agent",
        allowed_operation_types: [
          "feed_item_read_assignment",
          "feed_item_saved_assignment",
        ],
        scope: { mode: "library_wide" },
      },
      {
        digest,
        async signActorProof(message) {
          return signEd25519(null, message, actorKey).toString("hex");
        },
        async signAuthorityCertificate(message) {
          return signEd25519(null, message, authorityKey).toString("hex");
        },
      },
    );
    const canonicalCertificate = new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(result.certificate as never),
    );
    expect(publicKeyHex(AUTHORITY_SEED)).toBe(vector.authority_public_key_hex);
    expect(publicKeyHex(ACTOR_SEED)).toBe(vector.actor_public_key_hex);
    expect(result.certificate).toStrictEqual(vector.certificate);
    expect(result.actor_chain_genesis).toBe(vector.actor_chain_genesis);
    expect(JSON.parse(canonicalCertificate)).toStrictEqual(vector.certificate);
    await expect(
      verifyLibraryCoreActorCapabilityCertificateV2(
        encodeLibraryCoreCanonicalValue(vector.certificate as never),
        authority(),
        { digest, verifySignature: verifyLibraryCoreEd25519WithWebCrypto },
      ),
    ).resolves.toMatchObject({
      actor_chain_genesis: result.actor_chain_genesis,
    });
  });
  it("keeps scraper authority frozen outside the extensible canonical registry", () => {
    expect(
      Object.isFrozen(LIBRARY_CORE_ACTOR_CAPABILITY_OPERATION_TYPES_V2),
    ).toBe(true);
    expect(Object.isFrozen(LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2)).toBe(true);
    expect(LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2).toStrictEqual([
      "feed_item_capture_upsert",
    ]);
    const hypotheticalFutureRegistry = [
      ...LIBRARY_CORE_ACTOR_CAPABILITY_OPERATION_TYPES_V2,
      "future_operation",
    ];
    expect(hypotheticalFutureRegistry).toContain("future_operation");
    expect(LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2).not.toContain(
      "future_operation",
    );
  });

  it("binds class, explicit library-wide scope, operations, and lifecycle identities", async () => {
    const result = await certificate();
    const body = result.certificate.certificate_body.actor_capability_body;
    expect(body).toMatchObject({
      format: "freed_library_core_actor_capability_v2",
      actor_class: "agent",
      allowed_operation_types: [
        "feed_item_read_assignment",
        "feed_item_saved_assignment",
      ],
      scope: { mode: "library_wide" },
      issued_at_ms: 1_234,
    });
    expect(body.issuance_identity).toMatch(/^[0-9a-f]{64}$/);
    expect(body.retirement_identity).toMatch(/^[0-9a-f]{64}$/);
    expect(body.issuance_identity).not.toBe(body.retirement_identity);
    expect(isLibraryCoreActorCapabilityCertificateConstructionV2(result)).toBe(
      true,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(body.allowed_operation_types)).toBe(true);
    expect(Object.isFrozen(body.scope)).toBe(true);
  });

  it("verifies the exact v2 body before both signatures and rejects changed bytes", async () => {
    const result = await certificate();
    const bytes = encodeLibraryCoreCanonicalValue(result.certificate as never);
    const verifySignature = vi.fn(async () => true);
    const verified = await verifyLibraryCoreActorCapabilityCertificateV2(
      bytes,
      authority(),
      { digest, verifySignature },
    );
    expect(isLibraryCoreVerifiedActorCapabilityCertificateV2(verified)).toBe(
      true,
    );
    expect(verified.actor_chain_genesis).toBe(result.actor_chain_genesis);
    expect(verifySignature).toHaveBeenCalledTimes(2);

    const changed = decodeLibraryCoreCanonicalValue(bytes) as Record<
      string,
      unknown
    >;
    const certificateBody = changed.certificate_body as Record<string, unknown>;
    const capabilityBody = certificateBody.actor_capability_body as Record<
      string,
      unknown
    >;
    const altered = {
      ...changed,
      certificate_body: {
        ...certificateBody,
        actor_capability_body: {
          ...capabilityBody,
          allowed_operation_types: ["feed_item_remove"],
        },
      },
    };
    verifySignature.mockClear();
    await expect(
      verifyLibraryCoreActorCapabilityCertificateV2(
        encodeLibraryCoreCanonicalValue(altered as never),
        authority(),
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/body digest changed/);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("snapshots accepted authority before either asynchronous signature check", async () => {
    const constructed = await certificate();
    const acceptedAuthority = authority() as unknown as Record<string, unknown>;
    const substitutedPublicKey = "aa".repeat(32);
    let releaseActorProof: ((valid: boolean) => void) | undefined;
    let markActorProofStarted: (() => void) | undefined;
    const actorProofStarted = new Promise<void>((resolve) => {
      markActorProofStarted = resolve;
    });
    const verifySignature = vi.fn(
      async (verification: { readonly publicKeyHex: string }) => {
        if (verifySignature.mock.calls.length === 1) {
          markActorProofStarted!();
          return new Promise<boolean>((release) => {
            releaseActorProof = release;
          });
        }
        return verification.publicKeyHex === substitutedPublicKey;
      },
    );
    const pending = verifyLibraryCoreActorCapabilityCertificateV2(
      encodeLibraryCoreCanonicalValue(
        constructed.certificate as unknown as LibraryCoreCanonicalValue,
      ),
      acceptedAuthority as unknown as LibraryCoreActorCapabilityAuthorityStateV2,
      { digest, verifySignature },
    );
    await actorProofStarted;
    acceptedAuthority.authority_public_key = substitutedPublicKey;
    acceptedAuthority.authority_key_id = digest("authority-key", {
      signature_algorithm: "ed25519",
      authority_public_key: substitutedPublicKey,
    });
    releaseActorProof!(true);
    await expect(pending).rejects.toThrow(
      "actor capability authority signature is invalid",
    );
  });

  it("requires the signature dependency to return the boolean true", async () => {
    const constructed = await certificate();
    await expect(
      verifyLibraryCoreActorCapabilityCertificateV2(
        encodeLibraryCoreCanonicalValue(
          constructed.certificate as unknown as LibraryCoreCanonicalValue,
        ),
        authority(),
        {
          digest,
          verifySignature: async () => 1 as unknown as boolean,
        },
      ),
    ).rejects.toThrow("actor capability proof signature is invalid");
  });

  it("requires explicit scope and constrains scraper certificates to capture only", async () => {
    await expect(
      constructLibraryCoreActorCapabilityCertificateV2(
        enrollment(),
        {
          actor_class: "agent",
          allowed_operation_types: ["feed_item_read_assignment"],
        } as never,
        {
          digest,
          signActorProof: async () => HEX.actorProof,
          signAuthorityCertificate: async () => HEX.authoritySignature,
        },
      ),
    ).rejects.toThrow(/explicit object/);
    await expect(
      constructLibraryCoreActorCapabilityCertificateV2(
        enrollment(),
        {
          actor_class: "scraper",
          allowed_operation_types: ["account_upsert"],
          scope: { mode: "library_wide" },
        },
        {
          digest,
          signActorProof: async () => HEX.actorProof,
          signAuthorityCertificate: async () => HEX.authoritySignature,
        },
      ),
    ).rejects.toThrow(/non-capture/);
  });

  it("binds bounded scope without treating it as library-wide authority", async () => {
    const result = await certificate({
      mode: "bounded",
      scope_kind: "provider",
      scope_id: "instagram",
    });
    expect(
      result.certificate.certificate_body.actor_capability_body.scope,
    ).toStrictEqual({
      mode: "bounded",
      scope_kind: "provider",
      scope_id: "instagram",
    });
    await expect(
      verifyLibraryCoreActorCapabilityCertificateV2(
        encodeLibraryCoreCanonicalValue(result.certificate as never),
        authority(),
        { digest, verifySignature: async () => true },
      ),
    ).resolves.toMatchObject({
      actor_chain_genesis: result.actor_chain_genesis,
    });
  });

  it("rejects a stale authority epoch before signature verification", async () => {
    const result = await certificate();
    const verifySignature = vi.fn(async () => true);
    await expect(
      verifyLibraryCoreActorCapabilityCertificateV2(
        encodeLibraryCoreCanonicalValue(result.certificate as never),
        { ...authority(), epoch: 8 },
        { digest, verifySignature },
      ),
    ).rejects.toThrow(/accepted authority/);
    expect(verifySignature).not.toHaveBeenCalled();
  });
});
