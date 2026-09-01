import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({
  compareAndSwapHead: vi.fn(),
  createAdapter: vi.fn(),
  createIntentAdapter: vi.fn(),
  discoverEnrollments: vi.fn(),
  discoverIntentHead: vi.fn(),
  discoverResults: vi.fn(),
  provisionIntentHead: vi.fn(),
  putImmutable: vi.fn(),
  readHead: vi.fn(),
  readImmutable: vi.fn(),
  verifyImmutable: vi.fn(),
}));

vi.mock("./library-core-google-drive-adapter.js", () => ({
  createGoogleDriveLibraryCoreAdapterV1: mocks.createAdapter,
  createGoogleDriveLibraryCoreNormalizedIntentAdapterV2:
    mocks.createIntentAdapter,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1:
    mocks.discoverEnrollments,
  discoverGoogleDriveLibraryCoreIntentHeadV1: mocks.discoverIntentHead,
  discoverGoogleDriveLibraryCoreResultSegmentsV1: mocks.discoverResults,
  provisionGoogleDriveLibraryCoreNormalizedIntentHeadV2:
    mocks.provisionIntentHead,
}));

import { createGoogleDriveLibraryCoreNormalizedFollowerTransportV2 } from "./library-core-google-drive-normalized-follower-transport.js";

const libraryId = "11".repeat(32) as LibraryCoreLowercaseHex64;
const storageEpochId = "22".repeat(32) as LibraryCoreLowercaseHex64;
const actorId = "33".repeat(32) as LibraryCoreLowercaseHex64;
const enrollmentRequestDigest = "44".repeat(32) as LibraryCoreLowercaseHex64;

function descriptor(digest = "55".repeat(32) as LibraryCoreLowercaseHex64) {
  return parseLibraryCoreImmutableObjectDescriptorV1({
    byteLength: 3,
    contentDigest: digest,
    objectKey: createLibraryCoreImmutableObjectKey({
      actorId,
      digest,
      epochId: storageEpochId,
      kind: "actor_enrollment_request",
      libraryId,
    }),
  });
}

function certificateBytes(input: {
  readonly actorId: string;
  readonly enrollmentRequestDigest: string;
}): Uint8Array {
  return encodeLibraryCoreCanonicalValue({
    authority_signature: "66".repeat(64),
    certificate_body: {
      actor_enrollment_body: {
        actor_id: input.actorId,
      },
      enrollment_body_digest: input.enrollmentRequestDigest,
    },
    certificate_digest: "77".repeat(32),
  });
}

function createTransport(beforeProviderOperation = vi.fn()) {
  return {
    beforeProviderOperation,
    transport: createGoogleDriveLibraryCoreNormalizedFollowerTransportV2({
      accessToken: "token",
      beforeProviderOperation,
      controlFileId: "control-1",
      libraryId,
    }),
  };
}

