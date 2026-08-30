import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreNormalizedResultHeadV2,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedResultHeadV2,
} from "@freed/shared/library-core";
import { describe, expect, it, vi } from "vitest";
import {
  syncLibraryCoreNormalizedPrimaryEnrollmentsV2,
  syncLibraryCoreNormalizedPrimaryIntentsV2,
  syncLibraryCoreNormalizedPrimaryResultsV2,
  type LibraryCoreNormalizedPrimaryEnrollmentRequestV2,
  type LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2,
  type LibraryCoreNormalizedPrimaryEnrollmentTransportV2,
  type LibraryCoreNormalizedPrimaryIntentRuntimeV2,
  type LibraryCoreNormalizedPrimaryIntentTransportV2,
  type LibraryCoreNormalizedPrimaryResultRuntimeV2,
  type LibraryCoreNormalizedPrimaryResultTransportV2,
} from "./library-core-normalized-primary-sync.js";
import { prepareLibraryCoreNormalizedIntentSegmentV2 } from "./library-core-normalized-intent-segments.js";
import type { LibraryCoreNormalizedHeadPublicationAdapterV2 } from "./library-core-normalized-segment-publication.js";

const LIBRARY_ID = "1".repeat(64);
const EPOCH_ID = "2".repeat(64);
const ACTOR_ID = "3".repeat(64);
const ACTOR_KEY = "4".repeat(64);
const REQUEST_DIGEST = "5".repeat(64);

function request(): LibraryCoreNormalizedPrimaryEnrollmentRequestV2 {
  const bytes = encodeLibraryCoreCanonicalValue({
    certificate_body: {
      actor_enrollment_body: {
        actor_id: ACTOR_ID,
        actor_public_key: ACTOR_KEY,
        authority_epoch_id: EPOCH_ID,
        library_id: LIBRARY_ID,
      },
      actor_proof: "6".repeat(128),
      enrollment_body_digest: "7".repeat(64),
    },
    certificate_digest: REQUEST_DIGEST,
  } as LibraryCoreCanonicalValue);
  const contentDigest = sha256LowerHex(bytes);
  return Object.freeze({
    bytes,
    reference: Object.freeze({
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: bytes.byteLength,
        contentDigest,
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId: ACTOR_ID,
          digest: contentDigest,
          epochId: EPOCH_ID,
          kind: "actor_enrollment_request",
          libraryId: LIBRARY_ID,
        }),
      }),
      transportObjectId: "request-object-1",
    }),
  });
}

function nativeReceipt() {
  const certificate = encodeLibraryCoreCanonicalValue({
    authority_signature: "8".repeat(128),
    certificate_body: {
      actor_enrollment_body: {
        actor_id: ACTOR_ID,
        actor_public_key: ACTOR_KEY,
        authority_epoch_id: EPOCH_ID,
        library_id: LIBRARY_ID,
      },
      actor_proof: "6".repeat(128),
      enrollment_body_digest: "7".repeat(64),
    },
    certificate_digest: REQUEST_DIGEST,
  } as LibraryCoreCanonicalValue);
  return Object.freeze({
    actorChainGenesis: "9".repeat(64),
    actorId: ACTOR_ID,
    actorPublicKey: ACTOR_KEY,
    authorityEpochId: EPOCH_ID,
    canonicalEnrollmentCertificateJson: new TextDecoder().decode(certificate),
    enrolledAt: 10_000,
    enrollmentCertificateDigest: REQUEST_DIGEST,
    libraryId: LIBRARY_ID,
  });
}

