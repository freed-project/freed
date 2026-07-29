import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorEnrollmentBodyV1,
  isLibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyInputV1,
} from "./actor-enrollment-contracts.js";
import type { LibraryCoreConstructionDigestDomain } from "./operation-envelope-contracts.js";

const HEX = {
  library: "11".repeat(32),
  epoch: "22".repeat(32),
  authority: "33".repeat(32),
  installation: "44".repeat(32),
  nonce: "55".repeat(32),
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  frontierActor: "66".repeat(32),
  frontierChain: "77".repeat(32),
} as const;

function digest(
  domain: LibraryCoreConstructionDigestDomain,
  value: unknown,
): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
    )
    .digest("hex");
}

function input(): LibraryCoreActorEnrollmentBodyInputV1 {
  return {
    operation_id: "op:actor-enrollment:fixture:1",
    library_id: HEX.library,
    epoch: 1,
    epoch_id: HEX.epoch,
    authority_key_id: HEX.authority,
    installation_incarnation: HEX.installation,
    actor_incarnation_nonce: HEX.nonce,
    actor_public_key: HEX.publicKey,
    observed_frontier: [
      {
        actor_id: HEX.frontierActor,
        sequence: 3,
        operation_id: "op:frontier:fixture:3",
        chain_digest: HEX.frontierChain,
      },
    ],
    created_at_ms: 1_000,
  };
}

describe("Library Core actor enrollment body construction", () => {
  it("derives the exact immutable public-key fingerprint, actor ID, body, and digest", () => {
    const result = constructLibraryCoreActorEnrollmentBodyV1(input(), {
      digest,
    });

    expect(result.body).toStrictEqual({
      operation_id: "op:actor-enrollment:fixture:1",
      operation_type: "actor_enrolled",
      library_id: HEX.library,
      epoch: 1,
      epoch_id: HEX.epoch,
      schema_version: 1,
      authority_key_id: HEX.authority,
      installation_incarnation: HEX.installation,
      actor_incarnation_nonce: HEX.nonce,
      actor_id:
        "91c96ddd9a8bd2c9a98c7a780ebe807ee55d03485318047d8e5907324ef35306",
      actor_public_key: HEX.publicKey,
      actor_public_key_fingerprint:
        "df6651b11b37096d193a6f73247b9a3ebda54124df0ce860e7cc8f9d897ac3e5",
      observed_frontier: [
        {
          actor_id: HEX.frontierActor,
          sequence: 3,
          operation_id: "op:frontier:fixture:3",
          chain_digest: HEX.frontierChain,
        },
      ],
      created_at_ms: 1_000,
      signature_algorithm: "ed25519",
    });
    expect(result.enrollment_body_digest).toBe(
      "adafb20b415acdfc758cad8e9b6f3da7626e01ca420f605cffed786423f7905f",
    );
    expect(isLibraryCoreActorEnrollmentBodyConstructionV1(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.body)).toBe(true);
    expect(Object.isFrozen(result.body.observed_frontier)).toBe(true);
  });

  it("rejects unknown fields, behavior-bearing values, bad identity codecs, and invalid frontier order", () => {
    const base = input();
    const accessor = Object.defineProperty({ ...base }, "actor_public_key", {
      enumerable: true,
      get: () => HEX.publicKey,
    });
    for (const candidate of [
      { ...base, extra: true },
      accessor,
      { ...base, epoch: 0 },
      { ...base, actor_public_key: "invalid" },
      { ...base, actor_incarnation_nonce: "invalid" },
      {
        ...base,
        observed_frontier: [
          ...(base.observed_frontier as object[]),
          ...(base.observed_frontier as object[]),
        ],
      },
    ]) {
      expect(() =>
        constructLibraryCoreActorEnrollmentBodyV1(candidate as never, {
          digest,
        }),
      ).toThrow();
    }
  });

  it("rejects invalid derived digest results", () => {
    for (const failedDomain of [
      "actor-public-key",
      "actor-id",
      "actor-enrollment-body",
    ] as const) {
      expect(() =>
        constructLibraryCoreActorEnrollmentBodyV1(input(), {
          digest(domain, value) {
            return domain === failedDomain ? "invalid" : digest(domain, value);
          },
        }),
      ).toThrow(/invalid digest/);
    }
  });

  it("does not recognize a frozen structural lookalike as closed construction", () => {
    const genuine = constructLibraryCoreActorEnrollmentBodyV1(input(), {
      digest,
    });
    expect(Object.getOwnPropertySymbols(genuine)).toStrictEqual([]);
    expect(
      isLibraryCoreActorEnrollmentBodyConstructionV1(
        Object.freeze({
          body: genuine.body,
          enrollment_body_digest: genuine.enrollment_body_digest,
        }),
      ),
    ).toBe(false);
    expect(
      isLibraryCoreActorEnrollmentBodyConstructionV1(
        Object.freeze(Object.create(genuine)),
      ),
    ).toBe(false);
  });

  it("snapshots input descriptors and the digest capability exactly once", () => {
    const source = input() as unknown as Record<string, unknown>;
    const descriptorReads = new Map<PropertyKey, number>();
    const proxiedInput = new Proxy(source, {
      getOwnPropertyDescriptor(target, property) {
        descriptorReads.set(property, (descriptorReads.get(property) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(_target, property) {
        throw new Error(`unexpected property read: ${String(property)}`);
      },
    });
    let digestReads = 0;
    const dependencies = {
      get digest() {
        digestReads += 1;
        return digest;
      },
    };

    const result = constructLibraryCoreActorEnrollmentBodyV1(
      proxiedInput as never,
      dependencies,
    );

    expect(result.body.actor_public_key).toBe(HEX.publicKey);
    expect(digestReads).toBe(1);
    for (const property of Object.keys(source)) {
      expect(descriptorReads.get(property)).toBe(1);
    }
  });
});
