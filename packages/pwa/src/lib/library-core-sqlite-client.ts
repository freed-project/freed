import {
  LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS,
  createLibraryCoreSqliteActivateCheckpointWorkerRequest,
  createLibraryCoreSqliteAppendCheckpointPageWorkerRequest,
  createLibraryCoreSqliteBeginCheckpointWorkerRequest,
  createLibraryCoreSqliteQueryWorkerRequest,
  createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest,
  createLibraryCoreSqliteFollowerIntentCommitWorkerRequest,
  createLibraryCoreSqliteFollowerIntentPageWorkerRequest,
  createLibraryCoreSqliteFollowerResultApplyWorkerRequest,
  createLibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerRequest,
  type LibraryCoreSqliteWorkerResponse,
  type LibraryCoreSqliteWorkerResult,
  type LibraryCoreSqliteWorkerStatus,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
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
    this.#worker = new Worker(
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
    );
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

  pageFollowerIntents(
    page: LibraryCoreFollowerIntentPageRequestV1,
  ): Promise<LibraryCoreFollowerIntentPageResponseV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerIntentPageWorkerRequest(requestId, page),
    );
  }

  applyFollowerResult(
    apply: LibraryCoreFollowerResultApplyV1,
  ): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteFollowerResultApplyWorkerRequest(requestId, apply),
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
    stageId: string,
  ): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
    return this.#send((requestId) =>
      createLibraryCoreSqliteActivateCheckpointWorkerRequest(
        requestId,
        stageId,
      ),
    );
  }

  async close(): Promise<LibraryCoreSqliteWorkerStatus> {
    const status = await this.#request("close");
    this.#closed = true;
    this.#worker.terminate();
    return status;
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
