import { invoke } from "@tauri-apps/api/core";
import {
  createLibraryCoreSqliteQueryWorkerRequest,
  parseLibraryCoreSqliteQueryResponse,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";

export function createDesktopLibraryCoreOperationId(
  prefix: string,
): LibraryCoreOperationInstanceId {
  return `${prefix}:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
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
