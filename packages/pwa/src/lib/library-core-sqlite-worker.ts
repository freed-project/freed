import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  parseLibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerResponse,
  type LibraryCoreSqliteWorkerResult,
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
  readonly location: Location;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: LibraryCoreSqliteWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
let engine: PwaLibraryCoreSqliteEngine | null = null;
let contentVault: PwaLibraryCoreOpfsContentVault | null = null;
let releaseOwnership: (() => void) | null = null;
let ownershipTask: Promise<unknown> | null = null;

/**
 * A dedicated worker has no ambient message bus. Its creator owns the only
 * ordinary postMessage capability. Browsers expose creator messages as trusted
 * events with no MessageEvent source. The origin is either the worker origin or
 * the empty string required by the dedicated-worker messaging algorithm.
 *
 * Keep this check outside command dispatch. Command `kind` selects one member
 * of a closed, fully parsed protocol union. It is routing data, not an
 * authorization decision.
 */
function isAcceptedWorkerMessage(event: MessageEvent<unknown>): boolean {
  const originAccepted =
    event.origin === "" || event.origin === scope.location.origin;
  return event.isTrusted && event.source === null && originAccepted;
}

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
  let openingEngine: PwaLibraryCoreSqliteEngine | null = null;
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
    openingEngine = next;
    next.initialize();
    const nextContentVault = new PwaLibraryCoreOpfsContentVault(next);
    await nextContentVault.reconcile();
    engine = next;
    contentVault = nextContentVault;
    openingEngine = null;
    return next;
  } catch (error) {
    openingEngine?.close();
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

type WorkerRequest<K extends LibraryCoreSqliteWorkerRequest["kind"]> = Extract<
  LibraryCoreSqliteWorkerRequest,
  Readonly<{ kind: K }>
>;

type WorkerCommand = Readonly<{
  closeAfterResponse: boolean;
  execute: () =>
    LibraryCoreSqliteWorkerResponse | Promise<LibraryCoreSqliteWorkerResponse>;
  requestId: string;
}>;

function requireEngine(): PwaLibraryCoreSqliteEngine {
  if (!engine) throw new Error("PWA Library SQLite is not open");
  return engine;
}

function requireContentVault(): PwaLibraryCoreOpfsContentVault {
  if (!contentVault) throw new Error("PWA content vault is not open");
  return contentVault;
}

function result(
  requestId: string,
  value: LibraryCoreSqliteWorkerResult,
): LibraryCoreSqliteWorkerResponse {
  return { ok: true, requestId, result: value };
}

function bindCommand<K extends LibraryCoreSqliteWorkerRequest["kind"]>(
  request: WorkerRequest<K>,
  execute: (
    request: WorkerRequest<K>,
  ) =>
    LibraryCoreSqliteWorkerResponse | Promise<LibraryCoreSqliteWorkerResponse>,
  closeAfterResponse = false,
): WorkerCommand {
  return {
    closeAfterResponse,
    execute: () => execute(request),
    requestId: request.requestId,
  };
}

async function executeOpen(
  request: WorkerRequest<"open">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  const active = await open();
  return { ok: true, requestId: request.requestId, status: active.status() };
}

function executeStatus(
  request: WorkerRequest<"status">,
): LibraryCoreSqliteWorkerResponse {
  return {
    ok: true,
    requestId: request.requestId,
    status: requireEngine().status(),
  };
}

async function executeClose(
  request: WorkerRequest<"close">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  const active = requireEngine();
  const status = active.status();
  await contentVault?.close();
  contentVault = null;
  active.close();
  engine = null;
  releaseOwnership?.();
  releaseOwnership = null;
  await ownershipTask?.catch(() => undefined);
  ownershipTask = null;
  return { ok: true, requestId: request.requestId, status };
}

async function executeActivateCheckpoint(
  request: WorkerRequest<"activate_normalized_checkpoint_stage">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  const active = requireEngine();
  await active.verifyNormalizedCheckpointActorRetirements(
    request.activation.stageId,
  );
  return result(
    request.requestId,
    active.activateNormalizedCheckpointStage(request.activation),
  );
}

function executeBeginCheckpoint(
  request: WorkerRequest<"begin_normalized_checkpoint_stage">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().beginNormalizedCheckpointStage(request.stage),
  );
}

function executeReadCheckpointReceipt(
  request: WorkerRequest<"read_normalized_checkpoint_receipt">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().readNormalizedCheckpointReceipt(),
  );
}

function executeAppendCheckpointPage(
  request: WorkerRequest<"append_normalized_checkpoint_stage_page">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().appendNormalizedCheckpointStagePage(request.page),
  );
}

function executeQuery(
  request: WorkerRequest<"query">,
): LibraryCoreSqliteWorkerResponse {
  return result(request.requestId, requireEngine().query(request.query));
}

function executeBeginScopeAction(
  request: WorkerRequest<"begin_scope_action">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().beginScopeAction(
      request.stageId,
      request.request,
      request.createdAt,
    ),
  );
}

