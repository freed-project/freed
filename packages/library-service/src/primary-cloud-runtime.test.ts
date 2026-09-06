import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreResultHeadObjectKey,
  encodeLibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
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
  it("countersigns and publishes a real enrollment envelope through the default transport", async () => {
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
          expect(await (init.body as Blob).text()).toContain(
            new TextDecoder().decode(certificateBytes),
          );
          const file = immutable(
            "certificate-1",
            certificateBytes,
            "actor_enrollment",
          );
          files.push(file);
          return Response.json(metadata(file));
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
          nextActorCounter: 1,
          storageEpochId: epochId,
        };
      if (command === "export_follower_result_page_v2")
        return {
          canonicalRecordBytes: 0,
          done: true,
          nextCursor: null,
          records: [],
        };
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
