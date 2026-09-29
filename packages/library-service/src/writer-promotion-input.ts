import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { createNodeLibraryServicePorts } from "./node-ports.js";
import {
  LibraryServiceFailure,
  type LibraryServiceBoundPath,
} from "./contracts.js";
import { parseWriterPromotionRequest } from "./writer-promotion.js";

type Ports = ReturnType<typeof createNodeLibraryServicePorts>;
const MAXIMUM_BYTES = 64 * 1024;

async function readPrivate(filePath: string, ports: Ports): Promise<string> {
  const file = await ports.fileSystem.openBoundPath(filePath);
  try {
    if (
      file.metadata.kind !== "file" ||
      file.metadata.uid !== ports.identity.currentUserId() ||
      (file.metadata.mode & 0o7777) !== 0o600 ||
      file.metadata.links !== 1
    )
      throw new LibraryServiceFailure("config_not_private");
    await file.assertCanonicalPath();
    await file.assertPathStable();
    await ports.aclProof.assertNoExtendedAcl([
      {
        path: file.path,
        device: file.metadata.device,
        inode: file.metadata.inode,
      },
    ]);
    const bytes = await file.readBoundedBytes(MAXIMUM_BYTES);
    await file.assertPathStable();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await file.close();
  }
}

export async function readWriterPromotionRequest(
  filePath: string,
  ports: Ports,
) {
  return parseWriterPromotionRequest(
    JSON.parse(await readPrivate(filePath, ports)),
  );
}

async function assertDirectoryIdentity(
  root: LibraryServiceBoundPath,
  ports: Ports,
) {
  const current = await ports.fileSystem.inspect(root.path);
  if (
    current.kind !== "directory" ||
    current.device !== root.metadata.device ||
    current.inode !== root.metadata.inode ||
    current.uid !== root.metadata.uid ||
    current.mode !== root.metadata.mode ||
    (await ports.fileSystem.canonicalPath(root.path)) !== root.path
  )
    throw new LibraryServiceFailure("bound_input_changed");
}

async function syncDirectory(root: LibraryServiceBoundPath) {
  const directory = await open(
    root.path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await directory.stat({ bigint: true });
    if (
      String(metadata.dev) !== root.metadata.device ||
      String(metadata.ino) !== root.metadata.inode
    )
      throw new LibraryServiceFailure("bound_input_changed");
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Retain exact retry input before preparation, under the already-held service lease. */
export async function retainWriterPromotionRequest(
  root: LibraryServiceBoundPath,
  text: string,
  ports: Ports,
): Promise<void> {
  const input = parseWriterPromotionRequest(JSON.parse(text));
  const name = `writer-promotion-${input.sourceControl.storageEpoch}.json`;
  const destination = path.join(root.path, name);
  await assertDirectoryIdentity(root, ports);
  try {
    const existing = await readPrivate(destination, ports);
    if (existing !== text)
      throw new LibraryServiceFailure("bound_input_changed");
    // A prior process may have stopped after rename and before directory fsync.
    await syncDirectory(root);
    await assertDirectoryIdentity(root, ports);
    return;
  } catch (error) {
    // Only absence permits creation. Corrupt records stay fenced.
    try {
      await ports.fileSystem.inspect(destination);
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
      const temporary = `.writer-promotion-${randomUUID()}.tmp`;
      const temporaryPath = path.join(root.path, temporary);
      const mutationRoot =
        process.platform === "linux"
          ? `/proc/self/fd/${root.descriptor}`
          : root.path;
      const mutationTemporary = `${mutationRoot}/${temporary}`;
      const file = await open(
        mutationTemporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(text);
        await file.sync();
        if ((await readPrivate(temporaryPath, ports)) !== text)
          throw new LibraryServiceFailure("bound_input_changed");
        await assertDirectoryIdentity(root, ports);
        await rename(mutationTemporary, `${mutationRoot}/${name}`);
        await syncDirectory(root);
        await assertDirectoryIdentity(root, ports);
        if ((await readPrivate(destination, ports)) !== text)
          throw new LibraryServiceFailure("bound_input_changed");
        return;
      } finally {
        await file.close();
        await unlink(mutationTemporary).catch(() => undefined);
      }
    }
    throw error;
  }
}
