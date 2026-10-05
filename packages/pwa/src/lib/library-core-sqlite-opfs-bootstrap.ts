import type { Database, Sqlite3Static, WasmPointer } from "@sqlite.org/sqlite-wasm";
import {
  PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY,
} from "./library-core-sqlite-storage";

type OpfsSahPoolInstallOptions = Readonly<{
  directory: string;
  forceReinitIfPreviouslyFailed: boolean;
  initialCapacity: number;
  name: string;
}>;

type OpfsSahPoolInstaller<Pool> = (
  options: OpfsSahPoolInstallOptions,
) => Promise<Pool>;

const OPFS_SAH_POOL_NAME = "freed-opfs-sahpool-v1";

function isRetryableOpfsSahPoolInstallFailure(error: unknown): boolean {
  return error instanceof DOMException && error.name === "UnknownError";
}

/**
 * WebKit can reject its first SyncAccessHandle acquisition in a fresh private
 * session with UnknownError, then admit the same OPFS pool immediately after.
 * SQLite caches that rejected initialization promise by VFS name, so a retry
 * must explicitly ask the supported installer to discard the failed promise.
 */
export async function installPwaLibraryCoreOpfsSahPool<Pool>(
  install: OpfsSahPoolInstaller<Pool>,
): Promise<Pool> {
  const options: OpfsSahPoolInstallOptions = {
    directory: PWA_LIBRARY_CORE_SQLITE_VFS_DIRECTORY,
    forceReinitIfPreviouslyFailed: true,
    initialCapacity: 6,
    name: OPFS_SAH_POOL_NAME,
  };

  try {
    return await install(options);
  } catch (error) {
    if (!isRetryableOpfsSahPoolInstallFailure(error)) throw error;
    return install(options);
  }
}

/**
 * The SAH pool owns every backing file exclusively. Its upstream 3.53 adapter
 * nevertheless reports a reserved writer unconditionally, which suppresses hot
 * journal recovery after worker loss. Correct that one file-method result before
 * the first database read. This is only valid for our single-connection SAH pool,
 * never the concurrent OPFS VFS. Keep SQLite's journal and integrity checks intact.
 */
export function configurePwaExclusiveOpfsRecovery(
  sqlite3: Sqlite3Static,
  database: Database,
): () => void {
  const { capi, wasm } = sqlite3;
  const databasePointer = database.pointer;
  if (!databasePointer) throw new Error("PWA Library SQLite recovery database is closed");
  const slot = wasm.allocPtr(1);
  try {
    const result = capi.sqlite3_file_control(
      databasePointer, "main", capi.SQLITE_FCNTL_FILE_POINTER, slot,
    );
    if (result !== capi.SQLITE_OK) {
      throw new Error("PWA Library SQLite recovery file handle is unavailable");
    }
    const file = new capi.sqlite3_file(wasm.peekPtr(slot));
    const methods = new capi.sqlite3_io_methods(file.$pMethods);
    file.dispose();
    const pointers = methods as typeof methods & { $xCheckReservedLock: WasmPointer };
    const original = pointers.$xCheckReservedLock;
    methods.installMethod("xCheckReservedLock", (_file: WasmPointer, output: WasmPointer) => {
      try {
        wasm.poke32(output, 0);
        return capi.SQLITE_OK;
      } catch {
        return capi.SQLITE_IOERR_CHECKRESERVEDLOCK;
      }
    });
    return () => {
      pointers.$xCheckReservedLock = original;
      methods.dispose();
    };
  } finally {
    wasm.dealloc(slot);
  }
}