describe("Google Drive normalized follower transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.putImmutable.mockResolvedValue({ transportObjectId: "immutable-1" });
    mocks.verifyImmutable.mockImplementation(async (receipt) =>
      receipt.descriptor,
    );
    mocks.readImmutable.mockResolvedValue(Uint8Array.of(1, 2, 3));
    mocks.createAdapter.mockReturnValue({
      putImmutable: mocks.putImmutable,
      readImmutable: mocks.readImmutable,
      verifyImmutable: mocks.verifyImmutable,
    });
    mocks.createIntentAdapter.mockReturnValue({
      compareAndSwapHead: mocks.compareAndSwapHead,
      putImmutable: mocks.putImmutable,
      readHead: mocks.readHead,
      readImmutable: mocks.readImmutable,
      verifyImmutable: mocks.verifyImmutable,
    });
    mocks.discoverEnrollments.mockResolvedValue([]);
    mocks.discoverIntentHead.mockResolvedValue({
      intentHeadFileId: "intent-head-1",
    });
    mocks.discoverResults.mockResolvedValue([]);
  });

  it("publishes the exact request and selects only its matching certificate", async () => {
    const wrongDigest = certificateBytes({
      actorId,
      enrollmentRequestDigest: "88".repeat(32),
    });
    const wrongActor = certificateBytes({
      actorId: "99".repeat(32),
      enrollmentRequestDigest,
    });
    const exact = certificateBytes({ actorId, enrollmentRequestDigest });
    mocks.discoverEnrollments.mockResolvedValue([
      { bytes: wrongDigest },
      { bytes: wrongActor },
      { bytes: exact },
    ]);
    const { beforeProviderOperation, transport } = createTransport();
    const source = Uint8Array.of(1, 2, 3);
    const candidate = {
      descriptor: descriptor(),
      libraryId,
      receipt: {
        actorId,
        actorPublicKey: "aa".repeat(32) as LibraryCoreEd25519PublicKeyHex,
        canonicalRequestBytes: source,
        createdAt: 1,
        enrollmentRequestDigest,
        state: "pending" as const,
      },
      source,
      storageEpochId,
    };

    await expect(transport.publishEnrollmentRequest(candidate)).resolves.toEqual({
      descriptor: candidate.descriptor,
      transportObjectId: "immutable-1",
    });
    await expect(
      transport.readEnrollmentCertificate({
        actorId,
        enrollmentRequestDigest,
        libraryId,
        storageEpochId,
      }),
    ).resolves.toEqual(exact);

    expect(mocks.putImmutable).toHaveBeenCalledWith({
      descriptor: candidate.descriptor,
      source,
    });
    expect(beforeProviderOperation).toHaveBeenCalledTimes(3);
  });

  it("provisions one normalized intent head and fences every adapter operation", async () => {
    mocks.discoverIntentHead.mockResolvedValue(null);
    mocks.provisionIntentHead.mockResolvedValue({
      created: true,
      intentHeadFileId: "intent-head-2",
    });
    mocks.readHead.mockResolvedValue({ bytes: Uint8Array.of(1), head: {}, revision: "r1" });
    mocks.compareAndSwapHead.mockResolvedValue({ status: "committed" });
    const { beforeProviderOperation, transport } = createTransport();
    const adapter = await transport.openIntentAdapter({
      actorId,
      libraryId,
      nextIntentActorCounter: 1,
      nextResultSequence: 1,
      previousIntentSegmentDigest: null,
      previousResultSegmentDigest: null,
      schemaVersion: 2,
      storageEpochId,
    });
    await adapter.readHead();
    await adapter.putImmutable({ descriptor: descriptor(), source: Uint8Array.of(1) });
    await adapter.verifyImmutable({ descriptor: descriptor(), transportObjectId: "x" });
    await adapter.readImmutable({ descriptor: descriptor(), transportObjectId: "x" });
    await adapter.compareAndSwapHead({ bytes: Uint8Array.of(1), expectedRevision: "r1" });

    expect(mocks.provisionIntentHead).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.objectContaining({
          actor_id: actorId,
          library_id: libraryId,
          protocol: "normalized_intent_head_v2",
          storage_epoch_id: storageEpochId,
        }),
      }),
    );
    expect(mocks.createIntentAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ intentHeadFileId: "intent-head-2" }),
    );
    expect(beforeProviderOperation).toHaveBeenCalledTimes(7);
  });

  it("returns one bounded ordered result reference page", async () => {
    const references = Array.from({ length: 4 }, (_, index) => ({
      firstResultSequence: index + 1,
      lastResultSequence: index + 1,
      reference: {
        descriptor: descriptor(
          (index + 1).toLocaleString("en-US").padStart(64, "0") as LibraryCoreLowercaseHex64,
        ),
        transportObjectId: `result-${(index + 1).toLocaleString("en-US")}`,
      },
    }));
    mocks.discoverResults.mockResolvedValue(references);
    const { beforeProviderOperation, transport } = createTransport();

    await expect(
      transport.pageResultReferences({
        actorId,
        firstResultSequence: 2,
        libraryId,
        limit: 2,
        previousSegmentDigest: null,
        storageEpochId,
      }),
    ).resolves.toEqual({
      done: false,
      references: [references[1]?.reference, references[2]?.reference],
    });
    await transport.resultReader.readImmutable({
      descriptor: references[0]!.reference.descriptor,
      transportObjectId: "result-1",
    });

    expect(beforeProviderOperation).toHaveBeenCalledTimes(2);
  });
});
