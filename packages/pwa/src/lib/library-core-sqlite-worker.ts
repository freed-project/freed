import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  parseLibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerResponse,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { PwaLibraryCoreOpfsContentVault } from "./library-core-opfs-content-vault";
import {
  PWA_LIBRARY_CORE_SQLITE_DATABASE_FILENAME,
  PWA_LIBRARY_CORE_SQLITE_OWNERSHIP_LOCK,
  PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY,
} from "./library-core-sqlite-storage";

interface WorkerScope {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: LibraryCoreSqliteWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
let engine: PwaLibraryCoreSqliteEngine | null = null;
let contentVault: PwaLibraryCoreOpfsContentVault | null = null;
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
    PWA_LIBRARY_CORE_SQLITE_OWNERSHIP_LOCK,
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
      directory: PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY,
      initialCapacity: 6,
      name: "freed-opfs-sahpool-v1",
    });
    const database = new pool.OpfsSAHPoolDb(
      PWA_LIBRARY_CORE_SQLITE_DATABASE_FILENAME,
    );
    const next = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    next.initialize();
    engine = next;
    contentVault = new PwaLibraryCoreOpfsContentVault(next);
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
          result: active.activateNormalizedCheckpointStage(request.activation),
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
      if (request.kind === "read_normalized_checkpoint_receipt") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.readNormalizedCheckpointReceipt(),
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
      if (request.kind === "begin_scope_action") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.beginScopeAction(
            request.stageId,
            request.request,
            request.createdAt,
          ),
        });
        return;
      }
      if (request.kind === "append_scope_action") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.appendScopeAction(
            request.stageId,
            request.expectedOrdinal,
            request.entityIds,
          ),
        });
        return;
      }
      if (request.kind === "finalize_scope_action") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.finalizeScopeAction(
            request.stageId,
            request.expectedMemberCount,
          ),
        });
        return;
      }
      if (request.kind === "page_scope_action") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.pageScopeAction(request.stageId, request.afterOrdinal),
        });
        return;
      }
      if (request.kind === "close_scope_action") {
        active.closeScopeAction(request.stageId);
        scope.postMessage({
          ok: true,
          requestId,
          result: { memberCount: 0, stageId: request.stageId, state: "ready" },
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
      if (request.kind === "mutate_content_policy") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.mutateContentPolicy(request.mutation),
        });
        return;
      }
      if (request.kind === "read_content_state") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.readContentState(request.request),
        });
        return;
      }
      if (request.kind === "begin_content_range_publication") {
        if (!contentVault) throw new Error("PWA content vault is not open");
        scope.postMessage({
          ok: true,
          requestId,
          result: await contentVault.begin(request.publication),
        });
        return;
      }
      if (request.kind === "append_content_range_publication") {
        if (!contentVault) throw new Error("PWA content vault is not open");
        scope.postMessage({
          ok: true,
          requestId,
          result: await contentVault.append(request.publication),
        });
        return;
      }
      if (request.kind === "finalize_content_range_publication") {
        if (!contentVault) throw new Error("PWA content vault is not open");
        scope.postMessage({
          ok: true,
          requestId,
          result: await contentVault.finalize(request.publication),
        });
        return;
      }
      if (request.kind === "abort_content_range_publication") {
        if (!contentVault) throw new Error("PWA content vault is not open");
        scope.postMessage({
          ok: true,
          requestId,
          result: {
            publicationId: request.publication.publicationId,
            removed: await contentVault.abort(request.publication),
            schemaVersion: 1,
          },
        });
        return;
      }
      if (request.kind === "commit_follower_intent") {
        scope.postMessage({
          ok: true,
          requestId,
          result: await active.commitFollowerIntent(request.commit),
        });
        return;
      }
      if (request.kind === "follower_mutation_context") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.followerMutationContext(),
        });
        return;
      }
      if (request.kind === "follower_transport_context") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.followerTransportContext(),
        });
        return;
      }
      if (request.kind === "page_follower_intents") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.pageFollowerIntents(request.page),
        });
        return;
      }
      if (request.kind === "page_follower_transport") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.pageFollowerTransport(request.page),
        });
        return;
      }
      if (request.kind === "publish_follower_intent") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.publishFollowerIntent(request.publication),
        });
        return;
      }
      if (request.kind === "apply_follower_result") {
        scope.postMessage({
          ok: true,
          requestId,
          result: await active.applyFollowerResult(request.apply),
        });
        return;
      }
      if (request.kind === "publish_normalized_follower_intent_transport") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.publishNormalizedFollowerIntentTransport(
            request.publication,
          ),
        });
        return;
      }
      if (request.kind === "import_normalized_follower_result_transport") {
        scope.postMessage({
          ok: true,
          requestId,
          result: await active.importNormalizedFollowerResultTransport(
            request.import,
          ),
        });
        return;
      }
      if (request.kind === "read_follower_actor_enrollment_context") {
        scope.postMessage({
          ok: true,
          requestId,
          result: active.followerActorEnrollmentContext(),
        });
        return;
      }
      if (request.kind === "store_follower_actor_request") {
        scope.postMessage({
          ok: true,
          requestId,
          result: await active.storeFollowerActorRequest(request.store),
        });
        return;
      }
      if (request.kind === "install_follower_actor_enrollment") {
        scope.postMessage({
          ok: true,
          requestId,
          result: await active.installFollowerActorEnrollment(request.install),
        });
        return;
      }
      const status = active.status();
      if (request.kind === "close") {
        await contentVault?.close();
        contentVault = null;
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