function executeAppendScopeAction(
  request: WorkerRequest<"append_scope_action">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().appendScopeAction(
      request.stageId,
      request.expectedOrdinal,
      request.entityIds,
    ),
  );
}

function executeFinalizeScopeAction(
  request: WorkerRequest<"finalize_scope_action">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().finalizeScopeAction(
      request.stageId,
      request.expectedMemberCount,
    ),
  );
}

function executePageScopeAction(
  request: WorkerRequest<"page_scope_action">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().pageScopeAction(request.stageId, request.afterOrdinal),
  );
}

function executeCloseScopeAction(
  request: WorkerRequest<"close_scope_action">,
): LibraryCoreSqliteWorkerResponse {
  requireEngine().closeScopeAction(request.stageId);
  return result(request.requestId, {
    memberCount: 0,
    stageId: request.stageId,
    state: "ready",
  });
}

function executeMutateDeviceGraphLayout(
  request: WorkerRequest<"mutate_device_graph_layout">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().mutateDeviceGraphLayout(request.mutation),
  );
}

function executeQueryDeviceContacts(
  request: WorkerRequest<"query_device_contacts">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().queryDeviceContacts(request.query),
  );
}

function executeMutateDeviceContacts(
  request: WorkerRequest<"mutate_device_contacts">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().mutateDeviceContactSync(request.mutation),
  );
}

async function executeMutateContentPolicy(
  request: WorkerRequest<"mutate_content_policy">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  const receipt = requireEngine().mutateContentPolicy(request.mutation);
  let contentRevision = receipt.contentRevision;
  if (request.mutation.policy === "excluded") {
    const eviction = await requireContentVault().evict({
      contentDigest: request.mutation.contentDigest,
      evictedAt: request.mutation.updatedAt,
      expectedLastAccessedAt: null,
      reason: "excluded",
      schemaVersion: 1,
    });
    contentRevision = eviction.contentRevision;
  }
  return result(request.requestId, { ...receipt, contentRevision });
}

function executeReadContentState(
  request: WorkerRequest<"read_content_state">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().readContentState(request.request),
  );
}

async function executeReadContentRange(
  request: WorkerRequest<"read_content_range">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().read(request.request),
  );
}

async function executeVerifyContentComplete(
  request: WorkerRequest<"verify_content_complete">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().verifyComplete(request.request),
  );
}

async function executeEvictContent(
  request: WorkerRequest<"evict_content">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().evict(request.request),
  );
}

function executePageHydrationCandidates(
  request: WorkerRequest<"page_hydration_candidates">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().pageHydrationCandidates(request.request),
  );
}

function executePageEvictionCandidates(
  request: WorkerRequest<"page_eviction_candidates">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().pageEvictionCandidates(request.request),
  );
}

async function executeBeginContentPublication(
  request: WorkerRequest<"begin_content_range_publication">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().begin(request.publication),
  );
}

async function executeAppendContentPublication(
  request: WorkerRequest<"append_content_range_publication">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().append(request.publication),
  );
}

async function executeFinalizeContentPublication(
  request: WorkerRequest<"finalize_content_range_publication">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireContentVault().finalize(request.publication),
  );
}

async function executeAbortContentPublication(
  request: WorkerRequest<"abort_content_range_publication">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(request.requestId, {
    publicationId: request.publication.publicationId,
    removed: await requireContentVault().abort(request.publication),
    schemaVersion: 1,
  });
}

async function executeCommitFollowerIntent(
  request: WorkerRequest<"commit_follower_intent">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireEngine().commitFollowerIntent(request.commit),
  );
}

function executeFollowerMutationContext(
  request: WorkerRequest<"follower_mutation_context">,
): LibraryCoreSqliteWorkerResponse {
  return result(request.requestId, requireEngine().followerMutationContext());
}

function executeFollowerTransportContext(
  request: WorkerRequest<"follower_transport_context">,
): LibraryCoreSqliteWorkerResponse {
  return result(request.requestId, requireEngine().followerTransportContext());
}

function executePageFollowerIntents(
  request: WorkerRequest<"page_follower_intents">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().pageFollowerIntents(request.page),
  );
}

function executePageFollowerTransport(
  request: WorkerRequest<"page_follower_transport">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().pageFollowerTransport(request.page),
  );
}

function executePublishFollowerIntent(
  request: WorkerRequest<"publish_follower_intent">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().publishFollowerIntent(request.publication),
  );
}

async function executeApplyFollowerResult(
  request: WorkerRequest<"apply_follower_result">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireEngine().applyFollowerResult(request.apply),
  );
}

function executePublishNormalizedIntentTransport(
  request: WorkerRequest<"publish_normalized_follower_intent_transport">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().publishNormalizedFollowerIntentTransport(
      request.publication,
    ),
  );
}

async function executeImportNormalizedResultTransport(
  request: WorkerRequest<"import_normalized_follower_result_transport">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireEngine().importNormalizedFollowerResultTransport(
      request.import,
    ),
  );
}

