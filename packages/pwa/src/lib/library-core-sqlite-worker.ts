import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  parseLibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerResponse,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

const DATABASE_FILENAME = "/freed-library-core-v1.sqlite3";
const OWNERSHIP_LOCK = "freed-library-core-sqlite-opfs-v1";
const VFS_DIRECTORY = "/freed-library-core-sqlite-opfs-v1";

interface WorkerScope {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: LibraryCoreSqliteWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
let engine: PwaLibraryCoreSqliteEngine | null = null;
let releaseOwnership: (() => void) | null = null;
let ownershipTask: Promise<unknown> | null = null;

async function acquireOwnership(): Promise<void> {
  if (!("locks" in navigator)) return;
  let resolveAcquired: (() => void) | null = null;
  let rejectAcquired: ((error: Error) => void) | null = null;
  const acquired = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  ownershipTask = navigator.locks.request(
    OWNERSHIP_LOCK,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) => {
      if (!lock) {
        rejectAcquired?.(
          new Error("PWA Library SQLite is already open in another app window"),
        );
        return;
      }
      resolveAcquired?.();
      await new Promise<void>((resolve) => {
        releaseOwnership = resolve;
      });
    },
  );
  await acquired;
}

async function open(): Promise<PwaLibraryCoreSqliteEngine> {
  if (engine) return engine;
  await acquireOwnership();
  try {
    const sqlite3 = await sqlite3InitModule();
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      directory: VFS_DIRECTORY,
      initialCapacity: 6,
      name: "freed-opfs-sahpool-v1",
    });
    const database = new pool.OpfsSAHPoolDb(DATABASE_FILENAME);
    const next = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    next.initialize();
    engine = next;
    return next;
  } catch (error) {
    releaseOwnership?.();
    releaseOwnership = null;
    await ownershipTask?.catch(() => undefined);
    ownershipTask = null;
    throw error;
  }
}

function failure(
  requestId: string,
  error: unknown,
): LibraryCoreSqliteWorkerResponse {
  const message =
    error instanceof Error ? error.message : "PWA Library SQLite failed";
  return {
    code: message.includes("already open")
      ? "library_busy"
      : message.includes("quick check") || message.includes("storage identity")
        ? "sqlite_integrity_failed"
        : engine === null
          ? "sqlite_initialization_failed"
          : "invalid_request",
    message,
    ok: false,
    requestId,
  };
}

scope.onmessage = (event) => {
  void (async () => {
    let requestId = "invalid";
    try {
      const request = parseLibraryCoreSqliteWorkerRequest(event.data);
      requestId = request.requestId;
      const active = request.kind === "open" ? await open() : engine;
      if (!active) throw new Error("PWA Library SQLite is not open");
      if (request.kind === "activate_normalized_checkpoint_stage") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.activateNormalizedCheckpointStage(request.stageId),
        });
        return;
      }
      if (request.kind === "begin_normalized_checkpoint_stage") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.beginNormalizedCheckpointStage(request.stage),
        });
        return;
      }
      if (request.kind === "append_normalized_checkpoint_stage_page") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.appendNormalizedCheckpointStagePage(request.page),
        });
        return;
      }
      if (request.kind === "query") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.query(request.query),
        });
        return;
      }
      if (request.kind === "mutate_device_graph_layout") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.mutateDeviceGraphLayout(request.mutation),
        });
        return;
      }
      const status = active.status();
      if (request.kind === "close") {
        active.close();
        engine = null;
        releaseOwnership?.();
        releaseOwnership = null;
        await ownershipTask?.catch(() => undefined);
        ownershipTask = null;
      }
      scope.postMessage({ ok: true, requestId, status });
      if (request.kind === "close") scope.close();
    } catch (error) {
      scope.postMessage(failure(requestId, error));
    }
  })();
};
