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
