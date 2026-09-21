import path from "node:path";
import {
  parseLibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutableReadAdapterV1 } from "@freed/sync/cloud/library-core";
import { LibraryServiceFailure, type LibraryServiceBoundPath } from "./contracts.js";
import type { createNodeLibraryServicePorts } from "./node-ports.js";
import type { LibraryServiceCheckpointBootstrapInput } from "./checkpoint-bootstrap.js";

type Ports = ReturnType<typeof createNodeLibraryServicePorts>;
const REQUEST_BYTES = 64 * 1024;
// Includes the bounded checkpoint page's wire framing, not only decoded records.
const OBJECT_BYTES = 4 * 1024 * 1024;

export function parseCheckpointBootstrapInput(value: unknown): LibraryServiceCheckpointBootstrapInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !==
    "controlRevision,generation,installationWitness,installedAt,libraryId,manifest,storageEpoch" ||
    ![row.libraryId, row.storageEpoch, row.installationWitness].every(
      (entry) => typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry),
    ) ||
    !Number.isSafeInteger(row.generation) || (row.generation as number) < 0 ||
    !Number.isSafeInteger(row.installedAt) || (row.installedAt as number) < 0 ||
    typeof row.controlRevision !== "string" || row.controlRevision.length === 0 ||
    Buffer.byteLength(row.controlRevision) > 4096
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }
  return {
    libraryId: row.libraryId as string,
    storageEpoch: row.storageEpoch as string,
    installationWitness: row.installationWitness as string,
    generation: row.generation as number,
    installedAt: row.installedAt as number,
    controlRevision: row.controlRevision,
    manifest: parseLibraryCoreImmutableObjectReferenceV1(row.manifest),
  };
}

async function bindInput(inputPath: string, kind: "file" | "directory", ports: Ports) {
  const bound = await ports.fileSystem.openBoundPath(inputPath);
  try {
    const metadata = bound.metadata;
    if (!path.isAbsolute(inputPath) || metadata.kind !== kind ||
      metadata.uid !== ports.identity.currentUserId() ||
      (metadata.mode & 0o7777) !== (kind === "file" ? 0o600 : 0o700) ||
      (kind === "file" && metadata.links !== 1)) {
      throw new LibraryServiceFailure("config_invalid");
    }
    await bound.assertCanonicalPath();
    await bound.assertPathStable();
    await ports.aclProof.assertNoExtendedAcl([{
      path: inputPath, device: metadata.device, inode: metadata.inode,
    }]);
    await bound.assertStable();
    return bound;
  } catch (error) {
    await bound.close();
    throw error;
  }
}

/** Read existing logical objects by digest. Never reads a SQLite database or writes a file. */
export async function openCheckpointBootstrapInput(
  requestPath: string, objectsPath: string, ports: Ports, signal: AbortSignal,
): Promise<{
  input: LibraryServiceCheckpointBootstrapInput;
  adapter: LibraryCoreImmutableReadAdapterV1;
  close(): Promise<void>;
}> {
  signal.throwIfAborted();
  const request = await bindInput(requestPath, "file", ports);
  let objects: LibraryServiceBoundPath | null = null;
  try {
    const bytes = await request.readBoundedBytes(REQUEST_BYTES);
    const input = parseCheckpointBootstrapInput(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    objects = await bindInput(objectsPath, "directory", ports);
    const root = objects;
    const adapter: LibraryCoreImmutableReadAdapterV1 = {
      async readImmutable(receipt) {
        signal.throwIfAborted();
        const reference = parseLibraryCoreImmutableObjectReferenceV1(receipt);
        if (reference.descriptor.byteLength > OBJECT_BYTES) {
          throw new LibraryServiceFailure("config_invalid");
        }
        await root.assertStable();
        await root.assertPathStable();
        const file = await bindInput(path.join(root.path, reference.descriptor.contentDigest), "file", ports);
        try {
          if (file.metadata.size !== reference.descriptor.byteLength) {
            throw new LibraryServiceFailure("bound_input_changed");
          }
          const result = await file.readBoundedBytes(OBJECT_BYTES);
          await file.assertPathStable();
          await root.assertPathStable();
          signal.throwIfAborted();
          // The shared importer verifies descriptor digests and canonical wire bytes.
          return result;
        } finally {
          await file.close();
        }
      },
    };
    return { input, adapter, async close() { await root.close(); await request.close(); } };
  } catch (error) {
    await objects?.close();
    await request.close();
    throw error;
  }
}
