import type {
  LibraryCoreNormalizedQueryExecutor,
  LibraryCoreSqliteQueryRequest,
  LibraryCoreSqliteQueryResponseFor,
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
