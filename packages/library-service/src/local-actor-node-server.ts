import { chmod, lstat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";

import type { LibraryServiceBoundPath } from "./contracts.js";
import {
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_ACTIVE_CONNECTIONS,
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUEST_FRAME_BYTES,
  LIBRARY_CORE_LOCAL_ACTOR_REQUEST_TIMEOUT_MS,
} from "./library-core-command-contract.generated.js";
import {
  encodeLibraryServiceLocalActorFailureV1,
  type LibraryServiceLocalActorIngressPortV1,
  type LibraryServiceLocalActorListenerV1,
  type LibraryServiceLocalActorProcessorV1,
} from "./local-actor-transport.js";

const SOCKET_FILE = "library-actor-v1.sock";
const UNIX_SOCKET_PATH_MAXIMUM_BYTES = 103;

function socketEndpoint(stateRootPath: string, expectedUserId: number): string {
  const preferred = path.join(stateRootPath, SOCKET_FILE);
  if (Buffer.byteLength(preferred, "utf8") <= UNIX_SOCKET_PATH_MAXIMUM_BYTES) {
    return preferred;
  }
  const identity = createHash("sha256")
    .update(stateRootPath, "utf8")
    .digest("hex")
    .slice(0, 24);
  return path.join(
    "/tmp",
    `freed-library-${expectedUserId.toLocaleString("en-US", {
      useGrouping: false,
    })}-${identity}.sock`,
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function removeOwnedSocket(
  endpoint: string,
  expectedUserId: number,
  expectedIdentity?: { readonly device: bigint; readonly inode: bigint },
): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(endpoint, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (
    !metadata.isSocket() ||
    Number(metadata.uid) !== expectedUserId ||
    Number(metadata.mode & 0o7777n) !== 0o600 ||
    Number(metadata.nlink) !== 1 ||
    (expectedIdentity !== undefined &&
      (metadata.dev !== expectedIdentity.device ||
        metadata.ino !== expectedIdentity.inode))
  ) {
    throw new Error("local_actor_socket_not_private");
  }
  await unlink(endpoint);
}

function writeAndClose(socket: Socket, response: Uint8Array): void {
  socket.end(response);
}

function serveConnection(
  socket: Socket,
  processor: LibraryServiceLocalActorProcessorV1,
  release: () => void,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let inputSettled = false;
  let responseSettled = false;
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release();
  };
  const respond = (response: Uint8Array): void => {
    if (responseSettled) return;
    responseSettled = true;
    writeAndClose(socket, response);
  };
  socket.once("close", releaseOnce);
  socket.once("error", releaseOnce);
  socket.setTimeout(LIBRARY_CORE_LOCAL_ACTOR_REQUEST_TIMEOUT_MS, () => {
    const errorCode = inputSettled ? "request_failed" : "frame_invalid";
    inputSettled = true;
    respond(encodeLibraryServiceLocalActorFailureV1(errorCode));
  });
  socket.on("data", (chunk: Buffer) => {
    if (inputSettled) return;
    total += chunk.byteLength;
    if (total > LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUEST_FRAME_BYTES + 1) {
      inputSettled = true;
      respond(encodeLibraryServiceLocalActorFailureV1("frame_invalid"));
      return;
    }
    chunks.push(chunk);
    const bytes = Buffer.concat(chunks, total);
    const newline = bytes.indexOf(0x0a);
    if (newline < 0) return;
    inputSettled = true;
    socket.pause();
    if (newline !== bytes.byteLength - 1 || newline === 0) {
      respond(encodeLibraryServiceLocalActorFailureV1("frame_invalid"));
      return;
    }
    void processor.executeFrame(bytes.subarray(0, newline)).then(
      (response) => respond(response),
      () => respond(encodeLibraryServiceLocalActorFailureV1("request_failed")),
    );
  });
  socket.once("end", () => {
    if (inputSettled) return;
    inputSettled = true;
    respond(encodeLibraryServiceLocalActorFailureV1("frame_invalid"));
  });
}

async function listen(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

export function createNodeLibraryServiceLocalActorIngressPortV1(): LibraryServiceLocalActorIngressPortV1 {
  return Object.freeze({
    async start(input: {
      readonly stateRoot: LibraryServiceBoundPath;
      readonly expectedUserId: number;
      readonly processor: LibraryServiceLocalActorProcessorV1;
    }): Promise<LibraryServiceLocalActorListenerV1> {
      const { stateRoot, expectedUserId, processor } = input;
      if (process.platform === "win32") {
        throw new Error("local_actor_secure_named_pipe_unavailable");
      }
      await stateRoot.assertStable();
      await stateRoot.assertPathStable();
      await stateRoot.assertCanonicalPath();
      const endpoint = socketEndpoint(stateRoot.path, expectedUserId);
      await removeOwnedSocket(endpoint, expectedUserId);

      let activeConnections = 0;
      const sockets = new Set<Socket>();
      const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        if (
          activeConnections >=
          LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_ACTIVE_CONNECTIONS
        ) {
          writeAndClose(
            socket,
            encodeLibraryServiceLocalActorFailureV1("busy"),
          );
          return;
        }
        activeConnections += 1;
        serveConnection(socket, processor, () => {
          activeConnections = Math.max(0, activeConnections - 1);
        });
      });
      server.on("connection", (socket) => socket.unref());
      let createdIdentity:
        | { readonly device: bigint; readonly inode: bigint }
        | undefined;
      try {
        await listen(server, endpoint);
        await chmod(endpoint, 0o600);
        const metadata = await lstat(endpoint, { bigint: true });
        if (
          !metadata.isSocket() ||
          Number(metadata.uid) !== expectedUserId ||
          Number(metadata.mode & 0o7777n) !== 0o600 ||
          Number(metadata.nlink) !== 1
        ) {
          throw new Error("local_actor_socket_not_private");
        }
        await stateRoot.assertStable();
        await stateRoot.assertPathStable();
        await stateRoot.assertCanonicalPath();
        createdIdentity = { device: metadata.dev, inode: metadata.ino };
        const identity = createdIdentity;
        let stopping = false;
        let stopPromise: Promise<void> | null = null;
        let rejectFailure!: (error: unknown) => void;
        const failure = new Promise<never>((_resolve, reject) => {
          rejectFailure = reject;
        });
        server.on("error", (error) => {
          if (!stopping) rejectFailure(error);
        });
        server.unref();
        return Object.freeze({
          endpoint,
          failure,
          stop(): Promise<void> {
            if (stopPromise !== null) return stopPromise;
            stopping = true;
            stopPromise = (async () => {
              for (const socket of sockets) socket.destroy();
              await new Promise<void>((resolve) =>
                server.close(() => resolve()),
              );
              await removeOwnedSocket(
                endpoint,
                expectedUserId,
                identity,
              );
            })();
            return stopPromise;
          },
        });
      } catch (error) {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) =>
          server.close(() => resolve()),
        ).catch(() => undefined);
        if (createdIdentity !== undefined) {
          await removeOwnedSocket(
            endpoint,
            expectedUserId,
            createdIdentity,
          ).catch(() => undefined);
        }
        throw error;
      }
    },
  });
}
