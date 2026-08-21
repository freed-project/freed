export const PWA_LIBRARY_CORE_SQLITE_DATABASE_FILENAME =
  "/freed-library-core-v1.sqlite3";
export const PWA_LIBRARY_CORE_SQLITE_OWNERSHIP_LOCK =
  "freed-library-core-sqlite-opfs-v1";
export const PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY =
  "/freed-library-core-sqlite-opfs-v1";

export async function deletePwaLibraryCoreSqliteStorage(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root
    .removeEntry(PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY.slice(1), {
      recursive: true,
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return;
      throw error;
    });
}
