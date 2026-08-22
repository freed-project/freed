import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedIntentHeadV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreNormalizedIntentSegmentHeaderV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importIntent: vi.fn(),
  importResultSegment: vi.fn(),
  publishIntentSegment: vi.fn(),
}));

vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@freed/sync/cloud/library-core")>()),
  importLibraryCoreNormalizedIntentSegmentV2: mocks.importIntent,
  importLibraryCoreNormalizedResultSegmentV2: mocks.importResultSegment,
  publishLibraryCoreNormalizedIntentSegmentV2: mocks.publishIntentSegment,
}));

import {
  syncPwaLibraryCoreFollowerV2,
  type PwaLibraryCoreFollowerTransportV2,
} from "./library-core-pwa-follower-sync";

const ACTOR_ID = "1".repeat(64) as LibraryCoreLowercaseHex64;
const LIBRARY_ID = "2".repeat(64) as LibraryCoreLowercaseHex64;
const EPOCH_ID = "3".repeat(64) as LibraryCoreLowercaseHex64;
const STORED_DIGEST = "4".repeat(64) as LibraryCoreLowercaseHex64;
const SEMANTIC_DIGEST = "5".repeat(64) as LibraryCoreLowercaseHex64;

function reference(firstSequence = 1, lastSequence = 1) {
  return parseLibraryCoreImmutableObjectReferenceV1({
    descriptor: {
      byteLength: 1_024,
      contentDigest: STORED_DIGEST,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: ACTOR_ID,
        digest: STORED_DIGEST,
        epochId: EPOCH_ID,
        firstSequence,
        kind: "intent_segment",
        lastSequence,
        libraryId: LIBRARY_ID,
      }),
    },
    transportObjectId: "transport-object-1",
  });
}

function enrollmentReference() {
  const contentDigest = "6".repeat(64) as LibraryCoreLowercaseHex64;
  return parseLibraryCoreImmutableObjectReferenceV1({
    descriptor: {
      byteLength: 3,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: ACTOR_ID,
        digest: contentDigest,
        epochId: EPOCH_ID,
        kind: "actor_enrollment_request",
        libraryId: LIBRARY_ID,
      }),
    },
    transportObjectId: "enrollment-object-1",
  });
}

function header(): LibraryCoreNormalizedIntentSegmentHeaderV2 {
  return {
    actor_id: ACTOR_ID,
    canonical_envelope_bytes: 3,
    first_actor_counter: 1,
    format: "freed_normalized_intent_segment_v2",
    kind: "normalized_intent_segment_header",
    last_actor_counter: 1,
    library_id: LIBRARY_ID,
    previous_segment_digest: null,
    protocol: "normalized_intent_segments_v2",
    protocol_version: 2,
    record_count: 1,
    segment_digest: SEMANTIC_DIGEST,
    storage_epoch_id: EPOCH_ID,
  };
}

function context() {
  return {
    actorId: ACTOR_ID,
    libraryId: LIBRARY_ID,
    nextIntentActorCounter: 1,
    nextResultSequence: 1,
    previousIntentSegmentDigest: null,
    previousResultSegmentDigest: null,
    schemaVersion: 2 as const,
    storageEpochId: EPOCH_ID,
  };
}

function head(nextActorCounter = 1) {
  const latest = nextActorCounter === 1 ? null : reference();
  return parseLibraryCoreNormalizedIntentHeadV2({
    actor_id: ACTOR_ID,
    latest_segment: latest,
    latest_segment_digest: latest?.descriptor.contentDigest ?? null,
    library_id: LIBRARY_ID,
    next_actor_counter: nextActorCounter,
    protocol: "normalized_intent_head_v2",
    protocol_version: 2,
    storage_epoch_id: EPOCH_ID,
  });
}

function transport(remoteHead = head()) {
  const bytes = encodeLibraryCoreCanonicalValue(
    remoteHead as unknown as LibraryCoreCanonicalValue,
  );
  return {
    openIntentAdapter: vi.fn(async () => ({
      compareAndSwapHead: vi.fn(),
      putImmutable: vi.fn(),
      readHead: vi.fn(async () => ({
        bytes,
        head: remoteHead,
        revision: "revision-1",
      })),
      readImmutable: vi.fn(),
      verifyImmutable: vi.fn(),
    })),
    pageResultReferences: vi.fn(async () => ({
      done: true,
      references: [] as ReturnType<typeof reference>[],
    })),
    publishEnrollmentRequest: vi.fn(),
    readEnrollmentCertificate: vi.fn(),
    resultReader: { readImmutable: vi.fn() },
  } satisfies PwaLibraryCoreFollowerTransportV2;
}

function runtime(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    importResult: vi.fn(),
    installEnrollment: vi.fn(),
    now: vi.fn(() => 1_000),
    pageIntents: vi.fn(async () => ({
      actorId: ACTOR_ID,
      canonicalEnvelopes: [Uint8Array.of(1, 2, 3)],
      done: true,
      firstActorCounter: 1,
      lastActorCounter: 1,
      schemaVersion: 2 as const,
    })),
    prepareEnrollment: vi.fn(async () => null),
    publishIntent: vi.fn(async () => ({
      actorId: ACTOR_ID,
      firstActorCounter: 1,
      lastActorCounter: 1,
      newlyPublishedTransactionCount: 1,
      nextActorCounter: 2,
      publishedAt: 1_000,
      semanticSegmentDigest: SEMANTIC_DIGEST,
      storedSegmentDigest: STORED_DIGEST,
    })),
    readContext: vi.fn(async () => context()),
    subtle: crypto.subtle,
    ...overrides,
  };
}

