import { describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreControlPointerV1,
} from "@freed/shared/library-core";
import {
  promoteLibraryServiceWriter,
  type WriterPromotionRequest,
} from "./writer-promotion.js";
import { retainWriterPromotionRequest } from "./writer-promotion-input.js";
import { createNodeLibraryServicePorts } from "./node-ports.js";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), publish: vi.fn() }));
vi.mock("./writer-promotion-verification.js", () => ({
  verifyPreparedWriterCheckpoint: mocks.verify,
}));
vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reassignLibraryCoreNormalizedCheckpointV2: mocks.publish,
}));
const hex = (n: string) => n.repeat(64);
const pointer = (epoch: string, writer: string) =>
  parseLibraryCoreControlPointerV1({
    schemaVersion: 1,
    protocolVersion: 1,
    libraryId: hex("a"),
    storageEpoch: epoch,
    writerId: writer,
    activeTransport: "google_drive_app_data_v1",
    generation: 0,
    causalFrontierDigest: hex("d"),
    manifest: {
      descriptor: {
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_manifest",
          libraryId: hex("a"),
          epochId: epoch,
          generation: 0,
          digest: hex("e"),
        }),
        contentDigest: hex("e"),
        byteLength: 10,
      },
      transportObjectId: "manifest",
    },
  });
const request: WriterPromotionRequest = {
  sourceControl: pointer(hex("b"), hex("c")),
  expectedRevision: "source",
  controlFileId: "control",
  installationWitness: hex("f"),
  acceptedAtMs: 2000,
};
function fixture(prepared = false) {
  vi.clearAllMocks();
  let current = { revision: "source", pointer: request.sourceControl };
  const target = pointer(hex("1"), hex("2"));
  const descriptor = () => ({
    format: "freed_normalized_checkpoint_export_v2",
    protocolVersion: 2,
    libraryId: hex("a"),
    authorityEpoch: prepared ? hex("1") : hex("b"),
    writerId: prepared ? hex("2") : hex("c"),
    sourceRevision: 1,
    recordCount: 1,
    itemCount: 0,
    causalFrontierDigest: hex("d"),
  });
  const events: string[] = [];
  const native = {
    execute: vi.fn(async (command: string) => {
      events.push(command);
      if (command === "cloud_writer_clear_v1") return { allowed: false };
      if (command === "cloud_writer_observe_v1") return { allowed: true };
      if (command === "primary_actor_identity_v1")
        return { libraryId: hex("a"), actorId: hex("2") };
      if (command.includes("checkpoint_export")) return descriptor();
      if (command === "reassign_writer_epoch_v2") {
        prepared = true;
        return {
          authority: { epochId: hex("1") },
          canonicalEpochCertificateJson: "{}",
        };
      }
      throw new Error(command);
    }),
  };
  mocks.verify.mockResolvedValue({
    checkpointDigest: hex("e"),
    recordCount: 1,
    canonicalBytes: 100,
  });
  mocks.publish.mockImplementation(async () => {
    current = { revision: "target", pointer: target };
    return { status: "committed", controlPointer: target, revision: "target" };
  });
  const state = {
    read: async () => null,
    write: vi.fn(async () => {
      events.push("receipt");
    }),
  };
  const adapter = {
    readControl: vi.fn(async () => {
      events.push("read-control");
      return {
        revision: current.revision,
        bytes: encodeLibraryCoreCanonicalValue(current.pointer as never),
      };
    }),
  };
  const ports = {
    native,
    adapter: adapter as never,
    state,
    retainRequest: vi.fn(async () => {
      events.push("retain");
    }),
    signal: new AbortController().signal,
  };
  return {
    ports,
    events,
    setCurrent: (value: typeof current) => {
      current = value;
    },
    target,
  };
}
describe("explicit headless promotion", () => {
  it("retains input before native preparation and rechecks control after content verification before admission", async () => {
    const f = fixture();
    await expect(
      promoteLibraryServiceWriter(request, f.ports),
    ).resolves.toMatchObject({ status: "writer_transferred" });
    expect(f.events.indexOf("retain")).toBeLessThan(
      f.events.indexOf("reassign_writer_epoch_v2"),
    );
    expect(f.events.slice(-3)).toEqual([
      "read-control",
      "receipt",
      "cloud_writer_observe_v1",
    ]);
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });
  it("recovers the prepared certificate after remote response loss without a second CAS", async () => {
    const f = fixture(true);
    f.setCurrent({ revision: "target", pointer: f.target });
    await expect(
      promoteLibraryServiceWriter(request, f.ports),
    ).resolves.toMatchObject({ status: "writer_transferred" });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(f.ports.native.execute).toHaveBeenCalledWith(
      "reassign_writer_epoch_v2",
      expect.objectContaining({ acceptedAtMs: request.acceptedAtMs }),
    );
  });
  it("rejects changed retry input before preparation and keeps admission cleared", async () => {
    const f = fixture(true);
    f.ports.retainRequest.mockRejectedValue(new Error("changed retry"));
    await expect(promoteLibraryServiceWriter(request, f.ports)).rejects.toThrow(
      "changed retry",
    );
    expect(f.events).toEqual([
      "cloud_writer_clear_v1",
      "cloud_writer_clear_v1",
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("refuses a competitor arriving during long verification without writing a receipt", async () => {
    const f = fixture(true);
    f.setCurrent({ revision: "target", pointer: f.target });
    mocks.verify.mockImplementation(async () => {
      f.setCurrent({
        revision: "competitor",
        pointer: pointer(hex("3"), hex("4")),
      });
      return {};
    });
    await expect(
      promoteLibraryServiceWriter(request, f.ports),
    ).rejects.toMatchObject({ code: "authority_not_primary" });
    expect(f.ports.state.write).not.toHaveBeenCalled();
    expect(f.events.at(-1)).toBe("cloud_writer_clear_v1");
  });
  it("durably reuses one private input record and refuses changed bytes after reopen", async () => {
    const rootPath = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "headless-promotion-")),
    );
    await chmod(rootPath, 0o700);
    const ports = createNodeLibraryServicePorts();
    const text = JSON.stringify(request);
    try {
      for (let index = 0; index < 2; index++) {
        const root = await ports.fileSystem.openBoundPath(rootPath);
        try {
          await retainWriterPromotionRequest(root, text, ports);
          await expect(
            retainWriterPromotionRequest(
              root,
              JSON.stringify({ ...request, acceptedAtMs: 3000 }),
              ports,
            ),
          ).rejects.toMatchObject({ code: "bound_input_changed" });
        } finally {
          await root.close();
        }
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
