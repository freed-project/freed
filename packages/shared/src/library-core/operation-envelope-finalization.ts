import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreOperationSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import {
  isLibraryCoreAssembledTransactionV1,
  type FeedItemReadAssignmentSigningBodyV1,
  type LibraryCoreAssembledTransactionV1,
  type LibraryCoreTransactionBodyV1,
} from "./operation-transaction-contracts.js";

export const LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES = 4_194_304;

const FINALIZED_LIBRARY_CORE_TRANSACTIONS = new WeakSet<object>();
const PLACEHOLDER_SIGNATURE = "0".repeat(128);

export interface FeedItemReadAssignmentEnvelopeV1 extends FeedItemReadAssignmentSigningBodyV1 {
  readonly signature: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreFinalizedEnvelopeV1 {
  readonly envelope: FeedItemReadAssignmentEnvelopeV1;
  readonly envelope_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreFinalizedTransactionV1 {
  readonly transaction_body: LibraryCoreTransactionBodyV1;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
  readonly members: readonly LibraryCoreFinalizedEnvelopeV1[];
  readonly canonical_envelope_bytes: number;
}

export interface LibraryCoreOperationFinalizationDependencies {
  readonly signOperation: (input: Uint8Array) => Promise<unknown>;
  readonly digest: (domain: "operation-envelope", envelope: unknown) => unknown;
}

export function isLibraryCoreFinalizedTransactionV1(
  value: unknown,
): value is LibraryCoreFinalizedTransactionV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  return FINALIZED_LIBRARY_CORE_TRANSACTIONS.has(value);
}

function canonicalEnvelopeBytes(
  signingBody: FeedItemReadAssignmentSigningBodyV1,
  signature: string,
): number {
  return encodeLibraryCoreCanonicalValue({
    ...signingBody,
    signature,
  } as unknown as LibraryCoreCanonicalValue).byteLength;
}

/**
 * Sign a closed assembled transaction and construct its exact v1 envelopes.
 *
 * The complete byte budget is checked before invoking the signer. No result is
 * returned unless every signature and envelope digest is valid. This function
 * does not verify received bytes, persist, materialize, enqueue replication,
 * enroll an actor, or grant runtime authority.
 */
export async function finalizeLibraryCoreTransactionV1(
  assembled: LibraryCoreAssembledTransactionV1,
  dependencies: LibraryCoreOperationFinalizationDependencies,
): Promise<LibraryCoreFinalizedTransactionV1> {
  if (!isLibraryCoreAssembledTransactionV1(assembled)) {
    throw new TypeError(
      "transaction must come from the closed assembly contract",
    );
  }
  const signOperation = dependencies.signOperation;
  const digestEnvelope = dependencies.digest;
  if (
    typeof signOperation !== "function" ||
    typeof digestEnvelope !== "function"
  ) {
    throw new TypeError(
      "operation finalization dependencies must be callable",
    );
  }

  const memberByteLengths = assembled.members.map((member) =>
    canonicalEnvelopeBytes(member.signing_body, PLACEHOLDER_SIGNATURE),
  );
  const canonicalEnvelopeByteTotal = memberByteLengths.reduce(
    (total, byteLength) => {
      const next = total + byteLength;
      if (next > LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES) {
        throw new RangeError(
          "transaction canonical envelope bytes exceed 4,194,304",
        );
      }
      return next;
    },
    0,
  );

  const signatures: LibraryCoreEd25519SignatureHex[] = [];
  for (const member of assembled.members) {
    const signatureInput = encodeLibraryCoreOperationSignatureInput({
      operation_signing_body_digest: member.signing_body_digest,
    });
    const signature = await signOperation(signatureInput);
    if (!isLibraryCoreEd25519SignatureHex(signature)) {
      throw new TypeError(
        "operation signer must return 128 lowercase hexadecimal characters",
      );
    }
    signatures.push(signature);
  }

  const finalizedMembers: LibraryCoreFinalizedEnvelopeV1[] = [];
  for (let index = 0; index < assembled.members.length; index += 1) {
    const envelope = Object.freeze({
      ...assembled.members[index].signing_body,
      signature: signatures[index],
    }) satisfies FeedItemReadAssignmentEnvelopeV1;
    if (
      canonicalEnvelopeBytes(envelope, envelope.signature) !==
      memberByteLengths[index]
    ) {
      throw new TypeError(
        "signature changed the canonical envelope byte contract",
      );
    }
    const envelopeDigest = digestEnvelope("operation-envelope", envelope);
    if (!isLibraryCoreLowercaseHex64(envelopeDigest)) {
      throw new TypeError(
        "operation-envelope digest dependency returned an invalid digest",
      );
    }
    finalizedMembers.push(
      Object.freeze({
        envelope,
        envelope_digest: envelopeDigest,
      }),
    );
  }

  const finalized = Object.freeze({
    transaction_body: assembled.transaction_body,
    transaction_digest: assembled.transaction_digest,
    members: Object.freeze(finalizedMembers),
    canonical_envelope_bytes: canonicalEnvelopeByteTotal,
  });
  FINALIZED_LIBRARY_CORE_TRANSACTIONS.add(finalized);
  return finalized;
}
