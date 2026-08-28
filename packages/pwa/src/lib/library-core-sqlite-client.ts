import {
  LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest,
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
  createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest,
  createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest,
  createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest,
  createLibraryCoreSqliteWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
  parseLibraryCoreDeviceContactQueryResponseV1,
  parseLibraryCoreSqliteCheckpointSelectionResponse,
  parseLibraryCoreSqliteFollowerMutationContextResponse,
  parseLibraryCoreContentRangeReadResponseV1,
  parseLibraryCoreContentCompletionReceiptV1,
  parseLibraryCoreContentEvictionReceiptV1,
  parseLibraryCoreEvictionCandidatePageV1,
  parseLibraryCoreHydrationCandidatePageV1,
  type LibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerResponse,
  type LibraryCoreSqliteWorkerResult,
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
  type LibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreScopeActionStagePageV1,
  type LibraryCoreScopeActionStageStatusV1,
} from "@freed/shared/library-core";

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (
    value: LibraryCoreSqliteWorkerResult | LibraryCoreSqliteWorkerStatus,
  ) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class PwaLibraryCoreSqliteClient {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #worker: Worker;
  #closed = false;

  constructor() {
    const memoryE2eRequested = (
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
    return this.#send<LibraryCoreSqliteQueryResponseFor<T>>((requestId) =>
      createLibraryCoreSqliteQueryWorkerRequest(requestId, query),
    ).then((response) => parseLibraryCoreSqliteQueryResponse(response, query));
  }

  mutateDeviceGraphLayout(
    mutation: LibraryCoreDeviceGraphLayoutMutationV1,
  ): Promise<LibraryCoreDeviceGraphLayoutMutationResultV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest(
        requestId,
        mutation,
      ),
    );
  }

  mutateDeviceContactSync(
    mutation: LibraryCoreDeviceContactSyncMutationV1,
  ): Promise<LibraryCoreDeviceContactMutationReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteDeviceContactMutationWorkerRequest(
        requestId,
        mutation,
      ),
    );
  }

  queryDeviceContacts(
    query: LibraryCoreDeviceContactQueryRequestV1,
  ): Promise<LibraryCoreDeviceContactQueryResponseV1> {
    return this.#send<LibraryCoreDeviceContactQueryResponseV1>((requestId) =>
      createLibraryCoreSqliteDeviceContactQueryWorkerRequest(requestId, query),
    ).then((response) => {
      const parsed = parseLibraryCoreDeviceContactQueryResponseV1(
        response,
        query,
      );
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  mutateContentPolicy(
    mutation: LibraryCoreContentPolicyMutationV1,
  ): Promise<LibraryCoreContentPolicyMutationReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentPolicyMutationWorkerRequest(
        requestId,
        mutation,
      ),
    );
  }

  readContentState(
    request: LibraryCoreContentStateRequestV1,
  ): Promise<LibraryCoreContentStateV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentStateWorkerRequest(requestId, request),
    );
  }

  readContentRange(
    request: LibraryCoreContentRangeReadRequestV1,
  ): Promise<LibraryCoreContentRangeReadResponseV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentRangeReadWorkerRequest(requestId, request),
    ).then((value) => {
      const parsed = parseLibraryCoreContentRangeReadResponseV1(value);
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  verifyContentComplete(
    request: LibraryCoreContentCompletionRequestV1,
  ): Promise<LibraryCoreContentCompletionReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentCompletionWorkerRequest(requestId, request),
    ).then((value) => {
      const parsed = parseLibraryCoreContentCompletionReceiptV1(value);
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  evictContent(
    request: LibraryCoreContentEvictionRequestV1,
  ): Promise<LibraryCoreContentEvictionReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentEvictionWorkerRequest(requestId, request),
    ).then((value) => {
      const parsed = parseLibraryCoreContentEvictionReceiptV1(value);
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  pageHydrationCandidates(
    request: LibraryCoreHydrationCandidatePageRequestV1,
  ): Promise<LibraryCoreHydrationCandidatePageV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteHydrationCandidatePageWorkerRequest(
        requestId,
        request,
      ),
    ).then((value) => {
      const parsed = parseLibraryCoreHydrationCandidatePageV1(value);
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  pageEvictionCandidates(
    request: LibraryCoreEvictionCandidatePageRequestV1,
  ): Promise<LibraryCoreEvictionCandidatePageV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteEvictionCandidatePageWorkerRequest(
        requestId,
        request,
      ),
    ).then((value) => {
      const parsed = parseLibraryCoreEvictionCandidatePageV1(value);
      if (!parsed.ok) throw new TypeError(parsed.error);
      return parsed.value;
    });
  }

  beginContentRangePublication(
    publication: LibraryCoreContentRangePublicationBeginV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentRangePublicationBeginWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  appendContentRangePublication(
    publication: LibraryCoreContentRangePublicationAppendV1,
  ): Promise<LibraryCoreContentRangePublicationStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentRangePublicationAppendWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  finalizeContentRangePublication(
    publication: LibraryCoreContentRangePublicationFinalizeV1,
  ): Promise<LibraryCoreVerifiedContentRangeReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentRangePublicationFinalizeWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  abortContentRangePublication(
    publication: LibraryCoreContentRangePublicationAbortV1,
  ): Promise<LibraryCoreContentRangePublicationAbortReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteContentRangePublicationAbortWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  beginScopeAction(
    stageId: string,
    request: LibraryCoreAnyScopeActionRequestV1,
    createdAt: number,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteBeginScopeActionWorkerRequest(
        requestId,
        stageId,
        request,
        createdAt,
      ),
    );
  }

  appendScopeAction(
    stageId: string,
    expectedOrdinal: number,
    entityIds: readonly string[],
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteAppendScopeActionWorkerRequest(
        requestId,
        stageId,
        expectedOrdinal,
        entityIds,
      ),
    );
  }

  finalizeScopeAction(
    stageId: string,
    expectedMemberCount: number,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFinalizeScopeActionWorkerRequest(
        requestId,
        stageId,
        expectedMemberCount,
      ),
    );
  }

  pageScopeAction(
    stageId: string,
    afterOrdinal: number,
  ): Promise<LibraryCoreScopeActionStagePageV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqlitePageScopeActionWorkerRequest(
        requestId,
        stageId,
        afterOrdinal,
      ),
    );
  }

  closeScopeAction(
    stageId: string,
  ): Promise<LibraryCoreScopeActionStageStatusV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteCloseScopeActionWorkerRequest(requestId, stageId),
    );
  }

  commitFollowerIntent(
    commit: LibraryCoreFollowerIntentCommitV1,
  ): Promise<LibraryCoreFollowerIntentCommitResultV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerIntentCommitWorkerRequest(
        requestId,
        commit,
      ),
    );
  }

  followerMutationContext(): Promise<LibraryCoreFollowerMutationContextV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerMutationContextWorkerRequest(requestId),
    ).then(parseLibraryCoreSqliteFollowerMutationContextResponse);
  }

  followerTransportContext(): Promise<LibraryCoreFollowerTransportContextV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerTransportContextWorkerRequest(requestId),
    );
  }

  pageFollowerTransport(
    page: LibraryCoreFollowerTransportPageRequestV2,
  ): Promise<LibraryCoreFollowerTransportPageResponseV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerTransportPageWorkerRequest(
        requestId,
        page,
      ),
    );
  }

  pageFollowerIntents(
    page: LibraryCoreFollowerIntentPageRequestV1,
  ): Promise<LibraryCoreFollowerIntentPageResponseV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerIntentPageWorkerRequest(requestId, page),
    );
  }

  publishFollowerIntent(
    publication: LibraryCoreFollowerIntentPublicationV1,
  ): Promise<LibraryCoreFollowerIntentPublicationReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  applyFollowerResult(
    apply: LibraryCoreFollowerResultApplyV1,
  ): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerResultApplyWorkerRequest(requestId, apply),
    );
  }

  publishNormalizedFollowerIntentTransport(
    publication: LibraryCoreNormalizedIntentTransportPublicationV2,
  ): Promise<LibraryCoreNormalizedIntentTransportPublicationReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest(
        requestId,
        publication,
      ),
    );
  }

  importNormalizedFollowerResultTransport(
    imported: LibraryCoreNormalizedResultTransportImportV2,
  ): Promise<LibraryCoreNormalizedResultTransportImportReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest(
        requestId,
        imported,
      ),
    );
  }

  followerActorEnrollmentContext(): Promise<LibraryCoreFollowerActorEnrollmentContextV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest(
        requestId,
      ),
    );
  }

  storeFollowerActorRequest(
    store: LibraryCoreStoreFollowerActorRequestV2,
  ): Promise<LibraryCoreFollowerActorRequestReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest(
        requestId,
        store,
      ),
    );
  }

  installFollowerActorEnrollment(
    install: LibraryCoreInstallFollowerActorEnrollmentV2,
  ): Promise<LibraryCoreFollowerActorEnrollmentReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest(
        requestId,
        install,
      ),
    );
  }

  beginNormalizedCheckpointStage(
    stage: LibraryCoreBeginNormalizedCheckpointStageV2,
  ): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteBeginCheckpointWorkerRequest(requestId, stage),
    );
  }

  appendNormalizedCheckpointStagePage(
    page: LibraryCoreNormalizedCheckpointStagePageV2,
  ): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteAppendCheckpointPageWorkerRequest(requestId, page),
    );
  }

  activateNormalizedCheckpointStage(
    activation: LibraryCoreActivateNormalizedCheckpointStageV2,
  ): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteActivateCheckpointWorkerRequest(
        requestId,
        activation,
      ),
    );
  }

  readNormalizedCheckpointReceipt(): Promise<LibraryCoreNormalizedCheckpointSelectionV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest(requestId),
    ).then(parseLibraryCoreSqliteCheckpointSelectionResponse);
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
    return this.#send((requestId) =>
      createLibraryCoreSqliteWorkerRequest(
        kind as "close" | "open" | "status",
        requestId,
      ),
    );
  }

  #send<
    T extends LibraryCoreSqliteWorkerStatus | LibraryCoreSqliteWorkerResult,
  >(
    createRequest: (requestId: string) => LibraryCoreSqliteWorkerRequest,
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
        reject,
        resolve: resolve as PendingRequest["resolve"],
        timeout,
      });
      this.#worker.postMessage(request);
    });
  }

  #receive(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    const response = value as Partial<LibraryCoreSqliteWorkerResponse>;
    if (typeof response.requestId !== "string") return;
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (response.ok === true && "status" in response && response.status) {
      pending.resolve(response.status);
      return;
    }
    if (response.ok === true && "result" in response && response.result) {
      pending.resolve(response.result);
      return;
    }
    pending.reject(
      new Error(
        response.ok === false && typeof response.message === "string"
          ? response.message
          : "PWA Library SQLite worker returned an invalid response",
      ),
    );
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