function fixture(input: {
  requests?: readonly LibraryCoreNormalizedPrimaryEnrollmentRequestV2[];
  done?: boolean;
}) {
  const countersignEnrollment = vi.fn(async () => nativeReceipt());
  const published: LibraryCoreImmutableObjectReferenceV1[] = [];
  const transport: LibraryCoreNormalizedPrimaryEnrollmentTransportV2 = {
    async pageEnrollmentRequests(page) {
      expect(page).toEqual({
        libraryId: LIBRARY_ID,
        limit: 16,
        storageEpochId: EPOCH_ID,
      });
      return {
        done: input.done ?? true,
        requests: input.requests ?? [request()],
      };
    },
    async publishEnrollmentCertificate({ certificate }) {
      const reference = Object.freeze({
        descriptor: certificate.descriptor,
        transportObjectId: `certificate-${published.length + 1}`,
      });
      published.push(reference);
      return reference;
    },
  };
  const runtime: LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2 = {
    countersignEnrollment,
    now: () => 10_000,
  };
  return { countersignEnrollment, published, runtime, transport };
}

describe("normalized Primary enrollment sync", () => {
  it("countersigns one exact request and publishes one immutable certificate", async () => {
    const active = fixture({});
    const receipt = await syncLibraryCoreNormalizedPrimaryEnrollmentsV2(
      active.transport,
      active.runtime,
      { libraryId: LIBRARY_ID, storageEpochId: EPOCH_ID },
    );

    expect(receipt.done).toBe(true);
    expect(receipt.processedRequestCount).toBe(1);
    expect(receipt.publishedCertificates).toEqual(active.published);
    expect(active.countersignEnrollment).toHaveBeenCalledWith({
      acceptedAtMs: 10_000,
      canonicalEnrollmentRequestJson: new TextDecoder().decode(request().bytes),
    });
    expect(active.published[0]?.descriptor.objectKey).toContain(
      `freed-v2-enrollment~${LIBRARY_ID}~${EPOCH_ID}~${ACTOR_ID}`,
    );
  });

  it("rejects changed immutable request bytes before native authority", async () => {
    const changed = request();
    changed.bytes[0] = changed.bytes[0]! ^ 1;
    const active = fixture({ requests: [changed] });

    await expect(
      syncLibraryCoreNormalizedPrimaryEnrollmentsV2(
        active.transport,
        active.runtime,
        { libraryId: LIBRARY_ID, storageEpochId: EPOCH_ID },
      ),
    ).rejects.toThrow("request bytes changed");
    expect(active.countersignEnrollment).not.toHaveBeenCalled();
    expect(active.published).toHaveLength(0);
  });

  it("rejects a nonterminal empty transport page", async () => {
    const active = fixture({ done: false, requests: [] });
    await expect(
      syncLibraryCoreNormalizedPrimaryEnrollmentsV2(
        active.transport,
        active.runtime,
        { libraryId: LIBRARY_ID, storageEpochId: EPOCH_ID },
      ),
    ).rejects.toThrow("request page is invalid");
  });
});

function canonicalIntent(actorSequence = 1) {
  return encodeLibraryCoreCanonicalValue({
    actor_chain_digest: "a".repeat(64),
    actor_id: ACTOR_ID,
    actor_sequence: actorSequence,
    blob_references: [],
    causal_frontier: [],
    created_at_ms: 1,
    entity_id: "item-1",
    entity_type: "FeedItem",
    epoch: 1,
    epoch_id: EPOCH_ID,
    hlc_counter: 0,
    hlc_wall_ms: 1,
    library_id: LIBRARY_ID,
    operation_id: `operation-${actorSequence}`,
    operation_type: "feed_item_read_assignment",
    payload: { read_at_ms: 1 },
    payload_digest: "b".repeat(64),
    previous_actor_chain_digest: "c".repeat(64),
    previous_actor_operation_id: null,
    schema_version: 1,
    signature: "d".repeat(128),
    signature_algorithm: "ed25519",
    transaction_digest: "e".repeat(64),
    transaction_id: "transaction-1",
    transaction_member_count: 1,
    transaction_member_index: 0,
  } as LibraryCoreCanonicalValue);
}

