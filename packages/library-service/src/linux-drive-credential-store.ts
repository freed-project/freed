import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  LibraryServiceFailure,
  type LibraryServiceBoundPath,
  type LibraryServiceAclProofPort,
} from "./contracts.js";
import {
  openLinuxDriveCredential,
  sealLinuxDriveCredential,
} from "./linux-drive-sealed-record.js";

const MAX_RECORD_BYTES = 24_576;
const READ_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const RECORD_ABSENT = Symbol("record absent at open");

export interface LinuxDriveCredentialStoreInput {
  readonly directory: LibraryServiceBoundPath;
  readonly wrappingKey: LibraryServiceBoundPath;
  readonly wrappingKeyDigest: string;
  readonly aclProof: LibraryServiceAclProofPort;
}

function unavailable(): never {
  throw new LibraryServiceFailure("drive_credential_unavailable");
}

function privateFile(stats: BigIntStats, owner: number): void {
  if (
    !stats.isFile() ||
    stats.uid !== BigInt(owner) ||
    (stats.mode & 0o7777n) !== 0o600n ||
    stats.nlink !== 1n
  )
    unavailable();
}

function unchanged(before: BigIntStats, after: BigIntStats): void {
  for (const key of [
    "dev",
    "ino",
    "uid",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ] as const) {
    if (before[key] !== after[key]) unavailable();
  }
}

/** Bind Linux OAuth records to verified directory and mounted-key descriptors. */
export function createLinuxDriveCredentialStore(
  input: LinuxDriveCredentialStoreInput,
) {
  if (process.platform !== "linux")
    throw new LibraryServiceFailure("unsupported_secret_store_or_acl_backend");
  const owner = process.getuid?.();
  if (owner === undefined || !/^[a-f0-9]{64}$/u.test(input.wrappingKeyDigest))
    unavailable();
  const root = input.directory;
  const keyFile = input.wrappingKey;
  const keyRelative = path.relative(root.path, keyFile.path);
  if (
    keyRelative === "" ||
    (!path.isAbsolute(keyRelative) &&
      keyRelative !== ".." &&
      !keyRelative.startsWith(`..${path.sep}`))
  )
    unavailable();
  if (
    root.metadata.kind !== "directory" ||
    root.metadata.uid !== owner ||
    (root.metadata.mode & 0o7777) !== 0o700 ||
    keyFile.metadata.kind !== "file" ||
    keyFile.metadata.uid !== owner ||
    (keyFile.metadata.mode & 0o7777) !== 0o600 ||
    keyFile.metadata.links !== 1 ||
    keyFile.metadata.size !== 32
  )
    unavailable();
  const descriptorRoot = `/proc/self/fd/${root.descriptor}`;

  const assertBound = async () => {
    for (const bound of [root, keyFile]) {
      await bound.assertStable();
      await bound.assertPathStable();
      await bound.assertCanonicalPath();
    }
    await input.aclProof.assertNoExtendedAcl(
      [root, keyFile].map((bound) => ({
        path: bound.path,
        device: bound.metadata.device,
        inode: bound.metadata.inode,
      })),
    );
    if ((await keyFile.sha256()) !== input.wrappingKeyDigest) unavailable();
  };
  const recordName = (recordId: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(recordId)) unavailable();
    return `${recordId}.sealed.json`;
  };
  const readKey = async () => {
    await assertBound();
    const bytes = await keyFile.readBoundedBytes(32);
    if (
      bytes.byteLength !== 32 ||
      createHash("sha256").update(bytes).digest("hex") !==
        input.wrappingKeyDigest
    ) {
      bytes.fill(0);
      unavailable();
    }
    return bytes;
  };
  const inspectHandle = async (handle: FileHandle, name: string) => {
    const before = await handle.stat({ bigint: true });
    privateFile(before, owner);
    await input.aclProof.assertNoExtendedAcl([
      {
        path: path.join(root.path, name),
        device: String(before.dev),
        inode: String(before.ino),
      },
    ]);
    unchanged(before, await handle.stat({ bigint: true }));
    return before;
  };
  const readRecord = async (name: string): Promise<Uint8Array> => {
    const handle = await open(`${descriptorRoot}/${name}`, READ_FLAGS).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw RECORD_ABSENT;
        throw error;
      },
    );
    try {
      const before = await inspectHandle(handle, name);
      if (before.size < 1n || before.size > BigInt(MAX_RECORD_BYTES))
        unavailable();
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let count = 0;
      while (count < buffer.byteLength) {
        const { bytesRead } = await handle.read(
          buffer,
          count,
          buffer.byteLength - count,
          count,
        );
        if (bytesRead === 0) break;
        count += bytesRead;
      }
      if (count !== Number(before.size)) unavailable();
      unchanged(before, await handle.stat({ bigint: true }));
      await assertBound();
      return buffer.subarray(0, count);
    } finally {
      await handle.close();
    }
  };

  const readState = async (recordId: string) => {
    let key: Uint8Array | undefined;
    try {
      const name = recordName(recordId);
      key = await readKey();
      const sealed = await readRecord(name);
      const credential = openLinuxDriveCredential(recordId, sealed, key);
      await assertBound();
      return {
        credential,
        revision: createHash("sha256").update(sealed).digest("hex"),
      };
    } catch {
      return unavailable();
    } finally {
      key?.fill(0);
    }
  };
  return Object.freeze({
    async readCredential(recordId: string): Promise<string> {
      return (await readState(recordId)).credential;
    },
    async credentialRevision(recordId: string): Promise<string> {
      return (await readState(recordId)).revision;
    },
    async persistCredential(
      recordId: string,
      credential: string,
    ): Promise<void> {
      let key: Uint8Array | undefined;
      let temporary: string | undefined;
      try {
        const name = recordName(recordId);
        key = await readKey();
        // Refuse to overwrite an ambiguous existing record. Only ENOENT permits
        // first creation; corrupt, nonprivate or substituted files stay intact.
        try {
          openLinuxDriveCredential(recordId, await readRecord(name), key);
        } catch (error) {
          if (error !== RECORD_ABSENT) throw error;
        }
        const sealed = sealLinuxDriveCredential(recordId, credential, key);
        temporary = `.drive-${randomUUID()}.tmp`;
        const handle = await open(
          `${descriptorRoot}/${temporary}`,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await inspectHandle(handle, temporary);
          await handle.writeFile(sealed);
          await handle.sync();
          await inspectHandle(handle, temporary);
        } finally {
          await handle.close();
        }
        await assertBound();
        await rename(
          `${descriptorRoot}/${temporary}`,
          `${descriptorRoot}/${name}`,
        );
        temporary = undefined;
        const directory = await open(
          descriptorRoot,
          constants.O_RDONLY | constants.O_DIRECTORY,
        );
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        const stored = await readRecord(name);
        if (!Buffer.from(stored).equals(sealed)) unavailable();
      } catch {
        return unavailable();
      } finally {
        key?.fill(0);
        if (temporary !== undefined)
          await unlink(`${descriptorRoot}/${temporary}`).catch(() => undefined);
      }
    },
  });
}
