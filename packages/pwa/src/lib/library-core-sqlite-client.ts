import {
  LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest,
  createLibraryCoreSqliteDescribeCheckpointExportWorkerRequest,
  createLibraryCoreSqliteReadCheckpointExportPageWorkerRequest,
  createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest,
  createLibraryCoreSqliteDeviceContactMutationWorkerRequest,
  createLibraryCoreSqliteDeviceContactQueryWorkerRequest,
  createLibraryCoreSqliteContentPolicyMutationWorkerRequest,
  createLibraryCoreSqliteContentStateWorkerRequest,
  createLibraryCoreSqliteContentRangePublicationAbortWorkerRequest,
  createLibraryCoreSqliteContentRangePublicationAppendWorkerRequest,
  createLibraryCoreSqliteContentRangePublicationBeginWorkerRequest,
  createLibraryCoreSqliteContentRangePublicationFinalizeWorkerRequest,
  createLibraryCoreSqliteContentRangeReadWorkerRequest,
  createLibraryCoreSqliteContentCompletionWorkerRequest,
  createLibraryCoreSqliteContentEvictionWorkerRequest,
  createLibraryCoreSqliteEvictionCandidatePageWorkerRequest,
  createLibraryCoreSqliteHydrationCandidatePageWorkerRequest,
  createLibraryCoreSqliteBeginScopeActionWorkerRequest,
  createLibraryCoreSqliteAppendScopeActionWorkerRequest,
  createLibraryCoreSqliteFinalizeScopeActionWorkerRequest,
  createLibraryCoreSqlitePageScopeActionWorkerRequest,
  createLibraryCoreSqliteCloseScopeActionWorkerRequest,
  createLibraryCoreSqliteFollowerIntentCommitWorkerRequest,
  createLibraryCoreSqliteFollowerMutationContextWorkerRequest,
  createLibraryCoreSqliteFollowerTransportContextWorkerRequest,
  createLibraryCoreSqliteFollowerTransportPageWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPageWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest,
  createLibraryCoreSqliteFollowerResultApplyWorkerRequest,
  createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest,
  createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest,
  createLibraryCoreSqliteNormalizedOperationImportWorkerRequest,
  createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest,
  createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest,
  createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest,
  createLibraryCoreSqliteWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
  parseLibraryCoreSqliteWorkerStatus,
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  parseLibraryCoreDeviceContactMutationReceiptV1,
  parseLibraryCoreDeviceContactQueryResponseV1,
  parseLibraryCoreContentPolicyMutationReceiptV1,
  parseLibraryCoreContentStateV1,
  parseLibraryCoreContentRangePublicationStatusV1,
  parseLibraryCoreVerifiedContentRangeReceiptV1,
  parseLibraryCoreContentRangePublicationAbortReceiptV1,
  parseLibraryCoreSqliteCheckpointSelectionResponse,
  parseLibraryCoreNormalizedCheckpointStageStatusV2,
  parseLibraryCoreNormalizedCheckpointActivationReceiptV2,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointExportPageV2,
  parseLibraryCoreSqliteFollowerMutationContextResponse,
  parseLibraryCoreFollowerTransportContextV2,
  parseLibraryCoreFollowerTransportPageResponseV2,
  parseLibraryCoreFollowerIntentPageResponseV1,
  parseLibraryCoreFollowerIntentCommitResultV1,
  parseLibraryCoreFollowerIntentPublicationReceiptV1,
  parseLibraryCoreFollowerResultApplyReceiptV1,
  parseLibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  parseLibraryCoreNormalizedResultTransportImportReceiptV2,
  parseLibraryCoreNormalizedOperationImportReceiptV2,
  parseLibraryCoreFollowerActorEnrollmentContextV2,
  parseLibraryCoreFollowerActorRequestReceiptV2,
  parseLibraryCoreFollowerActorEnrollmentReceiptV2,
  parseLibraryCoreScopeActionStageStatusV1,
  parseLibraryCoreScopeActionStagePageV1,
  parseLibraryCoreContentRangeReadResponseV1,
  parseLibraryCoreContentCompletionReceiptV1,
  parseLibraryCoreContentEvictionReceiptV1,
  parseLibraryCoreEvictionCandidatePageV1,
  parseLibraryCoreHydrationCandidatePageV1,
  type LibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerStatus,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreDeviceContactMutationReceiptV1,
  type LibraryCoreDeviceContactQueryRequestV1,
  type LibraryCoreDeviceContactQueryResponseV1,
  type LibraryCoreDeviceContactSyncMutationV1,
  type LibraryCoreContentPolicyMutationReceiptV1,
  type LibraryCoreContentPolicyMutationV1,
  type LibraryCoreContentStateRequestV1,
  type LibraryCoreContentStateV1,
  type LibraryCoreContentRangePublicationAbortReceiptV1,
  type LibraryCoreContentRangePublicationAbortV1,
  type LibraryCoreContentRangePublicationAppendV1,
  type LibraryCoreContentRangePublicationBeginV1,
  type LibraryCoreContentRangePublicationFinalizeV1,
  type LibraryCoreContentRangePublicationStatusV1,
  type LibraryCoreContentRangeReadRequestV1,
  type LibraryCoreContentRangeReadResponseV1,
  type LibraryCoreContentCompletionReceiptV1,
  type LibraryCoreContentCompletionRequestV1,
  type LibraryCoreContentEvictionReceiptV1,
  type LibraryCoreContentEvictionRequestV1,
  type LibraryCoreEvictionCandidatePageRequestV1,
  type LibraryCoreEvictionCandidatePageV1,
  type LibraryCoreHydrationCandidatePageRequestV1,
  type LibraryCoreHydrationCandidatePageV1,
  type LibraryCoreVerifiedContentRangeReceiptV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreFollowerTransportContextV2,
  type LibraryCoreFollowerTransportPageRequestV2,
  type LibraryCoreFollowerTransportPageResponseV2,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerIntentPublicationReceiptV1,
  type LibraryCoreFollowerIntentPublicationV1,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
  type LibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  type LibraryCoreNormalizedIntentTransportPublicationV2,
  type LibraryCoreNormalizedResultTransportImportReceiptV2,
  type LibraryCoreNormalizedResultTransportImportV2,
  type LibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedOperationImportReceiptV2,
  type LibraryCoreFollowerActorEnrollmentContextV2,
  type LibraryCoreFollowerActorEnrollmentReceiptV2,
  type LibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreInstallFollowerActorEnrollmentV2,
  type LibraryCoreStoreFollowerActorRequestV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreActivateNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointSelectionV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCorePinnedNormalizedCheckpointExportRequestV2,
  type LibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreScopeActionStagePageV1,
  type LibraryCoreScopeActionStageStatusV1,
} from "@freed/shared/library-core";

