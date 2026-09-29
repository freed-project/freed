import { refreshLibraryCoreDesktopRole } from "./library-core-desktop-role";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreNormalizedCheckpointRecordV2,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({
  discoverOperationHead: vi.fn(),
  provisionOperationHead: vi.fn(),
  publishOperations: vi.fn(),
  syncOperations: vi.fn(),
  operationAdapter: {},
  nativeState: null as unknown,
  role: "primary" as "primary" | "follower",
  controlReadFault: null as null | ((token: string) => void),
  controlTokens: [] as string[],
  controlRead: {
    revision: '"etag-1"',
    bytes: new TextEncoder().encode("{}"),
  },
  publishRequest: null as Record<string, unknown> | null,
  publishedRecords: [] as unknown[],
  publishStatus: "committed" as "committed" | "recovered_after_response_loss",
  reassignRequest: null as Record<string, unknown> | null,
  beginNormalizedExport: vi.fn(),
  handoffStatus: vi.fn(),
  stageHandoff: vi.fn(), proposal: vi.fn(), cas: vi.fn(),
  describeCloudIdentity: vi.fn(),
  describeNormalizedCheckpoint: vi.fn(),
  readNormalizedCheckpointPage: vi.fn(),
  beginNormalizedImport: vi.fn(async (input: Record<string, unknown>) => ({
    complete: false,
    expectedRecordCount: input.expectedRecordCount,
    stagedCanonicalBytes: 0,
    stagedRecordCount: 0,
    stageId: input.stageId,
  })),
  appendNormalizedPage: vi.fn(async (input: Record<string, unknown>) => ({
    complete: true,
    expectedRecordCount: 3,
    stagedCanonicalBytes: 1,
    stagedRecordCount: 3,
    stageId: input.stageId,
  })),
  activateNormalizedImport: vi.fn(async (input: Record<string, unknown>) => ({
    authorityEpoch: "cd".repeat(32),
    canonicalBytes: 1,
    checkpointDigest: "67".repeat(32),
    libraryId: "ab".repeat(32),
    recordCount: 3,
    sourceRevision: 9,
    stageId: input.stageId,
  })),
  bootstrapAuthority: {
    authority: {
      library_id: "ab".repeat(32),
      epoch: 1,
      epoch_id: "cd".repeat(32),
      authority_key_id: "de".repeat(32),
      authority_public_key: "ef".repeat(32),
      observed_frontier: [],
    },
    actor: {
      actor_id: "12".repeat(32),
      actor_public_key: "23".repeat(32),
      enrollment_operation_id: "actor-enrolled:fixture",
      enrollment_certificate_digest:
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      canonical_enrollment_certificate_json: "{}",
      actor_chain_genesis: "45".repeat(32),
    },
  },
  readNative: vi.fn(),
  writeNative: vi.fn(),
  setWriterAdmission: vi.fn(async () => ({ configured: true, allowed: true })),
  publish: vi.fn(),
  reassign: vi.fn(),
  stageCheckpoint: vi.fn(),
  importCheckpoint: vi.fn(),
  discoverPublishedControl: vi.fn(),
  discoverEnrollmentRequests: vi.fn(async (): Promise<unknown[]> => []),
  discoverActorEnrollments: vi.fn(async (): Promise<unknown[]> => []),
  followerRuntimeStatus: vi.fn(),
  prepareFollowerActorRequest: vi.fn(),
  installFollowerActorEnrollment: vi.fn(),
  discoverIntentHead: vi.fn(),
  discoverIntentSegments: vi.fn(async (): Promise<unknown[]> => []),
  provisionIntentHead: vi.fn(),
  readIntentHead: vi.fn(),
  publishFollowerIntent: vi.fn(),
  discoverResultHead: vi.fn(async (): Promise<unknown> => null),
  discoverResultSegments: vi.fn(async (): Promise<unknown[]> => []),
  importFollowerResult: vi.fn(),
  prepareFollowerIntent: vi.fn(),
  readResultHead: vi.fn(),
  normalizedFollowerSync: vi.fn(),
  readFollowerTransportContext: vi.fn(),
  pageFollowerTransport: vi.fn(),
  recordNormalizedIntentPublication: vi.fn(),
  importNormalizedResultTransport: vi.fn(),
  createNormalizedFollowerTransport: vi.fn(),
  createNormalizedIntentAdapter: vi.fn(),
  createNormalizedResultAdapter: vi.fn(),
  provisionNormalizedIntentHead: vi.fn(),
  provisionNormalizedResultHead: vi.fn(),
  countersignNormalizedEnrollment: vi.fn(),
  readPrimaryFollowerTransportState: vi.fn(),
  ingestNormalizedFollowerIntents: vi.fn(),
  readPrimaryFollowerResults: vi.fn(),
  handoffResultActors: vi.fn(),
  importNormalizedIntent: vi.fn(),
  importNormalizedResult: vi.fn(),
  publishNormalizedResult: vi.fn(),
  putImmutable: vi.fn(async () => ({ transportObjectId: "immutable-1" })),
  verifyImmutable: vi.fn(async (reference: { descriptor: unknown }) =>
    reference.descriptor
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({
  state: mocks.role === "primary" ? "standalone_primary" : "editable_consumer", role: mocks.role,
  libraryId: "ab".repeat(32), authorityEpochId: "cd".repeat(32), actorId: "12".repeat(32),
})) }));

vi.mock("./native-json-store", () => ({
  readNativeJsonValue: mocks.readNative.mockImplementation(
    async () => mocks.nativeState,
  ),
  writeNativeJsonValue: mocks.writeNative.mockImplementation(
    async (_file: string, _key: string, value: unknown) => {
      mocks.nativeState = value;
    },
  ),
}));

vi.mock("./sqlite-library", () => ({
  readNormalizedLibraryHandoffStatus: mocks.handoffStatus,
  stageNormalizedLibraryTargetHandoff: mocks.stageHandoff,
  prepareNormalizedLibraryHandoffActivation: mocks.proposal,
  describeNormalizedLibraryOperationExport: vi.fn(),
  readNormalizedLibraryOperationPage: vi.fn(),
  importNormalizedLibraryOperationPage: vi.fn(),
  activateNormalizedLibraryCheckpointImport: mocks.activateNormalizedImport,
  appendNormalizedLibraryCheckpointImportPage: mocks.appendNormalizedPage,
  beginNormalizedLibraryCheckpointExport: mocks.beginNormalizedExport,
  beginNormalizedLibraryCheckpointImport: mocks.beginNormalizedImport,
  describeNormalizedLibraryCheckpoint: mocks.describeNormalizedCheckpoint,
  describeNormalizedLibraryCloudIdentity: mocks.describeCloudIdentity,
  countersignNormalizedLibraryFollowerActorRequest:
    mocks.countersignNormalizedEnrollment,
  ingestNormalizedLibraryFollowerIntentPage:
    mocks.ingestNormalizedFollowerIntents,
  installNormalizedLibraryFollowerActorEnrollment:
    mocks.installFollowerActorEnrollment,
  readNormalizedLibraryCheckpointPage: mocks.readNormalizedCheckpointPage,
  readNormalizedPrimaryFollowerActorTransportState:
    mocks.readPrimaryFollowerTransportState,
  readNormalizedPrimaryFollowerResultPage: mocks.readPrimaryFollowerResults,
  readNormalizedLibraryHandoffResultActors: mocks.handoffResultActors,
  prepareNormalizedLibraryFollowerActorRequest:
    mocks.prepareFollowerActorRequest,
  pageNormalizedLibraryFollowerTransport: mocks.pageFollowerTransport,
  readNormalizedLibraryFollowerRuntimeStatus: mocks.followerRuntimeStatus,
  readNormalizedLibraryFollowerTransportContext:
    mocks.readFollowerTransportContext,
  recordNormalizedLibraryFollowerIntentTransportPublication:
    mocks.recordNormalizedIntentPublication,
  importNormalizedLibraryFollowerResultTransport:
    mocks.importNormalizedResultTransport,
  setSqliteLibraryCloudWriterAdmission: mocks.setWriterAdmission,
}));

vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@freed/sync/cloud/library-core")>();
  const normalizedPublicationResult = (
    request: Record<string, unknown>,
    records: readonly unknown[],
  ) => {
    const descriptor = request.descriptor as Record<string, unknown>;
    const generation = Number(request.generation);
    const digest = "67".repeat(32) as LibraryCoreLowercaseHex64;
    const libraryId = String(descriptor.libraryId);
    const storageEpoch = String(descriptor.authorityEpoch);
    const manifest = {
      descriptor: {
        byteLength: 123,
        contentDigest: digest,
        objectKey: createLibraryCoreImmutableObjectKey({
          digest,
          epochId: storageEpoch,
          generation,
          kind: "checkpoint_manifest",
          libraryId,
        }),
      },
      transportObjectId: `manifest-${generation.toLocaleString("en-US")}`,
    };
    return {
      status: mocks.publishStatus,
      revision: '"etag-2"',
      dependencies: [],
      manifest,
      controlPointer: {
        activeTransport: "google_drive_app_data_v1",
        causalFrontierDigest: descriptor.causalFrontierDigest,
        generation,
        libraryId,
        manifest,
        protocolVersion: 1,
        schemaVersion: 1,
        storageEpoch,
        writerId: descriptor.writerId,
      },
      records,
    };
  };
  return {
    ...actual,
    discoverGoogleDriveLibraryCoreOperationHeadV2: mocks.discoverOperationHead,
    provisionGoogleDriveLibraryCoreOperationHeadV2: mocks.provisionOperationHead,
    createGoogleDriveLibraryCoreOperationAdapterV2: () => mocks.operationAdapter,
    publishLibraryCoreNormalizedOperationsOnceV2: mocks.publishOperations,
    syncLibraryCoreNormalizedOperationsOnceV2: mocks.syncOperations,
    discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1:
      mocks.discoverEnrollmentRequests,
    discoverGoogleDriveLibraryCoreActorEnrollmentsV1:
      mocks.discoverActorEnrollments,
    discoverPublishedGoogleDriveLibraryCoreControlV1:
      mocks.discoverPublishedControl,
    discoverGoogleDriveLibraryCoreIntentHeadV1: mocks.discoverIntentHead,
    discoverGoogleDriveLibraryCoreIntentSegmentsV1:
      mocks.discoverIntentSegments,
    provisionGoogleDriveLibraryCoreIntentHeadV1: mocks.provisionIntentHead,
    provisionGoogleDriveLibraryCoreNormalizedIntentHeadV2:
      mocks.provisionNormalizedIntentHead,
    createGoogleDriveLibraryCoreIntentAdapterV1: vi.fn(() => ({
      readIntentHead: mocks.readIntentHead,
    })),
    createGoogleDriveLibraryCoreNormalizedIntentAdapterV2:
      mocks.createNormalizedIntentAdapter,
    createGoogleDriveLibraryCoreNormalizedResultAdapterV2:
      mocks.createNormalizedResultAdapter,
    createGoogleDriveLibraryCoreNormalizedFollowerTransportV2:
      mocks.createNormalizedFollowerTransport,
    publishLibraryCoreIntentCandidateV1: mocks.publishFollowerIntent,
    prepareLibraryCoreIntentSegmentV1: mocks.prepareFollowerIntent,
    discoverGoogleDriveLibraryCoreResultHeadV1: mocks.discoverResultHead,
    discoverGoogleDriveLibraryCoreResultSegmentsV1:
      mocks.discoverResultSegments,
    createGoogleDriveLibraryCoreResultAdapterV1: vi.fn(() => ({
      readResultHead: mocks.readResultHead,
    })),
    importLibraryCoreResultSegmentV1: mocks.importFollowerResult,
    importLibraryCoreNormalizedIntentSegmentV2: mocks.importNormalizedIntent,
    importLibraryCoreNormalizedResultSegmentV2: mocks.importNormalizedResult,
    provisionGoogleDriveLibraryCoreNormalizedResultHeadV2:
      mocks.provisionNormalizedResultHead,
    publishLibraryCoreNormalizedResultSegmentV2:
      mocks.publishNormalizedResult,
    provisionGoogleDriveLibraryCoreControlV1: vi.fn(async () => ({
      controlFileId: "control-1",
      created: true,
    })),
    createGoogleDriveLibraryCoreAdapterV1: vi.fn((input: { accessToken: string }) => ({
      readControl: vi.fn(async () => {
        mocks.controlTokens.push(input.accessToken);
        mocks.controlReadFault?.(input.accessToken);
        return mocks.controlRead;
      }),
      compareAndSwapControl: mocks.cas,
      putImmutable: mocks.putImmutable,
      verifyImmutable: mocks.verifyImmutable,
    })),
    publishLibraryCoreNormalizedCheckpointV2: mocks.publish.mockImplementation(
      async (request: Record<string, unknown>) => {
        mocks.publishRequest = request;
        const records: unknown[] = [];
        for await (const record of request.records as AsyncIterable<unknown>) {
          records.push(record);
        }
        mocks.publishedRecords = records;
        return normalizedPublicationResult(request, records);
      },
    ),
    importLibraryCoreNormalizedCheckpointV2:
      mocks.importCheckpoint.mockImplementation(
        async (request: Record<string, unknown>) => {
          const writer = request.writer as {
            beginImport(input: unknown): Promise<unknown>;
            appendPage(
              pageIndex: number,
              records: readonly unknown[],
            ): Promise<void>;
            finalizeImport(input: unknown): Promise<unknown>;
          };
          const header = {
            format: "freed_normalized_checkpoint_v2",
            protocolVersion: 2,
            registryKey: "00_checkpoint_header",
            primaryKey: "checkpoint",
            payload: {
              authorityEpoch: String(request.storageEpoch),
              checkpointId: `${String(request.libraryId)}:${String(request.storageEpoch)}:9`,
              createdAtMs: 1_000,
              libraryId: String(request.libraryId),
              schemaVersion: 1,
              sourceRevision: 9,
            },
          };
          const manifest = {
            libraryId: String(request.libraryId),
            storageEpoch: String(request.storageEpoch),
            totalRecordCount: 3,
          };
          await writer.beginImport({
            header,
            manifest,
            manifestReference: request.manifest,
          });
          await writer.appendPage(0, [
            header,
            {
              format: "freed_normalized_checkpoint_v2",
              protocolVersion: 2,
              registryKey: "10_feed_item",
              primaryKey: "item-1",
              payload: {
                globalId: "item-1",
                platform: "rss",
              },
            },
            {
              format: "freed_normalized_checkpoint_v2",
              protocolVersion: 2,
              registryKey: "10_feed_item",
              primaryKey: "item-2",
              payload: {
                globalId: "item-2",
                platform: "youtube",
              },
            },
          ]);
          await writer.finalizeImport({
            canonicalBytes: 1,
            checkpointDigest: "67".repeat(32),
            recordCount: 3,
          });
          return {
            activationReceipt: null,
            status: "imported",
            importedPageCount: 1,
            importedRecordCount: 3,
          };
        },
      ),
    stageLibraryCoreNormalizedCheckpointV2: mocks.stageCheckpoint,
    reassignLibraryCoreNormalizedCheckpointV2:
      mocks.reassign.mockImplementation(
        async (request: Record<string, unknown>) => {
          mocks.reassignRequest = request;
          const records: unknown[] = [];
          for await (const record of request.records as AsyncIterable<unknown>) {
            records.push(record);
          }
          mocks.publishedRecords = records;
          return normalizedPublicationResult(request, records);
        },
      ),
    syncLibraryCoreNormalizedFollowerV2: mocks.normalizedFollowerSync,
  };
});

import {
  isSqliteLibraryGoogleDriveSyncEnabled,
  runSqliteLibraryHandoffLifecycle,
  publishCurrentSqliteLibraryToGoogleDrive,
  publishSealedSqliteLibraryCheckpoint,
  stageSqliteLibraryHandoffSource,
  catchUpSqliteLibraryHandoffTarget,
  publishSqliteLibraryHandoffTarget,
  readSqliteLibraryGoogleDrivePublicationReceipt,
  startSqliteLibraryGoogleDriveSync,
  startSqliteLibraryGoogleDriveFollowerSync,
  stopSqliteLibraryCloudSync,
  syncSqliteLibraryFollowerGoogleDriveOnce,
} from "./library-core-cloud-sync";

