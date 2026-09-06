import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeLibraryServicePorts } from "./node-ports.js";
import { createLinuxDriveCredentialStore } from "./linux-drive-credential-store.js";
import { createNodeGoogleDriveTokenPortV1 } from "./node-google-drive-token.js";
import type { LibraryServiceBoundPath } from "./contracts.js";

const linuxIt = process.platform === "linux" ? it : it.skip;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), "freed-linux-oauth-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  await chmod(parent, 0o700);
  const root = path.join(parent, "records");
  await mkdir(root, { mode: 0o700 });
  const keyPath = path.join(parent, "wrapping-key");
  const key = new Uint8Array(32).fill(23);
  await writeFile(keyPath, key, { mode: 0o600 });
  const fileSystem = createNodeLibraryServicePorts().fileSystem;
  const directory = await fileSystem.openBoundPath(root);
  const wrappingKey = await fileSystem.openBoundPath(keyPath);
  cleanup.push(
    () => wrappingKey.close(),
    () => directory.close(),
  );
  const store = createLinuxDriveCredentialStore({
    directory,
    wrappingKey,
    wrappingKeyDigest: createHash("sha256").update(key).digest("hex"),
    // Filesystem tests exercise real descriptors. Extended ACL admission is
    // separately covered by the production ACL port's platform tests.
    aclProof: {
      async assertNoExtendedAcl(targets) {
        for (const target of targets) {
          const stat = await lstat(target.path, { bigint: true });
          expect(String(stat.dev)).toBe(target.device);
          expect(String(stat.ino)).toBe(target.inode);
        }
      },
    },
  });
  return { root, keyPath, store, directory };
}