describe("PWA normalized follower sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishIntentSegment.mockResolvedValue({
      publishedHead: head(2),
      segmentHeader: header(),
      segmentReference: reference(),
      status: "committed",
    });
  });

  it("publishes one immutable enrollment request and waits for its exact certificate", async () => {
    const enrollment = enrollmentReference();
    const activeTransport = transport();
    activeTransport.publishEnrollmentRequest.mockResolvedValue(enrollment);
    activeTransport.readEnrollmentCertificate.mockResolvedValue(null);
    const activeRuntime = runtime({
      prepareEnrollment: vi.fn(async () => ({
        descriptor: enrollment.descriptor,
        libraryId: LIBRARY_ID,
        receipt: {
          actorId: ACTOR_ID,
          actorPublicKey: "7".repeat(64),
          canonicalRequestBytes: Uint8Array.of(1, 2, 3),
          createdAt: 900,
          enrollmentRequestDigest: "8".repeat(64),
          state: "pending" as const,
        },
        source: Uint8Array.of(1, 2, 3),
        storageEpochId: EPOCH_ID,
      })),
    });

    const receipt = await syncPwaLibraryCoreFollowerV2(
      activeTransport,
      {},
      activeRuntime,
    );

    expect(receipt.enrollmentState).toBe("pending");
    expect(activeTransport.readEnrollmentCertificate).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      enrollmentRequestDigest: "8".repeat(64),
      libraryId: LIBRARY_ID,
      storageEpochId: EPOCH_ID,
    });
    expect(activeRuntime.readContext).not.toHaveBeenCalled();
  });

  it("publishes one bounded SQLite intent page and records its exact receipt", async () => {
    const activeRuntime = runtime();
    const receipt = await syncPwaLibraryCoreFollowerV2(
      transport(),
      {},
      activeRuntime,
    );

    expect(receipt).toEqual({
      enrollmentState: "enrolled",
      importedResultCount: 0,
      publishedIntentCount: 1,
      recoveredIntentPublication: false,
    });
    expect(activeRuntime.pageIntents).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      firstActorCounter: 1,
      limit: 128,
      schemaVersion: 2,
    });
    expect(activeRuntime.publishIntent).toHaveBeenCalledWith({
      header: header(),
      publishedAt: 1_000,
      reference: reference(),
    });
  });

  it("repairs one response-lost head from the immutable segment before continuing", async () => {
    mocks.importIntent.mockImplementation(async (input) => {
      await input.writer.stageNormalizedIntentSegment({
        canonicalEnvelopes: [Uint8Array.of(1, 2, 3)],
        envelopes: [],
        header: header(),
        reference: reference(),
      });
    });
    const activeRuntime = runtime();
    const receipt = await syncPwaLibraryCoreFollowerV2(
      transport(head(2)),
      {},
      activeRuntime,
    );

    expect(receipt.recoveredIntentPublication).toBe(true);
    expect(receipt.publishedIntentCount).toBe(1);
    expect(activeRuntime.pageIntents).not.toHaveBeenCalled();
    expect(activeRuntime.publishIntent).toHaveBeenCalledOnce();
  });

  it("imports decoded signed results through one atomic SQLite callback", async () => {
    const resultReference = reference();
    const activeTransport = transport();
    activeTransport.pageResultReferences.mockResolvedValue({
      done: true,
      references: [resultReference],
    });
    const result = { result_sequence: 1 } as never;
    mocks.importResultSegment.mockImplementation(async (input) => {
      await input.writer.appendNormalizedResultSegment({
        canonicalResults: [Uint8Array.of(9)],
        header: {
          first_result_sequence: 1,
          last_result_sequence: 1,
        },
        reference: resultReference,
        results: [result],
      });
    });
    const importResult = vi.fn(async () => ({
      acceptedTransactionCount: 1,
      actorId: ACTOR_ID,
      firstResultSequence: 1,
      lastResultSequence: 1,
      nextResultSequence: 2,
      receivedAt: 1_000,
      rejectedTransactionCount: 0,
      resultCount: 1,
      semanticSegmentDigest: SEMANTIC_DIGEST,
      storedSegmentDigest: STORED_DIGEST,
    }));
    const activeRuntime = runtime({
      importResult,
      pageIntents: vi.fn(async () => ({
        actorId: ACTOR_ID,
        canonicalEnvelopes: [],
        done: true,
        firstActorCounter: 1,
        lastActorCounter: null,
        schemaVersion: 2 as const,
      })),
    });

    const receipt = await syncPwaLibraryCoreFollowerV2(
      activeTransport,
      {},
      activeRuntime,
    );

    expect(receipt.importedResultCount).toBe(1);
    expect(importResult).toHaveBeenCalledWith(
      expect.objectContaining({ results: [result] }),
    );
  });
});