function executeReadFollowerEnrollmentContext(
  request: WorkerRequest<"read_follower_actor_enrollment_context">,
): LibraryCoreSqliteWorkerResponse {
  return result(
    request.requestId,
    requireEngine().followerActorEnrollmentContext(),
  );
}

async function executeStoreFollowerActorRequest(
  request: WorkerRequest<"store_follower_actor_request">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireEngine().storeFollowerActorRequest(request.store),
  );
}

async function executeInstallFollowerEnrollment(
  request: WorkerRequest<"install_follower_actor_enrollment">,
): Promise<LibraryCoreSqliteWorkerResponse> {
  return result(
    request.requestId,
    await requireEngine().installFollowerActorEnrollment(request.install),
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported SQLite worker request: ${String(value)}`);
}

/**
 * Parsing establishes a closed protocol union. This compiler maps every fixed
 * protocol member to one fixed operation before any database or vault method is
 * invoked. The executable command has no request-controlled permission check or
 * dynamic method lookup.
 */
function compileCommand(
  request: LibraryCoreSqliteWorkerRequest,
): WorkerCommand {
  switch (request.kind) {
    case "open":
      return bindCommand(request, executeOpen);
    case "status":
      return bindCommand(request, executeStatus);
    case "close":
      return bindCommand(request, executeClose, true);
    case "activate_normalized_checkpoint_stage":
      return bindCommand(request, executeActivateCheckpoint);
    case "begin_normalized_checkpoint_stage":
      return bindCommand(request, executeBeginCheckpoint);
    case "read_normalized_checkpoint_receipt":
      return bindCommand(request, executeReadCheckpointReceipt);
    case "append_normalized_checkpoint_stage_page":
      return bindCommand(request, executeAppendCheckpointPage);
    case "query":
      return bindCommand(request, executeQuery);
    case "begin_scope_action":
      return bindCommand(request, executeBeginScopeAction);
    case "append_scope_action":
      return bindCommand(request, executeAppendScopeAction);
    case "finalize_scope_action":
      return bindCommand(request, executeFinalizeScopeAction);
    case "page_scope_action":
      return bindCommand(request, executePageScopeAction);
    case "close_scope_action":
      return bindCommand(request, executeCloseScopeAction);
    case "mutate_device_graph_layout":
      return bindCommand(request, executeMutateDeviceGraphLayout);
    case "query_device_contacts":
      return bindCommand(request, executeQueryDeviceContacts);
    case "mutate_device_contacts":
      return bindCommand(request, executeMutateDeviceContacts);
    case "mutate_content_policy":
      return bindCommand(request, executeMutateContentPolicy);
    case "read_content_state":
      return bindCommand(request, executeReadContentState);
    case "read_content_range":
      return bindCommand(request, executeReadContentRange);
    case "verify_content_complete":
      return bindCommand(request, executeVerifyContentComplete);
    case "evict_content":
      return bindCommand(request, executeEvictContent);
    case "page_hydration_candidates":
      return bindCommand(request, executePageHydrationCandidates);
    case "page_eviction_candidates":
      return bindCommand(request, executePageEvictionCandidates);
    case "begin_content_range_publication":
      return bindCommand(request, executeBeginContentPublication);
    case "append_content_range_publication":
      return bindCommand(request, executeAppendContentPublication);
    case "finalize_content_range_publication":
      return bindCommand(request, executeFinalizeContentPublication);
    case "abort_content_range_publication":
      return bindCommand(request, executeAbortContentPublication);
    case "commit_follower_intent":
      return bindCommand(request, executeCommitFollowerIntent);
    case "follower_mutation_context":
      return bindCommand(request, executeFollowerMutationContext);
    case "follower_transport_context":
      return bindCommand(request, executeFollowerTransportContext);
    case "page_follower_intents":
      return bindCommand(request, executePageFollowerIntents);
    case "page_follower_transport":
      return bindCommand(request, executePageFollowerTransport);
    case "publish_follower_intent":
      return bindCommand(request, executePublishFollowerIntent);
    case "apply_follower_result":
      return bindCommand(request, executeApplyFollowerResult);
    case "publish_normalized_follower_intent_transport":
      return bindCommand(request, executePublishNormalizedIntentTransport);
    case "import_normalized_follower_result_transport":
      return bindCommand(request, executeImportNormalizedResultTransport);
    case "read_follower_actor_enrollment_context":
      return bindCommand(request, executeReadFollowerEnrollmentContext);
    case "store_follower_actor_request":
      return bindCommand(request, executeStoreFollowerActorRequest);
    case "install_follower_actor_enrollment":
      return bindCommand(request, executeInstallFollowerEnrollment);
    default:
      return assertNever(request);
  }
}

scope.onmessage = (event) => {
  if (!isAcceptedWorkerMessage(event)) return;
  void (async () => {
    let requestId = "invalid";
    try {
      const request = parseLibraryCoreSqliteWorkerRequest(event.data);
      const command = compileCommand(request);
      requestId = command.requestId;
      scope.postMessage(await command.execute());
      if (command.closeAfterResponse) scope.close();
    } catch (error) {
      scope.postMessage(failure(requestId, error));
    }
  })();
};