async function intentFixture(
  input: { previousSegmentDigest?: LibraryCoreLowercaseHex64 | null } = {},
) {
  const canonicalEnvelope = canonicalIntent();
  const prepared = await prepareLibraryCoreNormalizedIntentSegmentV2({
    actorId: ACTOR_ID,
    canonicalEnvelopes: [canonicalEnvelope],
    libraryId: LIBRARY_ID,
    previousSegmentDigest: null,
    storageEpochId: EPOCH_ID,
    subtle: crypto.subtle,
  });
  const reference: LibraryCoreImmutableObjectReferenceV1 = Object.freeze({
    descriptor: prepared.object.descriptor,
    transportObjectId: "intent-segment-1",
  });
  let nextActorCounter = 1;
  const ingestIntentPage = vi.fn(async ({ page }) => {
    nextActorCounter = page.records.at(-1)!.actorCounter + 1;
    return {
      exactRetries: 0,
      pendingTransactions: 0,
      resolvedRecords: 1,
      resolvedTransactions: 1,
      stagedRecords: 1,
    };
  });
  const runtime: LibraryCoreNormalizedPrimaryIntentRuntimeV2 = {
    ingestIntentPage,
    now: () => 11_000,
    async readActorState() {
      return {
        actorId: ACTOR_ID,
        libraryId: LIBRARY_ID,
        nextActorCounter,
        storageEpochId: EPOCH_ID,
      };
    },
    subtle: crypto.subtle,
  };
  const transport: LibraryCoreNormalizedPrimaryIntentTransportV2 = {
    intentReader: {
      async readImmutable(candidate) {
        expect(candidate).toEqual(reference);
        return prepared.object.source;
      },
    },
    async pageIntentReferences(page) {
      expect(page).toEqual({
        actorId: ACTOR_ID,
        firstActorCounter: 1,
        libraryId: LIBRARY_ID,
        limit: 16,
        storageEpochId: EPOCH_ID,
      });
      return {
        done: true,
        previousSegmentDigest: input.previousSegmentDigest ?? null,
        references: [reference],
      };
    },
  };
  return { canonicalEnvelope, ingestIntentPage, runtime, transport };
}

describe("normalized Primary intent sync", () => {
  it("imports one exact immutable segment and proves native counter advance", async () => {
    const active = await intentFixture();
    const receipt = await syncLibraryCoreNormalizedPrimaryIntentsV2(
      active.transport,
      active.runtime,
      {
        actorId: ACTOR_ID,
        libraryId: LIBRARY_ID,
        storageEpochId: EPOCH_ID,
      },
    );

    expect(receipt).toMatchObject({
      done: true,
      importedIntentCount: 1,
      importedSegmentCount: 1,
      nextActorCounter: 2,
    });
    expect(active.ingestIntentPage).toHaveBeenCalledWith({
      page: {
        records: [
          expect.objectContaining({
            actorCounter: 1,
            actorId: ACTOR_ID,
            canonicalEnvelopeJson: new TextDecoder().decode(
              active.canonicalEnvelope,
            ),
            intentEpoch: 1,
            intentEpochId: EPOCH_ID,
            operationId: "operation-1",
            state: "pending",
            transactionId: "transaction-1",
          }),
        ],
      },
      receivedAt: 11_000,
    });
  });

  it("rejects a non-genesis transport predecessor before reading bytes", async () => {
    const active = await intentFixture({
      previousSegmentDigest: "f".repeat(64) as LibraryCoreLowercaseHex64,
    });
    await expect(
      syncLibraryCoreNormalizedPrimaryIntentsV2(
        active.transport,
        active.runtime,
        {
          actorId: ACTOR_ID,
          libraryId: LIBRARY_ID,
          storageEpochId: EPOCH_ID,
        },
      ),
    ).rejects.toThrow("reference page is invalid");
    expect(active.ingestIntentPage).not.toHaveBeenCalled();
  });
});

