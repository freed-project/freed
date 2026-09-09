import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreIntentHeadObjectKey,
  createLibraryCoreResultHeadObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
import { prepareLibraryCoreNormalizedIntentSegmentV2 } from "@freed/sync/cloud/library-core";
import capabilityVectors from "../../shared/src/library-core/actor-capability-certificate-v2-vectors.json" with { type: "json" };
import type { LibraryServicePrimaryCloudPortV1 } from "./primary-cloud-runtime.js";

const hooks = vi.hoisted(() => ({
  publication: null as null | {
    refreshInbound(input: unknown): Promise<void>;
  },
}));

vi.mock("./google-drive-publication.js", () => ({
  createBoundGoogleDrivePublicationStatePortV1: vi.fn(),
  createLibraryServiceGoogleDrivePublicationV1(
    options: typeof hooks.publication,
  ) {
    hooks.publication = options;
    return {};
  },
}));
vi.mock("./node-google-drive-token.js", () => ({
  createNodeGoogleDriveTokenPortV1: vi.fn(),
}));
vi.mock("./primary-runtime.js", () => ({
  createLibraryServicePrimaryRuntimeV1: () => ({
    start: async () => undefined,
  }),
}));

import { createNodeLibraryServicePrimaryCloudPortV1 } from "./primary-cloud-runtime.js";

afterEach(() => vi.unstubAllGlobals());