const REQUEST_TIMEOUT_MS = 30_000;
const WORKER_ERROR_MAXIMUM_UTF8_BYTES = 4_096;
const textEncoder = new TextEncoder();

type ParseResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ error: string; ok: false }>;

function unwrapParseResult<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new TypeError(result.error);
  return result.value;
}

function closedResponseRecord(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) => !descriptor.enumerable || !("value" in descriptor),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      descriptor.value,
    ]),
  );
}

function exactResponseKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

interface PendingRequest<T = unknown> {
  readonly field: "result" | "status";
  readonly parse: (value: unknown) => T;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: T) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class PwaLibraryCoreSqliteClient {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #worker: Worker;
  #closed = false;

  constructor() {
    const memoryE2eRequested =
      (
        globalThis as typeof globalThis & {
          __FREED_PWA_SQLITE_MEMORY_E2E__?: boolean;
        }
      ).__FREED_PWA_SQLITE_MEMORY_E2E__ === true;
    const useMemoryE2eWorker =
      import.meta.env.VITE_FREED_PWA_SQLITE_MEMORY_E2E === "1" &&
      memoryE2eRequested;
    this.#worker = useMemoryE2eWorker
      ? new Worker(
          new URL("./library-core-sqlite-worker.ts", import.meta.url),
          { name: "freed-library-core-sqlite-memory-e2e", type: "module" },
        )
      : new Worker(
          new URL("./library-core-sqlite-worker.ts", import.meta.url),
          { name: "freed-library-core-sqlite", type: "module" },
        );
    this.#worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.#receive(event.data);
    });
    this.#worker.addEventListener("error", () => {
      this.#failAll(
        new Error("PWA Library SQLite worker stopped unexpectedly"),
      );
    });
  }

  open(): Promise<LibraryCoreSqliteWorkerStatus> {
    return this.#request("open");
  }

  status(): Promise<LibraryCoreSqliteWorkerStatus> {
    return this.#request("status");
  }

  query<T extends LibraryCoreSqliteQueryRequest>(
    query: T,
  ): Promise<LibraryCoreSqliteQueryResponseFor<T>> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteQueryWorkerRequest(requestId, query),
      (response) => parseLibraryCoreSqliteQueryResponse(response, query),
    );
  }

  mutateDeviceGraphLayout(
    mutation: LibraryCoreDeviceGraphLayoutMutationV1,
  ): Promise<LibraryCoreDeviceGraphLayoutMutationResultV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest(
          requestId,
          mutation,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreDeviceGraphLayoutMutationResultV1(value),
        ),
    );
  }

  mutateDeviceContactSync(
    mutation: LibraryCoreDeviceContactSyncMutationV1,
  ): Promise<LibraryCoreDeviceContactMutationReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteDeviceContactMutationWorkerRequest(
          requestId,
          mutation,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreDeviceContactMutationReceiptV1(value),
        ),
    );
  }

  queryDeviceContacts(
    query: LibraryCoreDeviceContactQueryRequestV1,
  ): Promise<LibraryCoreDeviceContactQueryResponseV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteDeviceContactQueryWorkerRequest(
          requestId,
          query,
        ),
      (response) =>
        unwrapParseResult(
          parseLibraryCoreDeviceContactQueryResponseV1(response, query),
        ),
    );
  }

  mutateContentPolicy(
    mutation: LibraryCoreContentPolicyMutationV1,
  ): Promise<LibraryCoreContentPolicyMutationReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentPolicyMutationWorkerRequest(
          requestId,
          mutation,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreContentPolicyMutationReceiptV1(value),
        ),
    );
  }

  readContentState(
    request: LibraryCoreContentStateRequestV1,
  ): Promise<LibraryCoreContentStateV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentStateWorkerRequest(requestId, request),
      (value) => unwrapParseResult(parseLibraryCoreContentStateV1(value)),
    );
  }

  readContentRange(
    request: LibraryCoreContentRangeReadRequestV1,
  ): Promise<LibraryCoreContentRangeReadResponseV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentRangeReadWorkerRequest(
          requestId,
          request,
        ),
      (value) =>
        unwrapParseResult(parseLibraryCoreContentRangeReadResponseV1(value)),
    );
  }

  verifyContentComplete(
    request: LibraryCoreContentCompletionRequestV1,
  ): Promise<LibraryCoreContentCompletionReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentCompletionWorkerRequest(
          requestId,
          request,
        ),
      (value) =>
        unwrapParseResult(parseLibraryCoreContentCompletionReceiptV1(value)),
    );
  }

  evictContent(
    request: LibraryCoreContentEvictionRequestV1,
  ): Promise<LibraryCoreContentEvictionReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentEvictionWorkerRequest(requestId, request),
      (value) =>
        unwrapParseResult(parseLibraryCoreContentEvictionReceiptV1(value)),
    );
  }

  pageHydrationCandidates(
    request: LibraryCoreHydrationCandidatePageRequestV1,
  ): Promise<LibraryCoreHydrationCandidatePageV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteHydrationCandidatePageWorkerRequest(
          requestId,
          request,
        ),
      (value) =>
        unwrapParseResult(parseLibraryCoreHydrationCandidatePageV1(value)),
    );
  }

  pageEvictionCandidates(
    request: LibraryCoreEvictionCandidatePageRequestV1,
  ): Promise<LibraryCoreEvictionCandidatePageV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteEvictionCandidatePageWorkerRequest(
          requestId,
          request,
        ),
      (value) =>
        unwrapParseResult(parseLibraryCoreEvictionCandidatePageV1(value)),
    );
  }

  beginContentRangePublication(
    publication: LibraryCoreContentRangePublicationBeginV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentRangePublicationBeginWorkerRequest(
          requestId,
          publication,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreContentRangePublicationStatusV1(value),
        ),
    );
  }

  appendContentRangePublication(
    publication: LibraryCoreContentRangePublicationAppendV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentRangePublicationAppendWorkerRequest(
          requestId,
          publication,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreContentRangePublicationStatusV1(value),
        ),
    );
  }

  finalizeContentRangePublication(
    publication: LibraryCoreContentRangePublicationFinalizeV1,
  ): Promise<LibraryCoreVerifiedContentRangeReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentRangePublicationFinalizeWorkerRequest(
          requestId,
          publication,
        ),
      (value) =>
        unwrapParseResult(parseLibraryCoreVerifiedContentRangeReceiptV1(value)),
    );
  }

  abortContentRangePublication(
    publication: LibraryCoreContentRangePublicationAbortV1,
  ): Promise<LibraryCoreContentRangePublicationAbortReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteContentRangePublicationAbortWorkerRequest(
          requestId,
          publication,
        ),
      (value) =>
        unwrapParseResult(
          parseLibraryCoreContentRangePublicationAbortReceiptV1(value),
        ),
    );
  }

  beginScopeAction(
    stageId: string,
    request: LibraryCoreAnyScopeActionRequestV1,
    createdAt: number,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteBeginScopeActionWorkerRequest(
          requestId,
          stageId,
          request,
          createdAt,
        ),
      parseLibraryCoreScopeActionStageStatusV1,
    );
  }

  appendScopeAction(
    stageId: string,
    expectedOrdinal: number,
    entityIds: readonly string[],
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteAppendScopeActionWorkerRequest(
          requestId,
          stageId,
          expectedOrdinal,
          entityIds,
        ),
      parseLibraryCoreScopeActionStageStatusV1,
    );
  }

  finalizeScopeAction(
    stageId: string,
    expectedMemberCount: number,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFinalizeScopeActionWorkerRequest(
          requestId,
          stageId,
          expectedMemberCount,
        ),
      parseLibraryCoreScopeActionStageStatusV1,
    );
  }

  pageScopeAction(
    stageId: string,
    afterOrdinal: number,
  ): Promise<LibraryCoreScopeActionStagePageV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqlitePageScopeActionWorkerRequest(
          requestId,
          stageId,
          afterOrdinal,
        ),
      parseLibraryCoreScopeActionStagePageV1,
    );
  }

  closeScopeAction(
    stageId: string,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteCloseScopeActionWorkerRequest(
          requestId,
          stageId,
        ),
      parseLibraryCoreScopeActionStageStatusV1,
    );
  }

  commitFollowerIntent(
    commit: LibraryCoreFollowerIntentCommitV1,
  ): Promise<LibraryCoreFollowerIntentCommitResultV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerIntentCommitWorkerRequest(
          requestId,
          commit,
        ),
      parseLibraryCoreFollowerIntentCommitResultV1,
    );
  }

  followerMutationContext(): Promise<LibraryCoreFollowerMutationContextV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerMutationContextWorkerRequest(requestId),
      parseLibraryCoreSqliteFollowerMutationContextResponse,
    );
  }

  followerTransportContext(): Promise<LibraryCoreFollowerTransportContextV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerTransportContextWorkerRequest(requestId),
      parseLibraryCoreFollowerTransportContextV2,
    );
  }

  pageFollowerTransport(
    page: LibraryCoreFollowerTransportPageRequestV2,
  ): Promise<LibraryCoreFollowerTransportPageResponseV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerTransportPageWorkerRequest(
          requestId,
          page,
        ),
      parseLibraryCoreFollowerTransportPageResponseV2,
    );
  }

  pageFollowerIntents(
    page: LibraryCoreFollowerIntentPageRequestV1,
  ): Promise<LibraryCoreFollowerIntentPageResponseV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerIntentPageWorkerRequest(requestId, page),
      parseLibraryCoreFollowerIntentPageResponseV1,
    );
  }

  publishFollowerIntent(
    publication: LibraryCoreFollowerIntentPublicationV1,
  ): Promise<LibraryCoreFollowerIntentPublicationReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest(
          requestId,
          publication,
        ),
      parseLibraryCoreFollowerIntentPublicationReceiptV1,
    );
  }

  applyFollowerResult(
    apply: LibraryCoreFollowerResultApplyV1,
  ): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerResultApplyWorkerRequest(
          requestId,
          apply,
        ),
      parseLibraryCoreFollowerResultApplyReceiptV1,
    );
  }

  publishNormalizedFollowerIntentTransport(
    publication: LibraryCoreNormalizedIntentTransportPublicationV2,
  ): Promise<LibraryCoreNormalizedIntentTransportPublicationReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest(
          requestId,
          publication,
        ),
      parseLibraryCoreNormalizedIntentTransportPublicationReceiptV2,
    );
  }

  importNormalizedFollowerResultTransport(
    imported: LibraryCoreNormalizedResultTransportImportV2,
  ): Promise<LibraryCoreNormalizedResultTransportImportReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest(
          requestId,
          imported,
        ),
      parseLibraryCoreNormalizedResultTransportImportReceiptV2,
    );
  }

  importNormalizedOperationPage(
    imported: LibraryCoreNormalizedOperationImportPageV2,
  ): Promise<LibraryCoreNormalizedOperationImportReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteNormalizedOperationImportWorkerRequest(
          requestId,
          imported,
        ),
      parseLibraryCoreNormalizedOperationImportReceiptV2,
    );
  }

  followerActorEnrollmentContext(): Promise<LibraryCoreFollowerActorEnrollmentContextV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest(
          requestId,
        ),
      parseLibraryCoreFollowerActorEnrollmentContextV2,
    );
  }

  storeFollowerActorRequest(
    store: LibraryCoreStoreFollowerActorRequestV2,
  ): Promise<LibraryCoreFollowerActorRequestReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest(
          requestId,
          store,
        ),
      parseLibraryCoreFollowerActorRequestReceiptV2,
    );
  }

  installFollowerActorEnrollment(
    install: LibraryCoreInstallFollowerActorEnrollmentV2,
  ): Promise<LibraryCoreFollowerActorEnrollmentReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest(
          requestId,
          install,
        ),
      parseLibraryCoreFollowerActorEnrollmentReceiptV2,
    );
  }

  beginNormalizedCheckpointStage(
    stage: LibraryCoreBeginNormalizedCheckpointStageV2,
  ): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteBeginCheckpointWorkerRequest(requestId, stage),
      parseLibraryCoreNormalizedCheckpointStageStatusV2,
    );
  }

  appendNormalizedCheckpointStagePage(
    page: LibraryCoreNormalizedCheckpointStagePageV2,
  ): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteAppendCheckpointPageWorkerRequest(
          requestId,
          page,
        ),
      parseLibraryCoreNormalizedCheckpointStageStatusV2,
    );
  }

  activateNormalizedCheckpointStage(
    activation: LibraryCoreActivateNormalizedCheckpointStageV2,
  ): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteActivateCheckpointWorkerRequest(
          requestId,
          activation,
        ),
      parseLibraryCoreNormalizedCheckpointActivationReceiptV2,
    );
  }

  readNormalizedCheckpointReceipt(): Promise<LibraryCoreNormalizedCheckpointSelectionV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest(requestId),
      parseLibraryCoreSqliteCheckpointSelectionResponse,
    );
  }

  describeNormalizedCheckpointExport(): Promise<LibraryCoreNormalizedCheckpointExportDescriptorV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteDescribeCheckpointExportWorkerRequest(requestId),
      parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
    );
  }

  readNormalizedCheckpointExportPage(
    request: LibraryCorePinnedNormalizedCheckpointExportRequestV2,
  ): Promise<LibraryCoreNormalizedCheckpointExportPageV2> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteReadCheckpointExportPageWorkerRequest(
          requestId,
          request,
        ),
      parseLibraryCoreNormalizedCheckpointExportPageV2,
    );
  }

  async close(): Promise<LibraryCoreSqliteWorkerStatus> {
    const status = await this.#request("close");
    this.#closed = true;
    this.#worker.terminate();
    return status;
  }

  dispose(error = new Error("PWA Library SQLite client was disposed")): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failAll(error);
    this.#worker.terminate();
  }

  #request(
    kind: LibraryCoreSqliteWorkerRequest["kind"],
  ): Promise<LibraryCoreSqliteWorkerStatus> {
    return this.#send(
      (requestId) =>
        createLibraryCoreSqliteWorkerRequest(
          kind as "close" | "open" | "status",
          requestId,
        ),
      parseLibraryCoreSqliteWorkerStatus,
      "status",
    );
  }

  #send<T>(
    createRequest: (requestId: string) => LibraryCoreSqliteWorkerRequest,
    parse: (value: unknown) => T,
    field: "result" | "status" = "result",
  ): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new Error("PWA Library SQLite client is closed"));
    }
    if (
      this.#pending.size >= LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS
    ) {
      return Promise.reject(
        new Error("PWA Library SQLite request queue is full"),
      );
    }
    const requestId = crypto.randomUUID();
    const request = createRequest(requestId);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("PWA Library SQLite request timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, {
        field,
        parse,
        reject,
        resolve: resolve as PendingRequest["resolve"],
        timeout,
      });
      this.#worker.postMessage(request);
    });
  }

  #receive(value: unknown): void {
    const response = closedResponseRecord(value);
    if (
      response === null ||
      typeof response.requestId !== "string" ||
      response.requestId.length < 1 ||
      response.requestId.length > 255
    ) {
      return;
    }
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    try {
      if (response.ok === true) {
        if (!exactResponseKeys(response, ["ok", pending.field, "requestId"])) {
          throw new TypeError(
            "PWA Library SQLite worker success response is not closed",
          );
        }
        pending.resolve(pending.parse(response[pending.field]));
        return;
      }
      if (
        response.ok !== false ||
        !exactResponseKeys(response, ["code", "message", "ok", "requestId"]) ||
        (response.code !== "invalid_request" &&
          response.code !== "library_busy" &&
          response.code !== "sqlite_initialization_failed" &&
          response.code !== "sqlite_integrity_failed") ||
        typeof response.message !== "string" ||
        textEncoder.encode(response.message).byteLength < 1 ||
        textEncoder.encode(response.message).byteLength >
          WORKER_ERROR_MAXIMUM_UTF8_BYTES
      ) {
        throw new TypeError(
          "PWA Library SQLite worker failure response is not closed",
        );
      }
      pending.reject(new Error(response.message));
    } catch (error) {
      pending.reject(
        error instanceof Error
          ? error
          : new TypeError("PWA Library SQLite worker response is invalid"),
      );
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
