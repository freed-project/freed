import { Channel, invoke } from "@tauri-apps/api/core";
import {
  createLibraryCoreOperationInstanceId,
  createLibraryCoreSqliteQueryWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
  parseLibraryCoreNormalizedReplicaAuditV1,
  type LibraryCoreNormalizedReplicaAuditV1,
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  parseLibraryCoreDeviceContactMutationReceiptV1,
  parseLibraryCoreDeviceContactQueryRequestV1,
  parseLibraryCoreDeviceContactQueryResponseV1,
  parseLibraryCoreDeviceContactSyncMutationV1,
  parseLibraryCoreContentPolicyMutationReceiptV1,
  parseLibraryCoreContentPolicyMutationV1,
  type LibraryCoreContentPolicyMutationReceiptV1,
  type LibraryCoreContentPolicyMutationV1,
  type LibraryCoreDeviceContactMutationExecutor,
  type LibraryCoreDeviceContactQueryExecutor,
  type LibraryCoreDeviceGraphLayoutMutationExecutor,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";

export function createDesktopLibraryCoreOperationId(
  prefix: string,
): LibraryCoreOperationInstanceId {
  return createLibraryCoreOperationInstanceId(prefix, crypto.randomUUID());
}

/** Run one closed, bounded Library Core query against Freed Desktop SQLite. */
export async function queryNormalizedLibrary<
  T extends LibraryCoreSqliteQueryRequest,
>(request: T, signal?: AbortSignal): Promise<LibraryCoreSqliteQueryResponseFor<T>> {
  const validated = createLibraryCoreSqliteQueryWorkerRequest(
    "desktop-query-validation",
    request,
  );
  if (validated.kind !== "query") {
    throw new TypeError("normalized Library query validation failed");
  }
  return invokeControlledLibraryRead("query_normalized_library", { request: validated.query },
    (response) => parseLibraryCoreSqliteQueryResponse(response, validated.query as T), signal);
}

/** Explicit local audit; it neither publishes records nor grants authority. */
export function auditNormalizedLibraryReplica(
  signal?: AbortSignal,
): Promise<LibraryCoreNormalizedReplicaAuditV1> {
  return invokeControlledLibraryRead("audit_normalized_library_replica", {},
    parseLibraryCoreNormalizedReplicaAuditV1, signal);
}

async function invokeControlledLibraryRead<T>(
  command: "query_normalized_library" | "audit_normalized_library_replica",
  args: Record<string, unknown>,
  parse: (response: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  let ticket: string | null = null;
  let settled = false;
  let cancellationSent = false;
  const cancel = () => {
    if (settled || cancellationSent || !ticket || !signal?.aborted) return;
    cancellationSent = true;
    // The native deadline remains effective if this best-effort IPC fails.
    void invoke("cancel_normalized_library_query", { ticket }).catch(() => {});
  };
  const started = signal ? new Channel<string>((registeredTicket) => {
    ticket = registeredTicket;
    cancel();
  }) : undefined;
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await invoke<unknown>(command, {
      ...args,
      ...(started ? { started } : {}),
    });
    signal?.throwIfAborted();
    return parse(response);
  } finally {
    settled = true;
    signal?.removeEventListener("abort", cancel);
    if (started) started.onmessage = () => {};
  }
}

export const mutateNormalizedDeviceGraphLayout: LibraryCoreDeviceGraphLayoutMutationExecutor =
  async (mutation) => {
    const parsedMutation = parseLibraryCoreDeviceGraphLayoutMutationV1(mutation);
    if (!parsedMutation.ok) throw new TypeError(parsedMutation.error);
    const response = await invoke<unknown>(
      "mutate_normalized_device_graph_layout",
      { mutation: parsedMutation.value },
    );
    const parsedResponse = parseLibraryCoreDeviceGraphLayoutMutationResultV1(
      response,
    );
    if (!parsedResponse.ok) throw new TypeError(parsedResponse.error);
    return parsedResponse.value;
  };

export async function mutateNormalizedContentPolicy(
  mutation: LibraryCoreContentPolicyMutationV1,
): Promise<LibraryCoreContentPolicyMutationReceiptV1> {
  const parsedMutation = parseLibraryCoreContentPolicyMutationV1(mutation);
  if (!parsedMutation.ok) throw new TypeError(parsedMutation.error);
  const response = await invoke<unknown>("mutate_normalized_content_policy", {
    mutation: parsedMutation.value,
  });
  const parsedResponse = parseLibraryCoreContentPolicyMutationReceiptV1(response);
  if (!parsedResponse.ok) throw new TypeError(parsedResponse.error);
  return parsedResponse.value;
}

export const mutateNormalizedDeviceContacts: LibraryCoreDeviceContactMutationExecutor =
  async (mutation) => {
    const parsedMutation = parseLibraryCoreDeviceContactSyncMutationV1(mutation);
    if (!parsedMutation.ok) throw new TypeError(parsedMutation.error);
    const response = await invoke<unknown>("mutate_normalized_device_contacts", {
      mutation: parsedMutation.value,
    });
    const parsedResponse = parseLibraryCoreDeviceContactMutationReceiptV1(response);
    if (!parsedResponse.ok) throw new TypeError(parsedResponse.error);
    return parsedResponse.value;
  };

export const queryNormalizedDeviceContacts: LibraryCoreDeviceContactQueryExecutor =
  async (query) => {
    const parsedQuery = parseLibraryCoreDeviceContactQueryRequestV1(query);
    if (!parsedQuery.ok) throw new TypeError(parsedQuery.error);
    const command =
      parsedQuery.value.queryId === "device_contact_status_v1"
        ? "query_normalized_device_contact_status"
        : parsedQuery.value.queryId === "device_contact_match_page_v1"
          ? "query_normalized_device_contact_match_page"
          : parsedQuery.value.queryId === "device_contact_suggestion_page_v1"
            ? "query_normalized_device_contact_suggestion_page"
            : "query_normalized_device_contact_unmatched_page";
    const response = await invoke<unknown>(command, {
      request: parsedQuery.value,
    });
    const parsedResponse = parseLibraryCoreDeviceContactQueryResponseV1(
      response,
      parsedQuery.value,
    );
    if (!parsedResponse.ok) throw new TypeError(parsedResponse.error);
    return parsedResponse.value as never;
  };