describe("default Primary cloud composition", () => {
  it("enrolls, imports an intent and publishes its result through the default transport", async () => {
    const vector = capabilityVectors.vectors[0]!;
    const certificate = vector.certificate;
    const actorId = certificate.certificate_body.actor_enrollment_body.actor_id;
    const libraryId = vector.authority_state.library_id;
    const epochId = vector.authority_state.epoch_id;
    const hash = (value: string | Uint8Array) =>
      createHash("sha256").update(value).digest("hex");
    type File = {
      id: string;
      name: string;
      bytes: Uint8Array;
      appProperties: Record<string, string>;
    };
    const files: File[] = [];
    const immutable = (
      id: string,
      bytes: Uint8Array,
      kind: "actor_enrollment" | "actor_enrollment_request",
    ): File => {
      const digest = hash(bytes);
      const name = createLibraryCoreImmutableObjectKey({
        actorId,
        libraryId,
        epochId,
        digest,
        kind,
      });
      return {
        id,
        name,
        bytes,
        appProperties: {
          freedProtocol: "library-core-v1",
          freedLibraryDigest: hash(libraryId),
          freedObjectKind:
            kind === "actor_enrollment" ? "enrollment" : "enrollment_request",
          freedObjectKeyDigest: hash(name),
          freedContentDigest: digest,
        },
      };
    };
    const requestBytes = encodeLibraryCoreCanonicalValue({
      certificate_body: certificate.certificate_body,
      certificate_digest: certificate.certificate_digest,
    });
    const certificateBytes = encodeLibraryCoreCanonicalValue(certificate);
    files.push(
      immutable("request-1", requestBytes, "actor_enrollment_request"),
    );
    // These envelopes test transport composition, not cryptographic admission.
    // Native signature and atomic mutation proofs live in the Rust suite.
    const intentBytes = encodeLibraryCoreCanonicalValue({
      actor_chain_digest: "a".repeat(64),
      actor_id: actorId,
      actor_sequence: 1,
      blob_references: [],
      causal_frontier: [],
      created_at_ms: 1,
      entity_id: "item-1",
      entity_type: "FeedItem",
      epoch: 1,
      epoch_id: epochId,
      hlc_counter: 0,
      hlc_wall_ms: 1,
      library_id: libraryId,
      operation_id: "operation-1",
      operation_type: "feed_item_read_assignment",
      payload: { read_at_ms: 1 },
      payload_digest: "b".repeat(64),
      previous_actor_chain_digest: vector.actor_chain_genesis,
      previous_actor_operation_id: null,
      schema_version: 1,
      signature: "d".repeat(128),
      signature_algorithm: "ed25519",
      transaction_digest: "e".repeat(64),
      transaction_id: "transaction-1",
      transaction_member_count: 1,
      transaction_member_index: 0,
    });
    const intent = await prepareLibraryCoreNormalizedIntentSegmentV2({
      actorId,
      libraryId,
      storageEpochId: epochId,
      previousSegmentDigest: null,
      canonicalEnvelopes: [intentBytes],
      subtle: crypto.subtle,
    });
    const segmentBytes = intent.object.source;
    const intentReference = {
      descriptor: { ...intent.object.descriptor },
      transportObjectId: "intent-segment",
    };
    files.push({
      id: "intent-segment",
      name: intent.object.descriptor.objectKey,
      bytes: segmentBytes,
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: hash(libraryId),
        freedObjectKind: "intents",
        freedObjectKeyDigest: hash(intent.object.descriptor.objectKey),
        freedContentDigest: intent.object.descriptor.contentDigest,
      },
    });
    files.push({
      id: "intent-head",
      name: createLibraryCoreIntentHeadObjectKey(libraryId, epochId, actorId),
      bytes: encodeLibraryCoreCanonicalValue({
        actor_id: actorId,
        library_id: libraryId,
        storage_epoch_id: epochId,
        protocol: "normalized_intent_head_v2",
        protocol_version: 2,
        next_actor_counter: 2,
        latest_segment: intentReference,
        latest_segment_digest: intent.object.descriptor.contentDigest,
      }),
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: hash(libraryId),
        freedObjectKind: "intent_head",
        freedEpochDigest: hash(epochId),
        freedActorDigest: hash(actorId),
      },
    });
    const resultBytes = encodeLibraryCoreCanonicalValue({
      actor_id: actorId,
      authoritative_source_revision: 8,
      authority_key_id: "6".repeat(64),
      canonical_operation_ids: ["operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
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
      transaction_digest: "e".repeat(64),
      transaction_id: "transaction-1",
    });
    files.push({
      id: "result-head",
      name: createLibraryCoreResultHeadObjectKey(libraryId, epochId, actorId),
      bytes: encodeLibraryCoreCanonicalValue({
        actor_id: actorId,
        library_id: libraryId,
        storage_epoch_id: epochId,
        protocol: "normalized_result_head_v2",
        protocol_version: 2,
        next_result_sequence: 1,
        latest_segment: null,
        latest_segment_digest: null,
      }),
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: hash(libraryId),
        freedObjectKind: "result_head",
        freedEpochDigest: hash(epochId),
        freedActorDigest: hash(actorId),
      },
    });
    const metadata = (file: File) => ({
      id: file.id,
      name: file.name,
      size: String(file.bytes.byteLength),
      appProperties: file.appProperties,
      etag: '"revision-1"',
    });
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(signal);
        const url = new URL(String(input));
        if (init?.method === "POST") {
          expect(url.pathname).toBe("/upload/drive/v3/files");
          expect(init.body).toBeInstanceOf(Blob);
          const multipart = Buffer.from(
            await (init.body as Blob).arrayBuffer(),
          );
          const boundary = multipart
            .subarray(0, multipart.indexOf("\r\n"))
            .toString();
          const metadataStart = multipart.indexOf("\r\n\r\n") + 4;
          const separator = multipart.indexOf(`\r\n${boundary}`, metadataStart);
          const uploaded = JSON.parse(
            multipart.subarray(metadataStart, separator).toString(),
          );
          const bytesStart = multipart.indexOf("\r\n\r\n", separator) + 4;
          const bytesEnd = multipart.lastIndexOf(`\r\n${boundary}--`);
          const file: File = {
            id: `uploaded-${files.length}`,
            name: uploaded.name,
            appProperties: uploaded.appProperties,
            bytes: new Uint8Array(multipart.subarray(bytesStart, bytesEnd)),
          };
          files.push(file);
          return Response.json(metadata(file));
        }
        if (init?.method === "PUT") {
          expect(url.pathname).toBe("/upload/drive/v2/files/result-head");
          expect(new Headers(init.headers).get("If-Match")).toBe(
            '"revision-1"',
          );
          files.find((file) => file.id === "result-head")!.bytes =
            new Uint8Array(init.body as ArrayBuffer);
          return Response.json({ id: "result-head", etag: '"revision-1"' });
        }
        expect(init?.method ?? "GET").toBe("GET");
        if (url.pathname === "/drive/v3/files") {
          const properties = [
            ...(url.searchParams.get("q") ?? "").matchAll(
              /appProperties has \{ key='([^']+)' and value='([^']*)' \}/gu,
            ),
          ];
          return Response.json({
            files: files
              .filter((file) =>
                properties.every(
                  (match) => file.appProperties[match[1]!] === match[2],
                ),
              )
              .map(metadata),
          });
        }
        const file = files.find((candidate) =>
          url.pathname.endsWith(`/${candidate.id}`),
        );
        if (!file)
          throw new Error(
            `unexpected synthetic Drive request: ${url.pathname}`,
          );
        return url.searchParams.get("alt") === "media"
          ? new Response(file.bytes.slice().buffer, {
              headers: { ETag: '"revision-1"' },
            })
          : Response.json(metadata(file), {
              headers: { ETag: '"revision-1"' },
            });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const descriptor = {
      authorityEpoch: epochId,
      causalFrontierDigest: "d".repeat(64),
      format: "freed_normalized_checkpoint_export_v2",
      itemCount: 0,
      libraryId,
      protocolVersion: 2,
      recordCount: 0,
      sourceRevision: 7,
      writerId: "c".repeat(64),
    };
    let nextActorCounter = 1;
    const execute = vi.fn(async (command: string, payload: unknown) => {
      if (command === "describe_checkpoint_export_v2") return descriptor;
      if (command === "countersign_follower_actor_request_v2") {
        expect(payload).toMatchObject({
          canonicalEnrollmentRequestJson: new TextDecoder().decode(
            requestBytes,
          ),
        });
        return {
          actorChainGenesis: vector.actor_chain_genesis,
          actorId,
          actorPublicKey: vector.actor_public_key_hex,
          authorityEpochId: epochId,
          canonicalEnrollmentCertificateJson: new TextDecoder().decode(
            certificateBytes,
          ),
          enrolledAt: 1_000,
          enrollmentCertificateDigest: certificate.certificate_digest,
          libraryId,
        };
      }
      if (command === "primary_follower_actor_transport_state_v1")
        return {
          actorId,
          libraryId,
          nextActorCounter,
          storageEpochId: epochId,
        };
      if (command === "ingest_follower_intent_page_v1") {
        expect(payload).toMatchObject({
          page: {
            records: [
              {
                actorCounter: 1,
                canonicalEnvelopeJson: new TextDecoder().decode(intentBytes),
              },
            ],
          },
        });
        nextActorCounter = 2;
        return {
          exactRetries: 0,
          pendingTransactions: 0,
          resolvedRecords: 1,
          resolvedTransactions: 1,
          stagedRecords: 1,
        };
      }
      if (command === "export_follower_result_page_v2") {
        expect(nextActorCounter).toBe(2);
        const first = (payload as { firstResultSequence: number })
          .firstResultSequence;
        return {
          canonicalRecordBytes: first === 1 ? resultBytes.byteLength : 0,
          done: true,
          nextCursor: {
            actorId,
            resultSequence: 1,
            resultDigest: "7".repeat(64),
          },
          records:
            first === 1
              ? [
                  {
                    actorId,
                    authoritativeSourceRevision: 8,
                    authorityEpochId: epochId,
                    canonicalResultJson: new TextDecoder().decode(resultBytes),
                    enqueuedAt: 1,
                    intentEpochId: epochId,
                    originalResultDigest: null,
                    previousResultDigest: null,
                    rejectionReason: null,
                    resultDigest: "7".repeat(64),
                    resultSequence: 1,
                    status: "accepted",
                    transactionDigest: "e".repeat(64),
                    transactionId: "transaction-1",
                  },
                ]
              : [],
        };
      }
      throw new Error(`unexpected native command: ${command}`);
    });
    await createNodeLibraryServicePrimaryCloudPortV1().start({
      config: {
        credentialRecordId: "synthetic-record",
        installationWitness: "e".repeat(64),
      },
      clock: { nowMs: () => 1_000 },
      native: { execute },
      stateFile: {},
      fileSystem: {},
    } as unknown as Parameters<LibraryServicePrimaryCloudPortV1["start"]>[0]);
    await hooks.publication!.refreshInbound({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      descriptor,
      signal,
    });
    expect(
      files.filter(
        (file) => file.appProperties.freedObjectKind === "enrollment",
      ),
    ).toHaveLength(1);
    expect(execute.mock.calls.map(([command]) => command)).toContain(
      "export_follower_result_page_v2",
    );
    await hooks.publication!.refreshInbound({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      descriptor,
      signal,
    });
    expect(
      execute.mock.calls.filter(
        ([command]) => command === "countersign_follower_actor_request_v2",
      ),
    ).toHaveLength(1);
    expect(
      execute.mock.calls.filter(
        ([command]) => command === "ingest_follower_intent_page_v1",
      ),
    ).toHaveLength(1);
    expect(
      files.filter((file) => file.appProperties.freedObjectKind === "results"),
    ).toHaveLength(1);
    expect(
      files.find((file) => file.appProperties.freedObjectKind === "enrollment")!
        .bytes,
    ).toEqual(certificateBytes);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(1);
    expect(
      decodeLibraryCoreCanonicalValue(
        files.find((file) => file.id === "result-head")!.bytes,
      ),
    ).toMatchObject({
      next_result_sequence: 2,
      latest_segment: { transportObjectId: expect.any(String) },
    });
  });
  it("constructs the default Drive transport without a supplied transport object", async () => {
    const descriptor = {
      authorityEpoch: "b".repeat(64),
      causalFrontierDigest: "d".repeat(64),
      format: "freed_normalized_checkpoint_export_v2",
      itemCount: 0,
      libraryId: "a".repeat(64),
      protocolVersion: 2,
      recordCount: 0,
      sourceRevision: 7,
      writerId: "c".repeat(64),
    };
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(signal);
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const execute = vi.fn(async () => descriptor);
    await createNodeLibraryServicePrimaryCloudPortV1().start({
      config: {
        credentialRecordId: "synthetic-record",
        installationWitness: "e".repeat(64),
      },
      clock: { nowMs: () => 1_000 },
      native: { execute },
      stateFile: {},
      fileSystem: {},
    } as unknown as Parameters<LibraryServicePrimaryCloudPortV1["start"]>[0]);

    // Publication authority is covered by its own suite. Exercise the real
    // composition's admitted callback without vault access or live HTTP.
    expect(hooks.publication?.refreshInbound).toBeTypeOf("function");
    await hooks.publication!.refreshInbound({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      descriptor,
      signal,
    });
    expect(execute).toHaveBeenCalledWith("describe_checkpoint_export_v2", {});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
