import { invoke } from "@tauri-apps/api/core";
import {
  createLibraryCoreOperationInstanceId,
  createLibraryCoreSqliteQueryWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  parseLibraryCoreDeviceContactMutationReceiptV1,
  parseLibraryCoreDeviceContactQueryRequestV1,
  parseLibraryCoreDeviceContactQueryResponseV1,
  parseLibraryCoreDeviceContactSyncMutationV1,
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
>(request: T): Promise<LibraryCoreSqliteQueryResponseFor<T>> {
  const validated = createLibraryCoreSqliteQueryWorkerRequest(
    "desktop-query-validation",
    request,
  );
  if (validated.kind !== "query") {
    throw new TypeError("normalized Library query validation failed");
  }
  const response = await invoke<unknown>("query_normalized_library", {
    request: validated.query,
  });
  return parseLibraryCoreSqliteQueryResponse(response, validated.query as T);
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
