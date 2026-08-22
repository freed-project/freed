import type {
  LibraryCoreNormalizedQueryExecutor,
  LibraryCoreSqliteQueryRequest,
  LibraryCoreSqliteQueryResponseFor,
  LibraryCoreScopeActionRequestV1,
  LibraryCoreScopeActionStagePageV1,
  LibraryCoreFollowerIntentCommitResultV1,
  LibraryCoreFollowerIntentCommitV1,
  LibraryCoreFollowerMutationContextV1,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteClient } from "./library-core-sqlite-client";
import { deletePwaLibraryCoreSqliteStorage } from "./library-core-sqlite-storage";

let client: PwaLibraryCoreSqliteClient | null = null;
let openTask: Promise<void> | null = null;

async function openClient(): Promise<PwaLibraryCoreSqliteClient> {
  const active = client ?? new PwaLibraryCoreSqliteClient();
  client = active;
  openTask ??= active
    .open()
    .then(() => undefined)
    .catch((error) => {
      active.dispose(
        error instanceof Error
          ? error
          : new Error("PWA Library SQLite failed to open"),
      );
      if (client === active) client = null;
      openTask = null;
      throw error;
    });
  await openTask;
  return active;
}

export const queryPwaNormalizedLibrary: LibraryCoreNormalizedQueryExecutor =
  async <T extends LibraryCoreSqliteQueryRequest>(
    request: T,
  ): Promise<LibraryCoreSqliteQueryResponseFor<T>> => {
    const active = await openClient();
    return active.query(request);
  };

export async function beginPwaScopeActionStage(
  stageId: string,
  request: LibraryCoreScopeActionRequestV1,
): Promise<void> {
  const active = await openClient();
  await active.beginScopeAction(stageId, request, Date.now());
}

export async function appendPwaScopeActionStage(
  stageId: string,
  expectedOrdinal: number,
  entityIds: readonly string[],
): Promise<void> {
  const active = await openClient();
  await active.appendScopeAction(stageId, expectedOrdinal, entityIds);
}

export async function finalizePwaScopeActionStage(
  stageId: string,
  expectedMemberCount: number,
): Promise<number> {
  const active = await openClient();
  return (await active.finalizeScopeAction(stageId, expectedMemberCount))
    .memberCount;
}

export async function pagePwaScopeActionStage(
  stageId: string,
  afterOrdinal: number,
): Promise<LibraryCoreScopeActionStagePageV1> {
  const active = await openClient();
  return active.pageScopeAction(stageId, afterOrdinal);
}

export async function closePwaScopeActionStage(stageId: string): Promise<void> {
  const active = await openClient();
  await active.closeScopeAction(stageId);
}

export async function readPwaFollowerMutationContext(): Promise<LibraryCoreFollowerMutationContextV1> {
  const active = await openClient();
  return active.followerMutationContext();
}

export async function commitPwaFollowerIntent(
  commit: LibraryCoreFollowerIntentCommitV1,
): Promise<LibraryCoreFollowerIntentCommitResultV1> {
  const active = await openClient();
  return active.commitFollowerIntent(commit);
}

export async function closePwaNormalizedLibrary(): Promise<void> {
  const active = client;
  client = null;
  openTask = null;
  if (!active) return;
  try {
    await active.close();
  } catch (error) {
    active.dispose(
      error instanceof Error
        ? error
        : new Error("PWA Library SQLite failed to close"),
    );
    throw error;
  }
}

export async function resetPwaNormalizedLibrary(): Promise<void> {
  await closePwaNormalizedLibrary();
  await deletePwaLibraryCoreSqliteStorage();
}
