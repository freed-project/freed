import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLibraryCoreImmutableObjectKey, parseLibraryCoreImmutableObjectReferenceV1 } from "@freed/shared/library-core";
import { openCheckpointBootstrapInput, parseCheckpointBootstrapInput } from "./checkpoint-bootstrap-input.js";
import { createNodeLibraryServicePorts } from "./node-ports.js";
import { importLibraryServiceCheckpoint, type LibraryServiceCheckpointBootstrapInput } from "./checkpoint-bootstrap.js";

// These boundary tests intentionally never reach manifest decoding. A foreign
// native identity or cancelled operation must fail before reading any object.
const input: LibraryServiceCheckpointBootstrapInput = {
  libraryId: "a".repeat(64), storageEpoch: "b".repeat(64), generation: 1,
  manifest: null as unknown as LibraryServiceCheckpointBootstrapInput["manifest"],
  controlRevision: "revision-1", installedAt: 1,
  installationWitness: "c".repeat(64),
};

describe("headless checkpoint bootstrap admission", () => {
  it("reads bounded digest-named files and rejects changed size, symlinks and unknown request fields", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "freed-checkpoint-input-")));
    const digest = "d".repeat(64);
    const manifest = parseLibraryCoreImmutableObjectReferenceV1({
      descriptor: {
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_manifest", libraryId: input.libraryId,
          epochId: input.storageEpoch, generation: 1, digest,
        }), contentDigest: digest, byteLength: 3,
      }, transportObjectId: "pinned-manifest",
    });
    const request = { ...input, manifest };
    const signal = new AbortController().signal;
    const ports = createNodeLibraryServicePorts();
    try {
      await mkdir(path.join(root, "objects"), { mode: 0o700 });
      await writeFile(path.join(root, "request.json"), JSON.stringify(request), { mode: 0o600 });
      const objectPath = path.join(root, "objects", digest);
      await writeFile(objectPath, "abc", { mode: 0o600 });
      expect(() => parseCheckpointBootstrapInput({ ...request, extra: true })).toThrow();
      const source = await openCheckpointBootstrapInput(
        path.join(root, "request.json"), path.join(root, "objects"), ports, signal,
      );
      try {
        expect(await source.adapter.readImmutable(manifest)).toEqual(Buffer.from("abc"));
        await expect(source.adapter.readImmutable({
          ...manifest, descriptor: { ...manifest.descriptor, byteLength: 4 * 1024 * 1024 + 1 },
        })).rejects.toMatchObject({ code: "config_invalid" });
        await writeFile(objectPath, "abcd", { mode: 0o600 });
        await expect(source.adapter.readImmutable(manifest)).rejects.toThrow();
        await rm(objectPath);
        await symlink(path.join(root, "request.json"), objectPath);
        await expect(source.adapter.readImmutable(manifest)).rejects.toThrow();
      } finally {
        await source.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a foreign mounted Library before staging or reading transport objects", async () => {
    const execute = vi.fn(async () => ({actorId:"d".repeat(64),libraryId:"e".repeat(64)}));
    const readImmutable = vi.fn();
    await expect(importLibraryServiceCheckpoint(input, {
      native:{execute}, adapter:{readImmutable},
      signal:new AbortController().signal, subtle:crypto.subtle,
    })).rejects.toMatchObject({code:"authority_not_primary"});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("primary_actor_identity_v1", {installationWitness:input.installationWitness});
    expect(readImmutable).not.toHaveBeenCalled();
  });

  it("does no native or transport work after cancellation", async () => {
    const abort = new AbortController();
    abort.abort();
    const execute = vi.fn();
    const readImmutable = vi.fn();
    await expect(importLibraryServiceCheckpoint(input, {
      native:{execute}, adapter:{readImmutable}, signal:abort.signal, subtle:crypto.subtle,
    })).rejects.toMatchObject({name:"AbortError"});
    expect(execute).not.toHaveBeenCalled();
    expect(readImmutable).not.toHaveBeenCalled();
  });
});