describe("Linux descriptor-bound Drive credential files", () => {
  linuxIt.each(["before-rename", "after-rename"] as const)(
    "reopens a complete credential after writer termination %s",
    async (boundary) => {
      const { root, keyPath, store } = await fixture();
      await store.persistCredential("drive-1", "synthetic-old");
      // Execute the compiled implementation in another process so SIGKILL
      // bypasses every catch/finally. ACL checkpoints bracket atomic rename:
      // the second temporary inspection follows file fsync, and the second
      // target inspection follows rename and directory fsync. This proves
      // process-crash recovery, not power-loss durability of the host disk.
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { createNodeLibraryServicePorts } from ${JSON.stringify(new URL("../dist/node-ports.js", import.meta.url).href)};
        import { createLinuxDriveCredentialStore } from ${JSON.stringify(new URL("../dist/linux-drive-credential-store.js", import.meta.url).href)};
        const fs = createNodeLibraryServicePorts().fileSystem;
        const directory = await fs.openBoundPath(${JSON.stringify(root)});
        const wrappingKey = await fs.openBoundPath(${JSON.stringify(keyPath)});
        let temporaryChecks = 0;
        let targetChecks = 0;
        const store = createLinuxDriveCredentialStore({
          directory, wrappingKey, wrappingKeyDigest: await wrappingKey.sha256(),
          aclProof: { async assertNoExtendedAcl(targets) {
            for (const target of targets) {
              if (target.path.endsWith('.tmp')) temporaryChecks += 1;
              if (target.path.endsWith('/drive-1.sealed.json')) targetChecks += 1;
            }
            if ((${JSON.stringify(boundary)} === 'before-rename' && temporaryChecks === 2) ||
                (${JSON.stringify(boundary)} === 'after-rename' && targetChecks === 2)) {
              process.kill(process.pid, 'SIGKILL');
              await new Promise(() => {});
            }
          } }
        });
        await store.persistCredential('drive-1', 'synthetic-new');
        process.exit(90);
      `,
        ],
        { timeout: 5000, encoding: "utf8", maxBuffer: 4096 },
      );
      expect(child.error).toBeUndefined();
      expect(child.stderr).toBe("");
      expect(child.signal).toBe("SIGKILL");
      expect(await store.readCredential("drive-1")).toBe(
        boundary === "before-rename" ? "synthetic-old" : "synthetic-new",
      );
      await store.persistCredential("drive-1", "synthetic-recovered");
      expect(await store.readCredential("drive-1")).toBe("synthetic-recovered");
    },
  );

  linuxIt.each(["replace", "remove"] as const)(
    "invalidates cached tokens after record %s and recovers only with a new token port",
    async (change) => {
      const { root, store } = await fixture();
      const credential = JSON.stringify({
        schemaVersion: 1,
        refreshToken: "synthetic-refresh",
      });
      await store.persistCredential("drive-1", credential);
      let requests = 0;
      const dependencies = {
        platform: "linux" as const,
        readCredential: store.readCredential,
        credentialRevision: store.credentialRevision,
        fetch: (async () => {
          requests += 1;
          return new Response(
            JSON.stringify({
              access_token: "synthetic-access",
              expires_in: 3600,
            }),
          );
        }) as typeof fetch,
      };
      const token = createNodeGoogleDriveTokenPortV1("drive-1", dependencies);
      const signal = new AbortController().signal;
      expect(await token.accessToken(signal)).toBe("synthetic-access");
      expect(await token.accessToken(signal)).toBe("synthetic-access");
      expect(requests).toBe(1);
      if (change === "replace")
        await store.persistCredential("drive-1", credential);
      else await rm(path.join(root, "drive-1.sealed.json"));
      await expect(token.accessToken(signal)).rejects.toThrow(
        "drive_credential_unavailable",
      );
      expect(requests).toBe(1);
      if (change === "remove")
        await store.persistCredential("drive-1", credential);
      await expect(token.accessToken(signal)).rejects.toThrow(
        "drive_credential_unavailable",
      );
      const restarted = createNodeGoogleDriveTokenPortV1(
        "drive-1",
        dependencies,
      );
      expect(await restarted.accessToken(signal)).toBe("synthetic-access");
      expect(requests).toBe(2);
    },
  );

  linuxIt(
    "atomically creates and replaces a private sealed record",
    async () => {
      const { root, store } = await fixture();
      await store.persistCredential("drive-1", "synthetic-first");
      const target = path.join(root, "drive-1.sealed.json");
      const first = await lstat(target);
      expect(first.mode & 0o7777).toBe(0o600);
      expect(first.nlink).toBe(1);
      expect(await readFile(target, "utf8")).not.toContain("synthetic-first");
      expect(await store.readCredential("drive-1")).toBe("synthetic-first");
      await store.persistCredential("drive-1", "synthetic-second");
      expect((await lstat(target)).ino).not.toBe(first.ino);
      expect(await store.readCredential("drive-1")).toBe("synthetic-second");
      expect(
        (await readdir(root)).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    },
  );

  linuxIt(
    "preserves corrupt existing data and refuses links or nonprivate files",
    async () => {
      const { root, store } = await fixture();
      const target = path.join(root, "drive-1.sealed.json");
      await writeFile(target, "corrupt fixture", { mode: 0o600 });
      await expect(
        store.persistCredential("drive-1", "replacement"),
      ).rejects.toThrow("drive_credential_unavailable");
      expect(await readFile(target, "utf8")).toBe("corrupt fixture");
      await rm(target);
      const other = path.join(root, "other");
      await writeFile(other, "untouched", { mode: 0o600 });
      await symlink(other, target);
      await expect(
        store.persistCredential("drive-1", "replacement"),
      ).rejects.toThrow("drive_credential_unavailable");
      expect(await readFile(other, "utf8")).toBe("untouched");
      await rm(target);
      await store.persistCredential("drive-1", "synthetic");
      await chmod(target, 0o644);
      await expect(store.readCredential("drive-1")).rejects.toThrow(
        "drive_credential_unavailable",
      );
    },
  );

  linuxIt(
    "fences key content changes and a renamed bound directory",
    async () => {
      const { root, keyPath, store } = await fixture();
      await store.persistCredential("drive-1", "synthetic");
      await writeFile(keyPath, new Uint8Array(32).fill(24));
      await expect(store.readCredential("drive-1")).rejects.toThrow(
        "drive_credential_unavailable",
      );
      await writeFile(keyPath, new Uint8Array(32).fill(23));
      const moved = `${root}-moved`;
      await rename(root, moved);
      cleanup.unshift(() => rm(moved, { recursive: true, force: true }));
      await expect(
        store.persistCredential("drive-1", "replacement"),
      ).rejects.toThrow("drive_credential_unavailable");
    },
  );

  if (process.platform !== "linux")
    it("does not claim a Linux store on another platform", () => {
      expect(() =>
        createLinuxDriveCredentialStore({
          directory: {} as LibraryServiceBoundPath,
          wrappingKey: {} as LibraryServiceBoundPath,
          wrappingKeyDigest: "0".repeat(64),
          aclProof: { assertNoExtendedAcl: async () => undefined },
        }),
      ).toThrow("unsupported_secret_store_or_acl_backend");
    });
});
