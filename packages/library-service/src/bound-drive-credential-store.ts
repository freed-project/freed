import type { BoundLibraryServiceConfiguration } from "./config.js";
import {
  LibraryServiceFailure,
  type LibraryServiceAclProofPort,
} from "./contracts.js";
import { createLinuxDriveCredentialStore } from "./linux-drive-credential-store.js";

/** Select only explicitly configured, admission-bound OAuth custody. */
export function createBoundDriveCredentialStore(
  bound: BoundLibraryServiceConfiguration,
  aclProof: LibraryServiceAclProofPort,
) {
  if (bound.config.cloud?.credentialStore === undefined) return undefined;
  if (bound.driveCredentialStore === undefined)
    throw new LibraryServiceFailure("drive_credential_unavailable");
  return createLinuxDriveCredentialStore({
    ...bound.driveCredentialStore,
    aclProof,
  });
}
