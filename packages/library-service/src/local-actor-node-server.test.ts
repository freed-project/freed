import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryServiceBoundPath } from "./contracts.js";
import { createNodeLibraryServiceLocalActorIngressPortV1 } from "./local-actor-node-server.js";
import { createLibraryServiceLocalActorProcessorV1 } from "./local-actor-transport.js";

const posixIt = process.platform === "win32" ? it.skip : it;
const fixtures: string[] = [];

async function fixture(): Promise<{
  readonly root: string;
  readonly stateRoot: LibraryServiceBoundPath;
}> {
  const root = await mkdtemp("/tmp/freed-actor-");
  fixtures.push(root);
  await chmod(root, 0o700);
  const metadata = await lstat(root, { bigint: true });
  return {
    root,
    stateRoot: {
      path: root,
      descriptor: -1,
      metadata: {
        kind: "directory",
        mode: Number(metadata.mode),
        uid: Number(metadata.uid),
        size: Number(metadata.size),
        device: String(metadata.dev),
        inode: String(metadata.ino),
        links: Number(metadata.nlink),
      },
      assertStable: async () => undefined,
      assertPathStable: async () => undefined,
      assertCanonicalPath: async () => undefined,
      readBoundedBytes: async () => new Uint8Array(),
      sha256: async () => "0".repeat(64),
      close: async () => undefined,
    },
  };
}

async function exchange(endpoint: string, frame: Uint8Array): Promise<unknown> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection(endpoint);
    socket.once("error", reject);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("end", () => resolve(Buffer.concat(chunks)));
    socket.once("connect", () => socket.write(frame));
  });
  return JSON.parse(bytes.toString("utf8"));
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Node local actor socket", () => {
  posixIt(
    "serves one bounded frame through a private owned socket",
    async () => {
      const { root, stateRoot } = await fixture();
      const submitSignedIntentPage = vi.fn(async () => ({ accepted: true }));
      const listener =
        await createNodeLibraryServiceLocalActorIngressPortV1().start({
          stateRoot,
          expectedUserId: process.getuid!(),
          processor: createLibraryServiceLocalActorProcessorV1(
            { executeSignedQuery: vi.fn(), submitSignedIntentPage },
            { nowMs: () => 1_000 },
          ),
        });

      const metadata = await lstat(listener.endpoint);
      expect(metadata.isSocket()).toBe(true);
      expect(metadata.mode & 0o7777).toBe(0o600);
      const response = await exchange(
        listener.endpoint,
        Buffer.from(
          `${JSON.stringify({
            method: "submit_signed_intent_page_v1",
          payload: { page: { records: [] } },
            protocolVersion: 2,
            requestId: "1".repeat(64),
          })}\n`,
        ),
      );
      expect(response).toMatchObject({ ok: true, result: { accepted: true } });
      expect(submitSignedIntentPage).toHaveBeenCalledTimes(1);

      await listener.stop();
      await expect(
        lstat(path.join(root, "library-actor-v1.sock")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  posixIt("rejects multiple frames on one connection", async () => {
    const { stateRoot } = await fixture();
    const submitSignedIntentPage = vi.fn(async () => ({ accepted: true }));
    const listener =
      await createNodeLibraryServiceLocalActorIngressPortV1().start({
        stateRoot,
        expectedUserId: process.getuid!(),
        processor: createLibraryServiceLocalActorProcessorV1(
          { executeSignedQuery: vi.fn(), submitSignedIntentPage },
          { nowMs: () => 1_000 },
        ),
      });
    const valid = JSON.stringify({
      method: "submit_signed_intent_page_v1",
      payload: { page: { records: [] } },
      protocolVersion: 2,
      requestId: "2".repeat(64),
    });
    await expect(
      exchange(listener.endpoint, Buffer.from(`${valid}\n${valid}\n`)),
    ).resolves.toMatchObject({ errorCode: "frame_invalid", ok: false });
    expect(submitSignedIntentPage).not.toHaveBeenCalled();
    await listener.stop();
  });

  posixIt("never replaces a foreign object at the socket path", async () => {
    const { root, stateRoot } = await fixture();
    const endpoint = path.join(root, "library-actor-v1.sock");
    await writeFile(endpoint, "owned by something else", { mode: 0o600 });
    const start = createNodeLibraryServiceLocalActorIngressPortV1().start({
      stateRoot,
      expectedUserId: process.getuid!(),
      processor: { executeFrame: async () => new Uint8Array() },
    });
    await expect(start).rejects.toThrow("local_actor_socket_not_private");
    await expect(lstat(endpoint)).resolves.toSatisfy((value) => value.isFile());
  });
});
