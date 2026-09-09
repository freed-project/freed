import { createHash } from "node:crypto";
import type {
  LibraryServiceAclProofPort,
  LibraryServiceBoundPath,
  LibraryServiceFileSystemPort,
} from "./contracts.js";

/** Match the systemd-created runtime directory to one canonical state root. */
export function localActorRuntimeDirectoryName(stateRootPath: string): string {
  return `freed-library-${createHash("sha256").update(stateRootPath, "utf8").digest("hex").slice(0, 24)}`;
}

/** Keep the externally visible Linux endpoint beneath verified open directories. */
export async function bindLocalActorRuntimeDirectory(input: {
  stateRootPath: string;
  userId: number;
  fileSystem: LibraryServiceFileSystemPort;
  aclProof: LibraryServiceAclProofPort;
}) {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 0 ||
    input.userId > 0xffff_ffff
  )
    throw new Error("local_actor_runtime_directory_invalid");
  const runtimePath = `/run/${localActorRuntimeDirectoryName(input.stateRootPath)}`;
  const bindings: LibraryServiceBoundPath[] = [];
  const close = async () => {
    await Promise.all(bindings.splice(0).map((bound) => bound.close()));
  };
  const assertStable = async () => {
    if (bindings.length !== 2)
      throw new Error("local_actor_runtime_directory_closed");
    for (const bound of bindings) {
      await bound.assertStable();
      await bound.assertPathStable();
      await bound.assertCanonicalPath();
    }
    await input.aclProof.assertNoExtendedAcl(
      bindings.map((bound) => ({
        path: bound.path,
        device: bound.metadata.device,
        inode: bound.metadata.inode,
      })),
    );
  };
  try {
    for (const directory of ["/run", runtimePath]) {
      const bound = await input.fileSystem.openBoundPath(directory);
      bindings.push(bound);
      const privateDirectory = directory === runtimePath;
      const metadata = bound.metadata;
      if (
        metadata.kind !== "directory" ||
        metadata.uid !== (privateDirectory ? input.userId : 0) ||
        (privateDirectory
          ? (metadata.mode & 0o7777) !== 0o700
          : (metadata.mode & 0o7022) !== 0)
      ) {
        throw new Error("local_actor_runtime_directory_invalid");
      }
    }
    await assertStable();
    const directory = bindings[bindings.length - 1]!;
    return Object.freeze({
      endpoint: `${runtimePath}/actor.sock`,
      descriptorEndpoint: `/proc/self/fd/${directory.descriptor}/actor.sock`,
      assertStable,
      close,
    });
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
