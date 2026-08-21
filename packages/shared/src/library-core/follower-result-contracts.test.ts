import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  libraryCoreFollowerResultBodyV1,
  parseLibraryCoreFollowerResultEnvelopeV1,
  verifyLibraryCoreFollowerResultV1,
} from "./follower-result-contracts.js";

describe("follower result contract", () => {
  it("verifies exact bounded authority-signed result bytes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const authorityPublicKey = publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: "actor-1",
      authoritative_source_revision: 8,
      authority_key_id: "a".repeat(64),
      canonical_operation_ids: ["operation-1"],
      epoch: 1,
      epoch_id: "epoch-1",
      format: "freed_follower_result_v1",
      library_id: "library-1",
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: ["receipt-1"],
      rejection_reason: null,
      replacement_fields: [
        {
          boolean_value: null,
          entity_id: "item-1",
          entity_type: "FeedItem",
          field_path: "read_at",
          integer_value: 1_400,
          real_value: null,
          text_value: null,
          value_type: "integer",
        },
      ],
      resolved_at_ms: 2_000,
      result_body_digest: "0".repeat(64),
      result_sequence: 1,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: "b".repeat(64),
      transaction_id: "transaction-1",
    });
    const body = libraryCoreFollowerResultBodyV1(unsigned);
    const resultBodyDigest = createHash("sha256")
      .update(
        encodeLibraryCoreDigestInput(
          "follower-result-body",
          body as unknown as LibraryCoreCanonicalValue,
        ),
      )
      .digest("hex");
    const message = encodeLibraryCoreSignatureInput("follower-result-envelope", {
      result_body_digest: resultBodyDigest,
    });
    const canonicalBytes = encodeLibraryCoreCanonicalValue({
      ...unsigned,
      result_body_digest: resultBodyDigest,
      signature: sign(null, message, privateKey).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    const verified = await verifyLibraryCoreFollowerResultV1(
      canonicalBytes,
      {
        authorityKeyId: "a".repeat(64),
        authorityPublicKey,
        epoch: 1,
        epochId: "epoch-1",
        libraryId: "library-1",
      },
      {
        async verifySignature(input) {
          return verify(
            null,
            input.message,
            publicKey,
            Buffer.from(input.signatureHex, "hex"),
          );
        },
      },
    );
    expect(verified.resultDigest).toBe(resultBodyDigest);
    expect(verified.envelope.replacement_fields[0]?.field_path).toBe("read_at");

    const changed = new Uint8Array(canonicalBytes);
    changed[changed.byteLength - 2] = changed[changed.byteLength - 2] === 48 ? 49 : 48;
    await expect(
      verifyLibraryCoreFollowerResultV1(
        changed,
        {
          authorityKeyId: "a".repeat(64),
          authorityPublicKey,
          epoch: 1,
          epochId: "epoch-1",
          libraryId: "library-1",
        },
        { async verifySignature() { return true; } },
      ),
    ).rejects.toThrow();

    expect(() =>
      parseLibraryCoreFollowerResultEnvelopeV1({
        ...unsigned,
        rejection_reason: "target_missing",
      }),
    ).toThrow(/rejection reason/);
    expect(() =>
      parseLibraryCoreFollowerResultEnvelopeV1({
        ...unsigned,
        replacement_fields: [
          {
            ...unsigned.replacement_fields[0],
            boolean_value: true,
            integer_value: null,
            value_type: "boolean",
          },
        ],
      }),
    ).toThrow(/type disagrees/);
  });
});