function canonicalResult() {
  return encodeLibraryCoreCanonicalValue({
    actor_id: ACTOR_ID,
    authoritative_source_revision: 1,
    authority_key_id: "6".repeat(64),
    canonical_operation_ids: ["operation-1"],
    epoch: 1,
    epoch_id: EPOCH_ID,
    format: "freed_follower_result_v1",
    intent_epoch: 1,
    intent_epoch_id: EPOCH_ID,
    library_id: LIBRARY_ID,
    original_result_digest: null,
    previous_result_digest: null,
    receipt_ids: ["receipt-1"],
    rejection_reason: null,
    replacement_fields: [],
    resolved_at_ms: 1,
    result_body_digest: "7".repeat(64),
    result_sequence: 1,
    schema_version: 1,
    signature: "8".repeat(128),
    signature_algorithm: "ed25519",
    status: "accepted",
    transaction_digest: "9".repeat(64),
    transaction_id: "transaction-1",
  } as LibraryCoreCanonicalValue);
}

function resultAdapter(): LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedResultHeadV2> {
  const head = parseLibraryCoreNormalizedResultHeadV2({
    actor_id: ACTOR_ID,
    latest_segment: null,
    latest_segment_digest: null,
    library_id: LIBRARY_ID,
    next_result_sequence: 1,
    protocol: "normalized_result_head_v2",
    protocol_version: 2,
    storage_epoch_id: EPOCH_ID,
  });
  let current = {
    bytes: encodeLibraryCoreCanonicalValue(
      head as unknown as LibraryCoreCanonicalValue,
    ),
    head,
    revision: "revision-1",
  };
  let stored:
    | Parameters<
        LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedResultHeadV2>["putImmutable"]
      >[0]
    | undefined;
  return {
    async compareAndSwapHead(input) {
      expect(input.expectedRevision).toBe(current.revision);
      current = {
        bytes: input.bytes,
        head: decodeLibraryCoreCanonicalValue(
          input.bytes,
        ) as unknown as LibraryCoreNormalizedResultHeadV2,
        revision: "revision-2",
      };
      return { status: "committed" };
    },
    async putImmutable(object) {
      stored = object;
      return { transportObjectId: "result-segment-1" };
    },
    async readHead() {
      return current;
    },
    async verifyImmutable(input) {
      expect(stored?.descriptor).toEqual(input.descriptor);
      expect(input.transportObjectId).toBe("result-segment-1");
      return input.descriptor;
    },
  };
}

describe("normalized Primary result sync", () => {
  it("publishes one exact bounded native result page", async () => {
    const adapter = resultAdapter();
    const exportResultPage = vi.fn(async () => ({
      canonicalResults: [canonicalResult()],
      done: true,
    }));
    const runtime: LibraryCoreNormalizedPrimaryResultRuntimeV2 = {
      exportResultPage,
      subtle: crypto.subtle,
    };
    const transport: LibraryCoreNormalizedPrimaryResultTransportV2 = {
      async openResultAdapter(context) {
        expect(context).toEqual({
          actorId: ACTOR_ID,
          libraryId: LIBRARY_ID,
          storageEpochId: EPOCH_ID,
        });
        return adapter;
      },
    };
    const receipt = await syncLibraryCoreNormalizedPrimaryResultsV2(
      transport,
      runtime,
      {
        actorId: ACTOR_ID,
        libraryId: LIBRARY_ID,
        storageEpochId: EPOCH_ID,
      },
    );

    expect(exportResultPage).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      firstResultSequence: 1,
      maximumRecords: 128,
      maximumResponseBytes: 1_048_576,
    });
    expect(receipt).toMatchObject({
      done: true,
      nextResultSequence: 2,
      publishedResultCount: 1,
      recoveredPublication: false,
    });
    expect(receipt.publishedSegment?.descriptor.objectKey).toContain("~s1-1~");
  });

  it("rejects a nonterminal empty native result page", async () => {
    const runtime: LibraryCoreNormalizedPrimaryResultRuntimeV2 = {
      async exportResultPage() {
        return { canonicalResults: [], done: false };
      },
      subtle: crypto.subtle,
    };
    await expect(
      syncLibraryCoreNormalizedPrimaryResultsV2(
        {
          async openResultAdapter() {
            return resultAdapter();
          },
        },
        runtime,
        {
          actorId: ACTOR_ID,
          libraryId: LIBRARY_ID,
          storageEpochId: EPOCH_ID,
        },
      ),
    ).rejects.toThrow("result page is invalid");
  });
});