describe("SQLite Library Google Drive production wiring", () => {
  beforeEach(async () => {
    mocks.controlReadFault = null; mocks.controlTokens = [];
    mocks.handoffStatus.mockReset().mockResolvedValue(null);
    mocks.stageCheckpoint.mockReset();
    mocks.stageHandoff.mockReset(); mocks.proposal.mockReset(); mocks.cas.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request in offline sync test"); }));
    mocks.discoverOperationHead.mockReset().mockResolvedValue(null);
    mocks.provisionOperationHead.mockReset().mockResolvedValue("operation-head");
    mocks.publishOperations.mockReset().mockResolvedValue({ status: "current", revision: 7, continuation: false });
    mocks.syncOperations.mockReset();
    mocks.role = "primary";
    await refreshLibraryCoreDesktopRole();
    stopSqliteLibraryCloudSync();
    window.localStorage.clear();
    mocks.nativeState = null;
    mocks.controlRead = {
      revision: '"etag-1"',
      bytes: new TextEncoder().encode("{}"),
    };
    mocks.publishRequest = null;
    mocks.publishedRecords = [];
    mocks.publishStatus = "committed";
    mocks.reassignRequest = null;
    mocks.publish.mockClear();
    mocks.beginNormalizedExport
      .mockReset()
      .mockImplementation(() => mocks.describeNormalizedCheckpoint());
    mocks.describeNormalizedCheckpoint.mockReset().mockResolvedValue({
      format: "freed_normalized_checkpoint_export_v2",
      protocolVersion: 2,
      libraryId: "ab".repeat(32),
      authorityEpoch: "cd".repeat(32),
      writerId: "12".repeat(32),
      sourceRevision: 7,
      causalFrontierDigest: "66".repeat(32),
      recordCount: 1,
      itemCount: 2,
    });
    mocks.readNormalizedCheckpointPage.mockReset().mockResolvedValue({
      records: [
        createLibraryCoreNormalizedCheckpointRecordV2({
          registryKey: "00_checkpoint_header",
          primaryKey: "checkpoint",
          payload: {
            authorityEpoch: "cd".repeat(32),
            checkpointId: `${"ab".repeat(32)}:${"cd".repeat(32)}:7`,
            createdAtMs: 1_000,
            libraryId: "ab".repeat(32),
            schemaVersion: 1,
            sourceRevision: 7,
          },
        }),
      ],
      nextCursor: {
        registryKey: "00_checkpoint_header",
        primaryKeyJson: '"checkpoint"',
      },
      done: true,
      canonicalRecordBytes: 1,
    });
    mocks.reassign.mockClear();
    mocks.importCheckpoint.mockClear();
    mocks.beginNormalizedImport.mockClear();
    mocks.appendNormalizedPage.mockClear();
    mocks.activateNormalizedImport.mockClear();
    mocks.writeNative.mockClear();
    mocks.readNative
      .mockReset()
      .mockImplementation(async () => mocks.nativeState);
    mocks.setWriterAdmission.mockClear();
    mocks.discoverPublishedControl.mockReset();
    mocks.discoverEnrollmentRequests.mockReset().mockResolvedValue([]);
    mocks.discoverActorEnrollments.mockReset().mockResolvedValue([]);
    mocks.followerRuntimeStatus.mockReset();
    mocks.prepareFollowerActorRequest.mockReset();
    mocks.installFollowerActorEnrollment.mockReset();
    mocks.discoverIntentHead.mockReset();
    mocks.discoverIntentSegments.mockReset().mockResolvedValue([]);
    mocks.provisionIntentHead.mockReset();
    mocks.readIntentHead.mockReset();
    mocks.publishFollowerIntent.mockReset();
    mocks.discoverResultHead.mockReset().mockResolvedValue(null);
    mocks.discoverResultSegments.mockReset().mockResolvedValue([]);
    mocks.importFollowerResult.mockReset();
    mocks.prepareFollowerIntent
      .mockReset()
      .mockImplementation(async (request: Record<string, unknown>) => ({
        body: request,
      }));
    mocks.readResultHead.mockReset();
    mocks.normalizedFollowerSync.mockReset().mockResolvedValue({
      enrollmentState: "enrolled",
      importedResultCount: 0,
      publishedIntentCount: 0,
      recoveredIntentPublication: false,
    });
    mocks.readFollowerTransportContext.mockReset();
    mocks.pageFollowerTransport.mockReset();
    mocks.recordNormalizedIntentPublication.mockReset();
    mocks.importNormalizedResultTransport.mockReset();
    mocks.createNormalizedFollowerTransport.mockReset().mockImplementation(
      () => ({
        async publishEnrollmentRequest(candidate: {
          descriptor: unknown;
        }) {
          return {
            descriptor: candidate.descriptor,
            transportObjectId: "immutable-1",
          };
        },
        async readEnrollmentCertificate(request: {
          actorId: string;
          libraryId: string;
          storageEpochId: string;
        }) {
          const discoverActorEnrollments =
            mocks.discoverActorEnrollments as unknown as (
              input: Record<string, unknown>,
            ) => Promise<Array<{ bytes: Uint8Array }>>;
          const enrollments = await discoverActorEnrollments({
            actorId: request.actorId,
            epochId: request.storageEpochId,
            libraryId: request.libraryId,
          });
          return enrollments[0]?.bytes ?? null;
        },
        async openIntentAdapter(context: {
          actorId: string;
          libraryId: string;
          storageEpochId: string;
        }) {
          const discoverIntentHead = mocks.discoverIntentHead as unknown as (
            input: Record<string, unknown>,
          ) => Promise<{ intentHeadFileId: string } | null>;
          const locator = await discoverIntentHead({
            actorId: context.actorId,
            epochId: context.storageEpochId,
            libraryId: context.libraryId,
          });
          const createNormalizedIntentAdapter =
            mocks.createNormalizedIntentAdapter as unknown as (
              input: Record<string, unknown>,
            ) => unknown;
          return createNormalizedIntentAdapter({
            actorId: context.actorId,
            epochId: context.storageEpochId,
            intentHeadFileId: locator?.intentHeadFileId,
            libraryId: context.libraryId,
          });
        },
        async pageResultReferences(request: {
          actorId: string;
          firstResultSequence: number;
          libraryId: string;
          limit: number;
          storageEpochId: string;
        }) {
          const discoverResultSegments =
            mocks.discoverResultSegments as unknown as (
              input: Record<string, unknown>,
            ) => Promise<
              Array<{
                lastResultSequence: number;
                reference: unknown;
              }>
            >;
          const segments = await discoverResultSegments({
            actorId: request.actorId,
            epochId: request.storageEpochId,
            libraryId: request.libraryId,
          });
          const remaining = segments.filter(
            (segment) =>
              segment.lastResultSequence >= request.firstResultSequence,
          );
          return {
            done: remaining.length <= request.limit,
            references: remaining
              .slice(0, request.limit)
              .map((segment) => segment.reference),
          };
        },
        resultReader: { readImmutable: vi.fn() },
      }),
    );
    mocks.createNormalizedIntentAdapter.mockReset();
    mocks.createNormalizedResultAdapter.mockReset();
    mocks.provisionNormalizedIntentHead.mockReset();
    mocks.provisionNormalizedResultHead.mockReset();
    mocks.countersignNormalizedEnrollment.mockReset();
    mocks.readPrimaryFollowerTransportState.mockReset();
    mocks.ingestNormalizedFollowerIntents.mockReset();
    mocks.handoffResultActors.mockReset().mockResolvedValue([]);
    mocks.readPrimaryFollowerResults.mockReset().mockResolvedValue({
      canonicalRecordBytes: 0,
      done: true,
      nextCursor: null,
      records: [],
    });
    mocks.importNormalizedIntent.mockReset();
    mocks.importNormalizedResult.mockReset();
    mocks.publishNormalizedResult.mockReset();
    mocks.putImmutable
      .mockReset()
      .mockResolvedValue({ transportObjectId: "immutable-1" });
    mocks.verifyImmutable
      .mockReset()
      .mockImplementation(async (reference: { descriptor: unknown }) =>
        reference.descriptor
      );
    mocks.describeCloudIdentity.mockReset().mockResolvedValue({
      format: "freed_normalized_checkpoint_export_v2",
      protocolVersion: 2,
      libraryId: "ab".repeat(32),
      authorityEpoch: "cd".repeat(32),
      writerId: "12".repeat(32),
      sourceRevision: 7,
      causalFrontierDigest: "66".repeat(32),
      recordCount: 1,
      itemCount: 2,
      localActorId: "12".repeat(32),
    });
  });


  it.each(["committed", "proposal-failure", "response-loss", "not-committed", "competing-head", "redirected-proposal", "expired-read", "expired-cas", "canceled-read"] as const)("persists successor proposal before CAS and keeps admission closed: %s", async mode => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: Record<string, unknown>; controlRevision: string } };
    const previous = saved.lastPublishedCheckpoint;
    const canonical = (value: unknown) => new TextDecoder().decode(encodeLibraryCoreCanonicalValue(value as never));
    const trace: string[] = [];
    mocks.controlReadFault = token => { trace.push(`read:${token}`); };
    const epoch = "34".repeat(32), writer = "56".repeat(32), frontier = "78".repeat(32);
    const manifest = { descriptor: { byteLength: 123, contentDigest: "67".repeat(32),
      objectKey: `freed-v2-manifest~${"ab".repeat(32)}~e${epoch}~g0~${"67".repeat(32)}.json` }, transportObjectId: "successor-manifest" };
    const target = { ...previous.controlPointer, storageEpoch: epoch, writerId: writer,
      causalFrontierDigest: frontier, generation: 0, manifest };
    let status = { handoffId: "aa".repeat(32), libraryId: "ab".repeat(32), predecessorEpochId: "cd".repeat(32),
      successorEpochId: epoch, installationRole: "target", phase: "cas_pending", canonicalAuthorization: "consent",
      canonicalAuthorizationBody: canonical({ source_control: previous.controlPointer,
        source_control_revision: previous.controlRevision, source_control_file_id: "control-1", final_source_revision: 7 }), canonicalActivation: null as string | null };
    mocks.handoffStatus.mockImplementation(async () => status);
    mocks.controlRead = { revision: previous.controlRevision, bytes: new TextEncoder().encode(canonical(previous.controlPointer)) };
    mocks.stageHandoff.mockResolvedValue('{}');
    mocks.describeNormalizedCheckpoint.mockResolvedValue({ format: "freed_normalized_checkpoint_export_v2", protocolVersion: 2,
      libraryId: status.libraryId, authorityEpoch: epoch, writerId: writer, causalFrontierDigest: frontier,
      sourceRevision: 7, recordCount: 1, itemCount: 0 });
    mocks.discoverPublishedControl.mockResolvedValue({ controlFileId: "control-1", libraryId: status.libraryId });
    mocks.proposal.mockImplementation(async (_id: string, file: string, bytes: string) => {
      trace.push("proposal");
      if (mode === "proposal-failure") throw new Error("proposal disk full");
      const proposal = canonical({ format: "freed_library_handoff_activation_proposal_v1", handoff_id: status.handoffId,
        control_file_id: file, expected_control_revision: previous.controlRevision, control: JSON.parse(bytes),
        successor_checkpoint_digest: "90".repeat(32) });
      status = { ...status, canonicalActivation: proposal };
      return proposal;
    });
    mocks.cas.mockImplementation(async (change: { bytes: Uint8Array }) => {
      trace.push("cas");
      expect(status.canonicalActivation).not.toBeNull();
      if ((mode === "not-committed" || mode === "expired-cas") && mocks.cas.mock.calls.length === 1) throw new Error("response lost");
      if (mode === "expired-cas" && mocks.cas.mock.calls.length === 2) throw new Error("HTTP 401 expired credential");
      if (mode === "competing-head") {
        mocks.controlRead = { revision: '"competitor"', bytes: new TextEncoder().encode(canonical({ ...target, writerId: "ff".repeat(32) })) };
        throw new Error("response lost");
      }
      mocks.controlRead = { revision: '"winner"', bytes: new Uint8Array(change.bytes) };
      if (["response-loss", "redirected-proposal", "expired-read", "canceled-read"].includes(mode)) throw new Error("response lost");
      return { status: "committed", revision: '"winner"' };
    });
    mocks.reassign.mockImplementationOnce(async (request: Record<string, unknown>) => {
      expect(request.handoffFrontiers).toEqual({ kind: "cooperative_handoff_v1",
        predecessor: previous.controlPointer.causalFrontierDigest, successor: frontier });
      await (request.adapter as { compareAndSwapControl(change: unknown): Promise<unknown> }).compareAndSwapControl({
        expectedRevision: previous.controlRevision, bytes: new TextEncoder().encode(canonical(target)) });
      return { status: "committed", revision: '"winner"', controlPointer: target, manifest, dependencies: [] };
    });
    mocks.setWriterAdmission.mockClear();
    const input = { handoffId: status.handoffId, accessToken: "fixture" };
    if (mode === "committed") await expect(publishSqliteLibraryHandoffTarget(input)).resolves.toMatchObject({ controlRevision: '"winner"' });
    else {
      await expect(publishSqliteLibraryHandoffTarget(input)).rejects.toThrow(mode === "proposal-failure" ? "proposal disk full" : "response lost");
      if (mode !== "proposal-failure") {
        mocks.stageHandoff.mockClear(); mocks.reassign.mockClear();
        if (mode === "redirected-proposal") {
          status = { ...status, canonicalActivation: canonical({ ...JSON.parse(status.canonicalActivation!), control_file_id: "another-control" }) };
          await expect(publishSqliteLibraryHandoffTarget(input)).rejects.toThrow("Persisted activation proposal is invalid");
        } else if (mode === "competing-head") await expect(publishSqliteLibraryHandoffTarget(input)).rejects.toThrow("Another authority change won");
        else if (["expired-read", "expired-cas", "canceled-read"].includes(mode)) {
          const proposal = status.canonicalActivation;
          const controller = new AbortController();
          mocks.controlTokens = [];
          if (mode === "expired-read") mocks.controlReadFault = token => { trace.push(`read:${token}`); if (token === "expired") throw new Error("HTTP 401 expired credential"); };
          if (mode === "canceled-read") mocks.controlReadFault = token => { trace.push(`read:${token}`); controller.abort(); };
          await expect(publishSqliteLibraryHandoffTarget({ ...input, accessToken: "expired", signal: controller.signal })).rejects.toThrow();
          expect(status.canonicalActivation).toBe(proposal);
          expect(status.phase).toBe("cas_pending");
          expect(mocks.cas).toHaveBeenCalledTimes(mode === "expired-cas" ? 2 : 1);
          expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
          mocks.controlReadFault = token => { trace.push(`read:${token}`); };
          await expect(publishSqliteLibraryHandoffTarget({ ...input, accessToken: "refreshed" })).resolves.toMatchObject({ controlRevision: '\"winner\"' });
          expect(mocks.controlTokens).toContain("expired");
          expect(mocks.controlTokens.at(-1)).toBe("refreshed");
          expect(trace).toEqual(mode === "expired-cas"
            ? ["proposal", "cas", "proposal", "read:expired", "cas", "read:expired", "proposal", "read:refreshed", "cas", "read:refreshed"]
            : ["proposal", "cas", "proposal", "read:expired", "proposal", "read:refreshed"]);
          expect(status.canonicalActivation).toBe(proposal);
          expect(status.phase).toBe("cas_pending");
        }
        else await expect(publishSqliteLibraryHandoffTarget(input)).resolves.toMatchObject({ controlRevision: '"winner"' });
        expect(mocks.stageHandoff).not.toHaveBeenCalled(); expect(mocks.reassign).not.toHaveBeenCalled();
        expect(mocks.cas).toHaveBeenCalledTimes(mode === "expired-cas" ? 3 : mode === "not-committed" ? 2 : 1);
      } else expect(mocks.cas).not.toHaveBeenCalled();
    }
    expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
  });

  it.each(["verified", "predecessor", "changed-local", "canceled"] as const)("stages a source successor without activation: %s", async (mode) => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: Record<string, unknown>; controlRevision: string } };
    const pointer = saved.lastPublishedCheckpoint.controlPointer;
    mocks.controlRead = { revision: saved.lastPublishedCheckpoint.controlRevision,
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(pointer as never)) };
    const handoffId = "aa".repeat(32);
    const status = { handoffId, libraryId: "ab".repeat(32), predecessorEpochId: mode === "predecessor" ? pointer.storageEpoch : "99".repeat(32),
      installationRole: "source", phase: "authorized", canonicalAuthorization: "native-grant",
      canonicalAuthorizationBody: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({ source_control_file_id: "control-1" })) };
    mocks.handoffStatus.mockResolvedValue(status);
    const controller = new AbortController();
    mocks.stageCheckpoint.mockImplementation(async () => {
      if (mode === "changed-local") mocks.handoffStatus.mockResolvedValue(null);
      if (mode === "canceled") controller.abort();
      return { stageId: "verified-stage" };
    });
    mocks.activateNormalizedImport.mockClear(); mocks.setWriterAdmission.mockClear(); mocks.publish.mockClear();
    const result = stageSqliteLibraryHandoffSource({ handoffId, accessToken: "fixture", signal: controller.signal });
    if (mode === "verified") {
      await expect(result).resolves.toEqual({ stageId: "verified-stage", canonicalControl: new TextDecoder().decode(encodeLibraryCoreCanonicalValue(pointer as never)) });
      expect(mocks.stageCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ manifest: pointer.manifest, storageEpoch: pointer.storageEpoch }));
    } else if (mode === "canceled") await expect(result).rejects.toMatchObject({ name: "AbortError" });
    else await expect(result).rejects.toThrow(mode === "predecessor" ? "has not published" : "changed during");
    if (mode === "predecessor") expect(mocks.stageCheckpoint).not.toHaveBeenCalled();
    expect(mocks.activateNormalizedImport).not.toHaveBeenCalled();
    expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each(["verified", "changed-head", "lost-local-record"] as const)("imports only consent-bound target state: %s", async (mode) => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: Record<string, unknown>; controlRevision: string } };
    const expected = saved.lastPublishedCheckpoint;
    mocks.controlRead = { revision: mode === "changed-head" ? '"changed"' : expected.controlRevision,
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(expected.controlPointer as never)) };
    const handoffId = "aa".repeat(32);
    const status = { handoffId, libraryId: "ab".repeat(32), predecessorEpochId: "cd".repeat(32),
      installationRole: "target", phase: "preparing", canonicalAuthorization: "native-verified-consent",
      canonicalAuthorizationBody: new TextDecoder().decode(encodeLibraryCoreCanonicalValue({
        source_control: expected.controlPointer, source_control_revision: expected.controlRevision, source_control_file_id: "control-1", final_source_revision: 7,
      } as never)) };
    mocks.handoffStatus.mockResolvedValue(status);
    if (mode === "lost-local-record") mocks.handoffStatus.mockResolvedValueOnce(status).mockResolvedValueOnce(null);
    mocks.discoverPublishedControl.mockResolvedValue({ controlFileId: "control-1", libraryId: status.libraryId });
    mocks.publish.mockClear(); mocks.setWriterAdmission.mockClear(); mocks.describeCloudIdentity.mockClear();
    const result = catchUpSqliteLibraryHandoffTarget({ handoffId, accessToken: "fixture" });
    if (mode === "verified") {
      await expect(result).resolves.toMatchObject({ sourceRevision: 7, libraryId: status.libraryId });
      expect(mocks.importCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ manifest: expected.controlPointer.manifest }));
      expect(mocks.activateNormalizedImport).toHaveBeenCalledWith(expect.objectContaining({ followerReceipt: expect.objectContaining({ controlRevision: expected.controlRevision }) }));
    } else {
      await expect(result).rejects.toThrow(mode === "changed-head" ? "Cloud authority changed" : "continuity could not be verified");
      if (mode === "changed-head") expect(mocks.importCheckpoint).not.toHaveBeenCalled();
    }
    expect(mocks.describeCloudIdentity).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
  });

  it.each(["complete", "failed", "batch_limit", "empty_page"])("flushes durable results before the sealed checkpoint: %s", async (mode) => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: never; controlRevision: string } };
    mocks.controlRead = { revision: saved.lastPublishedCheckpoint.controlRevision,
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(saved.lastPublishedCheckpoint.controlPointer)) };
    const handoffId = "aa".repeat(32), actorId = "34".repeat(32);
    mocks.handoffStatus.mockResolvedValue({ handoffId, libraryId: "ab".repeat(32), predecessorEpochId: "cd".repeat(32),
      installationRole: "source", phase: "sealed", canonicalAuthorizationBody: null });
    mocks.handoffResultActors.mockResolvedValueOnce([actorId]).mockResolvedValue([]);
    mocks.discoverResultHead.mockResolvedValue({ resultHeadFileId: "result-head" });
    mocks.createNormalizedResultAdapter.mockReturnValue({ readHead: async () => ({ head: {
      actor_id: actorId, latest_segment: null, latest_segment_digest: null, library_id: "ab".repeat(32),
      next_result_sequence: 1, protocol: "normalized_result_head_v2", protocol_version: 2, storage_epoch_id: "cd".repeat(32),
    } }) });
    mocks.readPrimaryFollowerResults.mockResolvedValue({ records: mode === "empty_page" ? [] : [{ canonicalResultJson: "{}" }], done: mode !== "batch_limit" && mode !== "empty_page" });
    mocks.publishNormalizedResult.mockResolvedValue({ segmentHeader: { first_result_sequence: 1 } });
    if (mode === "failed") mocks.publishNormalizedResult.mockRejectedValueOnce(new Error("result upload failed"));
    const publish = mocks.publish.getMockImplementation()!;
    mocks.publish.mockClear().mockImplementationOnce(async (request: Record<string, unknown>) => {
      const result = await publish(request);
      mocks.controlRead = { revision: result.revision, bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(result.controlPointer)) };
      return result;
    });
    mocks.ingestNormalizedFollowerIntents.mockClear();
    mocks.discoverEnrollmentRequests.mockClear();
    const operation = publishSealedSqliteLibraryCheckpoint({ accessToken: "fixture", handoffId });
    if (mode === "complete") {
      await operation;
      expect(mocks.publishNormalizedResult.mock.invocationCallOrder[0]).toBeLessThan(mocks.publish.mock.invocationCallOrder[0]);
      expect(mocks.handoffResultActors).toHaveBeenLastCalledWith(handoffId, actorId);
    } else {
      await expect(operation).rejects.toThrow(mode === "failed" ? "result upload failed" : mode === "empty_page" ? "did not advance" : "batch limit");
      expect(mocks.publish).not.toHaveBeenCalled();
      if (mode === "batch_limit") expect(mocks.publishNormalizedResult).toHaveBeenCalledTimes(100);
    }
    expect(mocks.ingestNormalizedFollowerIntents).not.toHaveBeenCalled();
    expect(mocks.discoverEnrollmentRequests).not.toHaveBeenCalled();
  });

  it.each(["verified", "mismatched", "authorized_before_cas"] as const)("publishes a sealed checkpoint without writer admission and requires readback: %s", async (mode) => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: never; controlRevision: string } };
    mocks.controlRead = {
      revision: saved.lastPublishedCheckpoint.controlRevision,
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(saved.lastPublishedCheckpoint.controlPointer)),
    };
    const handoffId = "aa".repeat(32);
    mocks.handoffStatus.mockResolvedValue({
      handoffId, libraryId: "ab".repeat(32), predecessorEpochId: "cd".repeat(32),
      installationRole: "source", phase: "sealed", canonicalAuthorizationBody: null,
    });
    const ordinaryPublish = mocks.publish.getMockImplementation()!;
    mocks.publish.mockImplementationOnce(async (request: Record<string, unknown>) => {
      const result = await ordinaryPublish(request);
      if (mode === "authorized_before_cas") {
        mocks.handoffStatus.mockResolvedValue({ handoffId, installationRole: "source", phase: "authorized" });
        await (request.adapter as { compareAndSwapControl(input: unknown): Promise<unknown> }).compareAndSwapControl({});
      }
      if (mode === "verified") mocks.controlRead = {
        revision: result.revision, bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(result.controlPointer)),
      };
      return result;
    });
    mocks.setWriterAdmission.mockClear();
    mocks.discoverEnrollmentRequests.mockClear();
    mocks.ingestNormalizedFollowerIntents.mockClear();
    mocks.writeNative.mockClear();
    const publication = publishSealedSqliteLibraryCheckpoint({ accessToken: "fixture", handoffId });
    if (mode === "verified") {
      const result = await publication;
      expect(result.controlPointer.generation).toBe(1);
      expect(result.checkpoint.sourceRevision).toBe(7);
      expect(mocks.beginNormalizedExport).toHaveBeenLastCalledWith(handoffId);
      expect(mocks.readNormalizedCheckpointPage).toHaveBeenLastCalledWith(expect.objectContaining({ handoffId }));
      expect(mocks.writeNative).toHaveBeenCalledOnce();
      expect(mocks.nativeState).toEqual(expect.objectContaining({
        writerId: "12".repeat(32), storageEpoch: "cd".repeat(32),
        lastPublishedCheckpoint: expect.objectContaining({ controlPointer: result.controlPointer, controlRevision: result.controlRevision }),
      }));
    } else {
      await expect(publication).rejects.toThrow(mode === "mismatched" ? "cloud head could not be verified" : "sealed, unsigned");
      expect(mocks.writeNative).not.toHaveBeenCalled();
    }
    expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
    expect(mocks.discoverEnrollmentRequests).not.toHaveBeenCalled();
    expect(mocks.ingestNormalizedFollowerIntents).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "authorized", "other_library", "other_frontier"] as const)("recovers a lost final publication receipt only for its cancelled predecessor: %s", async (mode) => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    const saved = mocks.nativeState as { lastPublishedCheckpoint: { controlPointer: never; controlRevision: string } };
    mocks.controlRead = {
      revision: saved.lastPublishedCheckpoint.controlRevision,
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(saved.lastPublishedCheckpoint.controlPointer)),
    };
    const handoffId = "aa".repeat(32);
    const handoff = {
      handoffId, libraryId: "ab".repeat(32), predecessorEpochId: "cd".repeat(32),
      installationRole: "source", phase: "sealed", canonicalAuthorizationBody: null,
      canonicalAuthorization: null, canonicalActivation: null,
    };
    mocks.handoffStatus.mockResolvedValue(handoff);
    const ordinaryPublish = mocks.publish.getMockImplementation()!;
    mocks.publish.mockImplementationOnce(async (request: Record<string, unknown>) => {
      const result = await ordinaryPublish(request);
      mocks.controlRead = { revision: result.revision, bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(result.controlPointer)) };
      return result;
    });
    mocks.writeNative.mockRejectedValueOnce(new Error("fixture disk full"));
    await expect(publishSealedSqliteLibraryCheckpoint({ accessToken: "fixture", handoffId })).rejects.toThrow("fixture disk full");
    expect(mocks.nativeState).toBe(saved);
    mocks.handoffStatus.mockResolvedValue({ ...handoff,
      phase: mode === "authorized" ? "authorized" : "cancelled",
      libraryId: mode === "other_library" ? "ff".repeat(32) : handoff.libraryId,
    });
    if (mode === "other_frontier") {
      const pointer = JSON.parse(new TextDecoder().decode(mocks.controlRead.bytes));
      pointer.causalFrontierDigest = "ff".repeat(32);
      mocks.controlRead.bytes = new Uint8Array(encodeLibraryCoreCanonicalValue(pointer));
    }
    mocks.publish.mockClear();
    const recovery = publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "fixture" });
    if (mode === "cancelled") {
      await expect(recovery).resolves.toEqual({ status: "published", revision: 7 });
      expect(mocks.publish).toHaveBeenCalledOnce();
      expect(mocks.publishRequest?.generation).toBe(2);
      expect(mocks.nativeState).toEqual(expect.objectContaining({
        lastPublishedCheckpoint: expect.objectContaining({ controlPointer: expect.objectContaining({ generation: 2 }) }),
      }));
    } else {
      await expect(recovery).rejects.toThrow("publication receipt does not match");
      expect(mocks.publish).not.toHaveBeenCalled();
    }
  });

  it.each(["authorized", "cancelled", "preparing"])("refuses a new final publication in %s state", async (phase) => {
    const handoffId = "aa".repeat(32);
    mocks.handoffStatus.mockResolvedValue({ handoffId, installationRole: "source", phase, canonicalAuthorizationBody: null });
    await expect(publishSealedSqliteLibraryCheckpoint({ accessToken: "fixture", handoffId })).rejects.toThrow("sealed, unsigned");
    expect(mocks.beginNormalizedExport).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("enables immutable Drive sync by default with an explicit local rollback", () => {
    expect(isSqliteLibraryGoogleDriveSyncEnabled()).toBe(true);
    window.localStorage.setItem(
      "freed.libraryCore.immutableGoogleDriveV1.enabled",
      "0",
    );
    expect(isSqliteLibraryGoogleDriveSyncEnabled()).toBe(false);
  });

  it("starts the shared Primary coordinator through the stable Desktop API", async () => {
    const resolveAccessToken = vi.fn(async () => "refreshed-token");

    await expect(
      startSqliteLibraryGoogleDriveSync({
        accessToken: "initial-token",
        resolveAccessToken,
      }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(resolveAccessToken).not.toHaveBeenCalled();
    stopSqliteLibraryCloudSync();
  });

  it.each(["clean", "string conflict", "Error conflict"])("admits normalized follower transport and publishes signed results with %s enrollment discovery", async (scenario) => {
    const libraryId = "ab".repeat(32);
    const storageEpochId = "cd".repeat(32);
    const actorId = "34".repeat(32);
    const segmentDigest = "56".repeat(32);
    const intentReference = {
      descriptor: {
        byteLength: 128,
        contentDigest: segmentDigest,
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId,
          digest: segmentDigest,
          epochId: storageEpochId,
          firstSequence: 1,
          kind: "intent_segment",
          lastSequence: 1,
          libraryId,
        }),
      },
      transportObjectId: "intent-segment-1",
    };
    const requestNames = scenario === "clean"
      ? ["enrollment-request"]
      : ["conflict-before", "enrollment-request", "conflict-after"];
    mocks.discoverEnrollmentRequests.mockResolvedValue(
      requestNames.map((name) => ({ bytes: new TextEncoder().encode(name) })),
    );
    mocks.countersignNormalizedEnrollment.mockImplementation(async (request: string) => {
      if (request.startsWith("conflict-")) {
        const message = "normalized follower actor replay changed";
        throw scenario === "string conflict" ? message : new Error(message);
      }
      return {
        actorId,
        authorityEpochId: storageEpochId,
        canonicalEnrollmentCertificateJson: "{}",
        libraryId,
      };
    });
    mocks.discoverActorEnrollments.mockResolvedValue([
      {
        bytes: encodeLibraryCoreCanonicalValue({
          certificate_body: {
            actor_enrollment_body: {
              actor_id: actorId,
              epoch_id: storageEpochId,
              library_id: libraryId,
            },
          },
        }),
      },
    ]);
    mocks.readPrimaryFollowerTransportState.mockResolvedValue({
      actorId,
      libraryId,
      nextActorCounter: 1,
      storageEpochId,
    });
    mocks.discoverIntentHead.mockResolvedValue({
      intentHeadFileId: "intent-head-1",
    });
    mocks.createNormalizedIntentAdapter.mockReturnValue({
      readHead: vi.fn(async () => ({
        head: {
          actor_id: actorId,
          latest_segment: intentReference,
          latest_segment_digest: segmentDigest,
          library_id: libraryId,
          next_actor_counter: 2,
          protocol: "normalized_intent_head_v2",
          protocol_version: 2,
          storage_epoch_id: storageEpochId,
        },
        revision: '"intent-etag-1"',
      })),
    });
    mocks.discoverIntentSegments.mockResolvedValue([
      {
        firstIntentSequence: 1,
        lastIntentSequence: 1,
        reference: intentReference,
      },
    ]);
    const stagedEnvelope = { actorCounter: 1, canonicalEnvelopeJson: "{}" };
    mocks.importNormalizedIntent.mockImplementation(
      async (request: Record<string, unknown>) => {
        const writer = request.writer as {
          stageNormalizedIntentSegment(input: {
            canonicalEnvelopes: readonly Uint8Array[];
            envelopes: readonly unknown[];
          }): Promise<void>;
        };
        await writer.stageNormalizedIntentSegment({
          canonicalEnvelopes: [new TextEncoder().encode("{}")],
          envelopes: [stagedEnvelope],
        });
      },
    );
    mocks.discoverResultHead.mockResolvedValue({
      resultHeadFileId: "result-head-1",
    });
    mocks.createNormalizedResultAdapter.mockReturnValue({
      readHead: vi.fn(async () => ({
        head: {
          actor_id: actorId,
          latest_segment: null,
          latest_segment_digest: null,
          library_id: libraryId,
          next_result_sequence: 1,
          protocol: "normalized_result_head_v2",
          protocol_version: 2,
          storage_epoch_id: storageEpochId,
        },
        revision: '"result-etag-1"',
      })),
    });
    mocks.readPrimaryFollowerResults.mockResolvedValue({
      canonicalRecordBytes: 2,
      done: true,
      nextCursor: {
        actorId,
        resultDigest: "78".repeat(32),
        resultSequence: 1,
      },
      records: [{ canonicalResultJson: "{}" }],
    });
    mocks.publishNormalizedResult.mockResolvedValue({
      segmentHeader: { first_result_sequence: 1 },
      status: "recovered_after_response_loss",
    });

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.countersignNormalizedEnrollment).toHaveBeenCalledWith(
      "enrollment-request",
    );
    expect(mocks.putImmutable).toHaveBeenCalledTimes(1);
    expect(mocks.ingestNormalizedFollowerIntents).toHaveBeenCalledWith(
      [stagedEnvelope],
      [new TextEncoder().encode("{}")],
    );
    expect(mocks.publishNormalizedResult).toHaveBeenCalledTimes(1);

    mocks.ingestNormalizedFollowerIntents.mockClear();
    mocks.createNormalizedIntentAdapter.mockReturnValue({
      readHead: vi.fn(async () => ({
        head: {
          actor_id: actorId,
          latest_segment: {
            ...intentReference,
            transportObjectId: "uncommitted-duplicate",
          },
          latest_segment_digest: segmentDigest,
          library_id: libraryId,
          next_actor_counter: 2,
          protocol: "normalized_intent_head_v2",
          protocol_version: 2,
          storage_epoch_id: storageEpochId,
        },
        revision: '"intent-etag-2"',
      })),
    });
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow("normalized intent head references a missing segment");
    expect(mocks.ingestNormalizedFollowerIntents).not.toHaveBeenCalled();
  });

  it("replaces a failed initial Primary coordinator without leaving a stale timer", async () => {
    vi.useFakeTimers();
    try {
      const initialFailure = new Error("Bearer secret-credential-value");
      mocks.publish.mockRejectedValueOnce(initialFailure);

      await expect(
        startSqliteLibraryGoogleDriveSync({
          accessToken: "initial-token",
          resolveAccessToken: async () => "refreshed-token",
        }),
      ).rejects.toBe(initialFailure);
      expect(vi.getTimerCount()).toBe(0);

      stopSqliteLibraryCloudSync();
      expect(vi.getTimerCount()).toBe(0);

      await expect(
        startSqliteLibraryGoogleDriveSync({
          accessToken: "replacement-token",
          resolveAccessToken: async () => "replacement-refreshed-token",
        }),
      ).resolves.toEqual({ status: "published", revision: 7 });
      expect(mocks.publish).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);

      stopSqliteLibraryCloudSync();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.publish).toHaveBeenCalledTimes(2);
    } finally {
      stopSqliteLibraryCloudSync();
      vi.useRealTimers();
    }
  });

  it("retries a failed initial consumer pass at the existing interval and stops cleanly", async () => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();
    vi.useFakeTimers();
    const error = new Error("offline fixture");
    mocks.discoverPublishedControl.mockRejectedValue(error);
    const onError = vi.fn();
    const resolveAccessToken = vi.fn(async () => "refreshed-token");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(startSqliteLibraryGoogleDriveFollowerSync({ accessToken: "initial-token", onError, resolveAccessToken })).rejects.toBe(error);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(mocks.discoverPublishedControl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.discoverPublishedControl).toHaveBeenCalledTimes(2);
      expect(mocks.discoverPublishedControl).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: "refreshed-token" }));
      expect(resolveAccessToken).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      stopSqliteLibraryCloudSync();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.discoverPublishedControl).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stopSqliteLibraryCloudSync();
      vi.useRealTimers();
      consoleError.mockRestore();
    }
  });

  it("keeps a canceled consumer pass owned across lifecycle replacement", async () => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();
    vi.useFakeTimers();
    let finish!: (value: null) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    mocks.discoverPublishedControl.mockImplementationOnce(() => {
      enter();
      return new Promise((resolve) => { finish = resolve; });
    }).mockResolvedValue(null);
    const oldError = vi.fn();
    const newError = vi.fn();
    const resolveAccessToken = vi.fn(async () => "refreshed-token");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const oldPass = startSqliteLibraryGoogleDriveFollowerSync({ accessToken: "old-token", onError: oldError, resolveAccessToken });
      await entered;
      const oldRejected = expect(oldPass).rejects.toMatchObject({ name: "AbortError" });
      const replacement = startSqliteLibraryGoogleDriveFollowerSync({ accessToken: "new-token", onError: newError, resolveAccessToken });
      await expect(replacement).rejects.toMatchObject({ name: "AbortError" });
      await oldRejected;
      expect(oldError).not.toHaveBeenCalled();
      expect(newError).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      await expect(syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "manual-token" })).rejects.toThrow("sync is still finishing");
      expect(mocks.discoverPublishedControl).toHaveBeenCalledTimes(1);
      finish(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.discoverPublishedControl).toHaveBeenCalledTimes(2);
      expect(oldError).not.toHaveBeenCalled();
      expect(newError).toHaveBeenCalledTimes(2);
    } finally {
      finish?.(null);
      await vi.advanceTimersByTimeAsync(0);
      stopSqliteLibraryCloudSync();
      vi.useRealTimers();
      consoleError.mockRestore();
    }
  });

  it("rechecks the Desktop role before any publication work begins", async () => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();

    expect(() =>
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).toThrow("not an active Primary for cloud publication");

    expect(mocks.describeCloudIdentity).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each(["concurrent", "initial-failure", "cancel-before-activation", "authority-recovery"])("imports the Primary checkpoint with owned consumer work (%s)", async (scenario) => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();
    const libraryId = mocks.bootstrapAuthority.authority.library_id;
    const epochId = mocks.bootstrapAuthority.authority.epoch_id;
    const manifestDigest = "56".repeat(32) as LibraryCoreLowercaseHex64;
    const pointer = {
      activeTransport: "google_drive_app_data_v1",
      causalFrontierDigest: "ef".repeat(32),
      generation: 9,
      libraryId,
      manifest: {
        descriptor: {
          byteLength: 123,
          contentDigest: manifestDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: manifestDigest,
            epochId,
            generation: 9,
            kind: "checkpoint_manifest",
            libraryId,
          }),
        },
        transportObjectId: "manifest-9",
      },
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: epochId,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
    };
    const controlBytes = encodeLibraryCoreCanonicalValue(pointer);
    mocks.controlRead = {
      bytes: new Uint8Array(controlBytes),
      revision: '"etag-follower"',
    };
    mocks.discoverPublishedControl.mockResolvedValue({
      control: { bytes: controlBytes },
      controlFileId: "control-1",
      libraryId,
    });
    mocks.followerRuntimeStatus
      .mockResolvedValueOnce({
        state: "awaiting_checkpoint",
        libraryId: null,
        authorityEpochId: null,
        actorId: null,
        checkpointGeneration: null,
        sourceRevision: null,
        pendingIntentCount: 0,
        awaitingCanonicalChanges: false,
        publishedIntentCount: 0,
        importedResultCount: 0,
      })
      .mockResolvedValue({
        state: "awaiting_enrollment",
        libraryId,
        authorityEpochId: epochId,
        actorId: null,
        checkpointGeneration: 9,
        sourceRevision: 9,
        pendingIntentCount: 0,
        awaitingCanonicalChanges: false,
        publishedIntentCount: 0,
        importedResultCount: 0,
      });
    mocks.prepareFollowerActorRequest.mockResolvedValue({
      libraryId,
      authorityEpochId: epochId,
      actorId: "78".repeat(32),
      actorPublicKey: "89".repeat(32),
      enrollmentRequestDigest: "90".repeat(32),
      canonicalEnrollmentRequestJson: "{}",
      createdAt: 1,
    });
    mocks.normalizedFollowerSync.mockImplementation(
      async (transport, runtime) => {
        expect(runtime.prepareEnrollment).toEqual(expect.any(Function));
        const source = Uint8Array.of(1, 2, 3);
        const contentDigest = "90".repeat(32);
        const candidate = {
          descriptor: {
            byteLength: source.byteLength,
            contentDigest,
            objectKey: createLibraryCoreImmutableObjectKey({
              actorId: "78".repeat(32),
              digest: contentDigest,
              epochId,
              kind: "actor_enrollment_request",
              libraryId,
            }),
          },
          libraryId,
          receipt: {
            actorId: "78".repeat(32),
            actorPublicKey: "89".repeat(32),
            canonicalRequestBytes: source,
            createdAt: 1,
            enrollmentRequestDigest: contentDigest,
            state: "pending",
          },
          source,
          storageEpochId: epochId,
        };
        const published = await transport.publishEnrollmentRequest(candidate);
        const certificate = await transport.readEnrollmentCertificate({
          actorId: candidate.receipt.actorId,
          enrollmentRequestDigest: candidate.receipt.enrollmentRequestDigest,
          libraryId: candidate.libraryId,
          storageEpochId: candidate.storageEpochId,
        });
        expect(published.descriptor).toEqual(candidate.descriptor);
        expect(certificate).toBeNull();
        return {
          enrollmentState: "pending",
          importedResultCount: 0,
          publishedIntentCount: 0,
          recoveredIntentPublication: false,
        };
      },
    );

    if (scenario === "authority-recovery") {
      mocks.followerRuntimeStatus.mockResolvedValue({ state: "authority_recovery_required",
        libraryId, authorityEpochId: epochId, actorId: "78".repeat(32), checkpointGeneration: 9,
        sourceRevision: 9, pendingIntentCount: 1, publishedIntentCount: 1, importedResultCount: 0,
        awaitingCanonicalChanges: false });
      mocks.discoverOperationHead.mockResolvedValue("operation-head");
      await expect(syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token" })).resolves.toMatchObject({
        status: "follower_synced", follower: { state: "authority_recovery_required", pendingIntentCount: 1, publishedIntentCount: 1 },
      });
      expect(mocks.importCheckpoint).toHaveBeenCalledOnce();
      expect(mocks.syncOperations).toHaveBeenCalledOnce();
      expect(mocks.normalizedFollowerSync).not.toHaveBeenCalled();
      expect(mocks.prepareFollowerActorRequest).not.toHaveBeenCalled();
      expect(mocks.publishFollowerIntent).not.toHaveBeenCalled();
      return;
    }
    if (scenario === "cancel-before-activation") {
      const controller = new AbortController();
      mocks.appendNormalizedPage.mockImplementationOnce(async (request: Record<string, unknown>) => {
        controller.abort();
        return { complete: true, expectedRecordCount: 3, stagedCanonicalBytes: 1, stagedRecordCount: 3, stageId: request.stageId };
      });
      await expect(syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(mocks.activateNormalizedImport).not.toHaveBeenCalled();
      expect(mocks.normalizedFollowerSync).not.toHaveBeenCalled();
      return;
    }
    if (scenario === "initial-failure") {
      vi.useFakeTimers();
      const error = new Error("offline fixture");
      mocks.discoverPublishedControl.mockRejectedValueOnce(error);
      const onSynced = vi.fn(async () => {});
      try {
        await expect(startSqliteLibraryGoogleDriveFollowerSync({ accessToken: "token", resolveAccessToken: async () => "refreshed-token", onSynced })).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(onSynced).toHaveBeenCalledTimes(1);
        expect(onSynced).toHaveBeenCalledWith(expect.objectContaining({
          status: "follower_synced", follower: expect.objectContaining({ state: "awaiting_enrollment" }),
        }));
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        stopSqliteLibraryCloudSync();
        vi.useRealTimers();
      }
    } else {
      const first = syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token" });
      const second = syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token" });
      expect(second).toBe(first);
      await expect(first).resolves.toEqual(expect.objectContaining({ status: "follower_synced", revision: 7 }));
    }

    expect(mocks.importCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.activateNormalizedImport).toHaveBeenCalledWith({
      followerReceipt: expect.objectContaining({
        checkpointGeneration: 9,
        controlRevision: '"etag-follower"',
        manifestContentDigest: manifestDigest,
        manifestTransportObjectId: "manifest-9",
        writerActorId: mocks.bootstrapAuthority.actor.actor_id,
      }),
      stageId: manifestDigest,
    });
    expect(mocks.normalizedFollowerSync).toHaveBeenCalledTimes(1);
    expect(mocks.discoverActorEnrollments).toHaveBeenCalledWith(
      expect.objectContaining({ epochId, libraryId }),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("publishes a transaction-complete follower intent and records its exact immutable digest", async () => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();
    const libraryId = mocks.bootstrapAuthority.authority.library_id;
    const epochId = mocks.bootstrapAuthority.authority.epoch_id;
    const actorId = "78".repeat(32);
    const manifestDigest = "56".repeat(32) as LibraryCoreLowercaseHex64;
    const segmentDigest = "90".repeat(32) as LibraryCoreLowercaseHex64;
    const pointer = {
      activeTransport: "google_drive_app_data_v1",
      causalFrontierDigest: "ef".repeat(32),
      generation: 9,
      libraryId,
      manifest: {
        descriptor: {
          byteLength: 123,
          contentDigest: manifestDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: manifestDigest,
            epochId,
            generation: 9,
            kind: "checkpoint_manifest",
            libraryId,
          }),
        },
        transportObjectId: "manifest-9",
      },
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: epochId,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
    };
    mocks.controlRead = {
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(pointer)),
      revision: '"etag-follower"',
    };
    mocks.discoverPublishedControl.mockResolvedValue({
      control: { bytes: mocks.controlRead.bytes },
      controlFileId: "control-1",
      libraryId,
    });
    const activeStatus = {
      state: "active",
      libraryId,
      authorityEpochId: epochId,
      actorId,
      checkpointGeneration: 9,
      sourceRevision: 9,
      pendingIntentCount: 1,
        awaitingCanonicalChanges: false,
      publishedIntentCount: 0,
      importedResultCount: 0,
    };
    mocks.followerRuntimeStatus.mockResolvedValue(activeStatus);
    const context = {
      actorId,
      libraryId,
      nextIntentActorCounter: 1,
      nextResultSequence: 1,
      previousIntentSegmentDigest: null,
      previousResultSegmentDigest: null,
      schemaVersion: 2,
      storageEpochId: epochId,
    };
    mocks.readFollowerTransportContext.mockResolvedValue(context);
    mocks.pageFollowerTransport.mockResolvedValue({
      actorId,
      canonicalEnvelopes: [Uint8Array.of(1, 2)],
      done: true,
      firstActorCounter: 1,
      lastActorCounter: 1,
      schemaVersion: 2,
    });
    mocks.discoverIntentHead.mockResolvedValue({
      intentHeadFileId: "intent-head-1",
    });
    const intentAdapter = { readHead: vi.fn() };
    mocks.createNormalizedIntentAdapter.mockReturnValue(intentAdapter);
    const publication = {
      header: {
        actor_id: actorId,
        first_actor_counter: 1,
        last_actor_counter: 1,
        library_id: libraryId,
        previous_segment_digest: null,
        segment_digest: "91".repeat(32),
        storage_epoch_id: epochId,
      },
      publishedAt: 1_000,
      reference: {
        descriptor: {
          byteLength: 2,
          contentDigest: segmentDigest,
          objectKey: "intent-segment-1",
        },
        transportObjectId: "intent-segment-1",
      },
    };
    mocks.normalizedFollowerSync.mockImplementation(
      async (transport, runtime) => {
        const activeContext = await runtime.readContext();
        await runtime.pageIntents({
          actorId,
          firstActorCounter: 1,
          limit: 128,
          schemaVersion: 2,
        });
        await transport.openIntentAdapter(activeContext);
        await runtime.publishIntent(publication);
        return {
          enrollmentState: "enrolled",
          importedResultCount: 0,
          publishedIntentCount: 1,
          recoveredIntentPublication: false,
        };
      },
    );

    await expect(
      syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token" }),
    ).resolves.toEqual(expect.objectContaining({ status: "follower_synced", revision: 7 }));

    expect(mocks.pageFollowerTransport).toHaveBeenCalledWith({
      actorId,
      firstActorCounter: 1,
      limit: 128,
      schemaVersion: 2,
    });
    expect(mocks.createNormalizedIntentAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, epochId, libraryId }),
    );
    expect(mocks.recordNormalizedIntentPublication).toHaveBeenCalledWith(
      publication,
    );
    expect(mocks.importCheckpoint).not.toHaveBeenCalled();
  });

  it("imports the exact follower result chain into the native durable cursor", async () => {
    mocks.role = "follower";
    await refreshLibraryCoreDesktopRole();
    const libraryId = mocks.bootstrapAuthority.authority.library_id;
    const epochId = mocks.bootstrapAuthority.authority.epoch_id;
    const actorId = "78".repeat(32);
    const manifestDigest = "56".repeat(32) as LibraryCoreLowercaseHex64;
    const segmentDigest = "91".repeat(32) as LibraryCoreLowercaseHex64;
    const pointer = {
      activeTransport: "google_drive_app_data_v1",
      causalFrontierDigest: "ef".repeat(32),
      generation: 9,
      libraryId,
      manifest: {
        descriptor: {
          byteLength: 123,
          contentDigest: manifestDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: manifestDigest,
            epochId,
            generation: 9,
            kind: "checkpoint_manifest",
            libraryId,
          }),
        },
        transportObjectId: "manifest-9",
      },
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: epochId,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
    };
    mocks.controlRead = {
      bytes: new Uint8Array(encodeLibraryCoreCanonicalValue(pointer)),
      revision: '"etag-follower"',
    };
    mocks.discoverPublishedControl.mockResolvedValue({
      control: { bytes: mocks.controlRead.bytes },
      controlFileId: "control-1",
      libraryId,
    });
    mocks.followerRuntimeStatus.mockResolvedValue({
      state: "active",
      libraryId,
      authorityEpochId: epochId,
      actorId,
      checkpointGeneration: 9,
      sourceRevision: 9,
      pendingIntentCount: 0,
        awaitingCanonicalChanges: false,
      publishedIntentCount: 1,
      importedResultCount: 0,
    });
    mocks.discoverResultHead.mockResolvedValue({
      resultHeadFileId: "result-head-1",
    });
    mocks.readResultHead.mockResolvedValue({
      head: {
        next_result_sequence: 2,
        latest_segment_digest: segmentDigest,
      },
    });
    const reference = {
      descriptor: { contentDigest: segmentDigest },
      transportObjectId: "result-segment-1",
    };
    mocks.discoverResultSegments.mockResolvedValue([
      {
        firstResultSequence: 1,
        lastResultSequence: 1,
        reference,
      },
    ]);
    const resultPublication = {
      header: { first_result_sequence: 1, last_result_sequence: 1 },
      receivedAt: 1_000,
      reference,
      results: [{ result_sequence: 1 }],
    };
    mocks.normalizedFollowerSync.mockImplementation(
      async (transport, runtime) => {
        const page = await transport.pageResultReferences({
          actorId,
          firstResultSequence: 1,
          libraryId,
          limit: 16,
          previousSegmentDigest: null,
          storageEpochId: epochId,
        });
        expect(page.references).toEqual([reference]);
        await runtime.importResult(resultPublication);
        return {
          enrollmentState: "enrolled",
          importedResultCount: 1,
          publishedIntentCount: 0,
          recoveredIntentPublication: false,
        };
      },
    );

    await expect(
      syncSqliteLibraryFollowerGoogleDriveOnce({ accessToken: "token" }),
    ).resolves.toEqual(expect.objectContaining({ status: "follower_synced", revision: 7 }));

    expect(mocks.importNormalizedResultTransport).toHaveBeenCalledWith(
      resultPublication,
    );
  });

  it("streams the exact SQLite revision into one immutable checkpoint publication", async () => {
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.describeCloudIdentity).toHaveBeenCalledTimes(1);
    const request = mocks.publishRequest;
    expect(request?.generation).toBe(0);
    expect(request?.descriptor).toMatchObject({
      libraryId: mocks.bootstrapAuthority.authority.library_id,
      authorityEpoch: mocks.bootstrapAuthority.authority.epoch_id,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
      sourceRevision: 7,
      recordCount: 1,
    });
    expect(mocks.publishedRecords).toEqual([
      expect.objectContaining({
        format: "freed_normalized_checkpoint_v2",
        registryKey: "00_checkpoint_header",
      }),
    ]);
    expect(mocks.nativeState).toMatchObject({
      version: 2,
      controlFileId: "control-1",
      lastPublishedRevision: 7,
      lastPublishedCheckpoint: {
        version: 1,
        localRevision: 7,
        itemCount: 2,
        checkpointStoredByteLength: 123,
        controlRevision: '"etag-2"',
        controlPointer: {
          generation: 0,
          manifest: {
            descriptor: { contentDigest: "67".repeat(32) },
            transportObjectId: "manifest-0",
          },
        },
      },
    });
    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toMatchObject({
      localRevision: 7,
      itemCount: 2,
      checkpointStoredByteLength: 123,
      controlRevision: '"etag-2"',
      controlPointer: {
        generation: 0,
        manifest: { transportObjectId: "manifest-0" },
      },
    });
  });

  it.each(["current", "published"] as const)("uses verified operation publication for a %s checkpoint anchor", async (status) => {
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    const checkpoint = (
      mocks.nativeState as {
        lastPublishedCheckpoint: {
          controlPointer: unknown;
          controlRevision: string;
        };
      }
    ).lastPublishedCheckpoint;
    const controlBytes = encodeLibraryCoreCanonicalValue(
      checkpoint.controlPointer as never,
    );
    const exactControlBytes = new Uint8Array(controlBytes.byteLength);
    exactControlBytes.set(controlBytes);
    mocks.controlRead = {
      revision: checkpoint.controlRevision,
      bytes: exactControlBytes,
    };

    const revision = status === "current" ? 7 : 8;
    mocks.publishOperations.mockImplementation(async (input) => {
      await input.assertCurrentAuthority();
      expect(input.anchor).toMatchObject({ checkpointRevision: 7 });
      expect(input.transport).toBe(mocks.operationAdapter);
      return { status, revision, continuation: false };
    });
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status, revision });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.nativeState).toMatchObject({ lastPublishedRevision: 7, lastPublishedOperationRevision: revision });
  });

  it("fails closed when a local current marker does not match Drive control", async () => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(
      "Stored Library Core publication receipt does not match Drive control",
    );
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("persists the exact receipt after a lost Drive commit response is recovered", async () => {
    mocks.publishStatus = "recovered_after_response_loss";

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toMatchObject({
      localRevision: 7,
      itemCount: 2,
      checkpointStoredByteLength: 123,
      controlRevision: '"etag-2"',
      controlPointer: {
        generation: 0,
        manifest: {
          descriptor: { contentDigest: "67".repeat(32) },
          transportObjectId: "manifest-0",
        },
      },
    });
  });

  it("reuses normalized persisted identity and chains the previous manifest", async () => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
    mocks.describeCloudIdentity.mockResolvedValue({
      format: "freed_normalized_checkpoint_export_v2",
      protocolVersion: 2,
      libraryId: "ab".repeat(32),
      authorityEpoch: "cd".repeat(32),
      writerId: "12".repeat(32),
      sourceRevision: 8,
      causalFrontierDigest: "68".repeat(32),
      recordCount: 1,
      itemCount: 2,
      localActorId: "12".repeat(32),
    });
    mocks.describeNormalizedCheckpoint.mockResolvedValue({
      format: "freed_normalized_checkpoint_export_v2",
      protocolVersion: 2,
      libraryId: "ab".repeat(32),
      authorityEpoch: "cd".repeat(32),
      writerId: "12".repeat(32),
      sourceRevision: 8,
      causalFrontierDigest: "68".repeat(32),
      recordCount: 1,
      itemCount: 2,
    });
    mocks.readNormalizedCheckpointPage.mockResolvedValue({
      records: [
        createLibraryCoreNormalizedCheckpointRecordV2({
          registryKey: "00_checkpoint_header",
          primaryKey: "checkpoint",
          payload: {
            authorityEpoch: "cd".repeat(32),
            checkpointId: `${"ab".repeat(32)}:${"cd".repeat(32)}:8`,
            createdAtMs: 1_001,
            libraryId: "ab".repeat(32),
            schemaVersion: 1,
            sourceRevision: 8,
          },
        }),
      ],
      nextCursor: {
        registryKey: "00_checkpoint_header",
        primaryKeyJson: '"checkpoint"',
      },
      done: true,
      canonicalRecordBytes: 1,
    });

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 8 });

    expect(mocks.publishRequest?.descriptor).toMatchObject({
      sourceRevision: 8,
      causalFrontierDigest: "68".repeat(32),
    });
  });

  it("rejects a stored receipt that is not bound to its local revision", async () => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
    const stored = mocks.nativeState as {
      lastPublishedCheckpoint: Record<string, unknown>;
    };
    mocks.nativeState = {
      ...(mocks.nativeState as Record<string, unknown>),
      lastPublishedCheckpoint: {
        ...stored.lastPublishedCheckpoint,
        localRevision: 8,
      },
    };

    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toBeNull();
  });

  it("refuses to replace a mismatched cloud identity that published a revision", async () => {
    mocks.nativeState = {
      version: 2,
      libraryId: "01".repeat(32),
      storageEpoch: "02".repeat(32),
      writerId: "03".repeat(32),
      controlFileId: "published-control",
      lastPublishedRevision: 0,
      lastPublishedActorDigest: null,
    };

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(
      "load local writer authority failed: The saved Library Core cloud identity belongs to another Library",
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.writeNative).not.toHaveBeenCalled();
  });

  it.each([
    "normalized follower actor countersignature failed",
    "normalized follower enrollment authority changed concurrently",
    "database is locked",
    "normalized follower actor replay changed unexpectedly",
    Object.assign(new Error("normalized follower actor replay changed"), { name: "AbortError" }),
  ])("stops enrollment discovery on unrelated refusal: %s", async (reason) => {
    mocks.discoverEnrollmentRequests.mockResolvedValue([
      { bytes: new TextEncoder().encode("enrollment-request") },
      { bytes: new TextEncoder().encode("later-request") },
    ]);
    mocks.countersignNormalizedEnrollment.mockRejectedValueOnce(reason);
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(reason instanceof Error ? reason.message : `countersign follower enrollment failed: ${reason}`);
    expect(mocks.countersignNormalizedEnrollment).toHaveBeenCalledTimes(1);
    expect(mocks.putImmutable).not.toHaveBeenCalled();
    expect(mocks.discoverActorEnrollments).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("preserves a native string rejection with its publication stage", async () => {
    mocks.describeCloudIdentity.mockRejectedValueOnce(
      "SQLite Library could not read its authority key",
    );

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(
      "read local SQLite revision failed: SQLite Library could not read its authority key",
    );

    for (const [operation, stage] of [
      [mocks.setWriterAdmission, "persist verified writer admission"],
      [mocks.discoverEnrollmentRequests, "discover follower enrollment requests"],
      [mocks.beginNormalizedExport, "prepare checkpoint snapshot"],
    ] as const) {
      operation.mockRejectedValueOnce("diagnostic boundary failure");
      await expect(
        publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      ).rejects.toThrow(`${stage} failed: diagnostic boundary failure`);
    }
  });

  it("coalesces overlapping publication requests before opening the singleton native export", async () => {
    // Scheduled and manual entry points share this function. Separate exports
    // replace the native cursor even when both describe the same revision.
    await Promise.all([
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ]);

    expect(mocks.beginNormalizedExport).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("keeps a canceled native export owned until it settles", async () => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let finishExport!: (value: unknown) => void;
    const nativeExport = new Promise<unknown>((resolve) => {
      finishExport = resolve;
    });
    mocks.beginNormalizedExport.mockImplementationOnce(() => {
      enter();
      return nativeExport;
    });
    const controller = new AbortController();
    const canceled = publishCurrentSqliteLibraryToGoogleDrive({
      accessToken: "token",
      signal: controller.signal,
    });
    await entered;
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });

    try {
      await expect(
        publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      ).rejects.toThrow("checkpoint export is still finishing");
      expect(mocks.beginNormalizedExport).toHaveBeenCalledTimes(1);
      expect(mocks.publish).not.toHaveBeenCalled();
    } finally {
      finishExport(await mocks.describeNormalizedCheckpoint());
    }
    // Drain the native response and its ownership-release microtasks.
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });
    expect(mocks.beginNormalizedExport).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("reports a timed-out native export without releasing its ownership early", async () => {
    vi.useFakeTimers();
    let finishExport!: (value: unknown) => void;
    mocks.beginNormalizedExport.mockImplementationOnce(() => new Promise((resolve) => {
      finishExport = resolve;
    }));
    try {
      const pending = publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
      const rejected = expect(pending).rejects.toThrow("total time budget");
      await vi.advanceTimersByTimeAsync(300_000);
      await rejected;
      await expect(
        publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      ).rejects.toThrow("checkpoint export is still finishing");
      expect(mocks.publish).not.toHaveBeenCalled();
      finishExport(await mocks.describeNormalizedCheckpoint());
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(
        publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      ).resolves.toEqual({ status: "published", revision: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])("credits only exactly verified publication receipts (matching=%s)", async (matching) => {
    vi.useFakeTimers();
    const descriptor = await mocks.describeNormalizedCheckpoint();
    mocks.describeNormalizedCheckpoint.mockResolvedValue({ ...descriptor, recordCount: 100_000 });
    const receiptDescriptor = {
      objectKey: "checkpoint-page-1", contentDigest: "67".repeat(32), byteLength: 10,
    };
    mocks.verifyImmutable.mockResolvedValueOnce({
      ...receiptDescriptor, byteLength: matching ? 10 : 11,
    });
    const publishImmediately = mocks.publish.getMockImplementation()!;
    mocks.publish.mockImplementationOnce(async (request: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 240_000));
      const adapter = request.adapter as { verifyImmutable(receipt: unknown): Promise<unknown> };
      await adapter.verifyImmutable({ descriptor: receiptDescriptor, transportObjectId: "page-1" });
      await new Promise((resolve) => setTimeout(resolve, 120_000));
      return publishImmediately({ ...request, records: [] });
    });
    try {
      const pending = publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
      const outcome = matching
        ? expect(pending).resolves.toEqual({ status: "published", revision: 7 })
        : expect(pending).rejects.toThrow("no checkpoint progress");
      await vi.advanceTimersByTimeAsync(360_000);
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a late successful publisher response before recording local acceptance", async () => {
    const publishImmediately = mocks.publish.getMockImplementation()!;
    const clock = vi.spyOn(performance, "now");
    mocks.publish.mockImplementationOnce(async (request: Record<string, unknown>) => {
      const result = await publishImmediately(request);
      clock.mockReturnValue(performance.now() + 400_000);
      return result;
    });
    try {
      await expect(
        publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
      ).rejects.toThrow("total time budget");
      expect(mocks.setWriterAdmission).not.toHaveBeenCalled();
      expect(mocks.nativeState).not.toMatchObject({ lastPublishedRevision: 7 });
    } finally {
      clock.mockRestore();
    }
  });

  it("waits for cancelled sync ownership before native handoff and rejects ordinary sync while paused", async () => {
    const { pauseDesktopOperationsForHandoff } = await import("./factory-reset-guard");
    const descriptor = await mocks.describeCloudIdentity();
    let finish!: (value: unknown) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    mocks.describeCloudIdentity.mockImplementationOnce(() => {
      enter();
      return new Promise((resolve) => { finish = resolve; });
    });
    const publication = publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
    const rejected = expect(publication).rejects.toMatchObject({ name: "AbortError" });
    await entered;
    const pause = pauseDesktopOperationsForHandoff();
    const nativeWork = vi.fn(async () => "sealed");
    try {
      const handoff = runSqliteLibraryHandoffLifecycle(nativeWork);
      await rejected;
      expect(nativeWork).not.toHaveBeenCalled();
      await expect(publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" })).rejects.toThrow("pausing ordinary synchronization");
      finish(descriptor);
      await expect(handoff).resolves.toBe("sealed");
      expect(nativeWork).toHaveBeenCalledOnce();
      expect(mocks.publish).not.toHaveBeenCalled();
    } finally {
      finish(descriptor);
      pause.resume();
    }
  });

  it("retains canceled native preflight ownership until the command settles", async () => {
    const controller = new AbortController();
    const descriptor = await mocks.describeCloudIdentity();
    let finish!: (value: unknown) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    mocks.describeCloudIdentity.mockImplementationOnce(() => {
      enter();
      return new Promise((resolve) => { finish = resolve; });
    });
    const canceled = publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token", signal: controller.signal });
    await entered;
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    try {
      await expect(publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" })).rejects.toThrow("sync is still finishing");
      expect(mocks.publish).not.toHaveBeenCalled();
    } finally {
      finish(descriptor);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" })).resolves.toEqual({ status: "published", revision: 7 });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("refuses cloud publication when restored state belongs to another Desktop installation", async () => {
    mocks.nativeState = {
      version: 2,
      libraryId: "ab".repeat(32),
      storageEpoch: "cd".repeat(32),
      writerId: "34".repeat(32),
      controlFileId: "control-1",
      lastPublishedRevision: 6,
    };
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({
      status: "ownership_required",
      currentWriterId: "34".repeat(32),
      localWriterId: mocks.bootstrapAuthority.actor.actor_id,
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.writeNative).not.toHaveBeenCalled();
    expect(mocks.setWriterAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        activeWriterId: "34".repeat(32),
        localWriterId: mocks.bootstrapAuthority.actor.actor_id,
      }),
    );
  });

});
