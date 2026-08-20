import {
  LibraryServiceFailure,
  type LibraryServiceAclProofPort,
  type LibraryServiceDoctorReport,
  type LibraryServiceFileSystemPort,
  type LibraryServiceIdentityPort,
} from "./contracts.js";
import {
  assertLibraryServiceBindingsStable,
  bindLibraryServiceConfig,
} from "./config.js";
import { bindLibraryServiceStatusFile } from "./status.js";

const HEALTHY_CHECKS = Object.freeze([
  "config_private",
  "role_primary",
  "data_root_private",
  "state_root_private",
  "admission_private",
  "credential_descriptor_private",
  "credential_descriptor_secret_free",
  "extended_acl_absent",
  "path_boundaries_separated",
  "regular_files_single_link",
  "sidecar_path_safe",
  "sidecar_digest_pinned",
  "sidecar_descriptor_bound",
  "authority_inputs_descriptor_bound",
  "lifetime_watchdog_required",
  "status_file_precreated_private",
]);

export async function inspectLibraryServiceReadiness(
  configPath: string,
  fileSystem: LibraryServiceFileSystemPort,
  identity: LibraryServiceIdentityPort,
  aclProof: LibraryServiceAclProofPort,
): Promise<LibraryServiceDoctorReport> {
  let close: (() => Promise<void>) | null = null;
  try {
    const bound = await bindLibraryServiceConfig(
      configPath,
      fileSystem,
      identity,
      aclProof,
    );
    close = bound.close;
    const statusFile = await bindLibraryServiceStatusFile(
      bound.config,
      bound.bindings.stateRoot,
      fileSystem,
      identity,
      aclProof,
    );
    if (statusFile === null) {
      throw new LibraryServiceFailure("status_invalid");
    }
    close = async () => {
      await statusFile.close().catch(() => undefined);
      await bound.close();
    };
    await assertLibraryServiceBindingsStable(bound, fileSystem);
    return {
      schemaVersion: 1,
      service: "freed-library",
      ok: true,
      role: bound.config.role,
      code: "ready",
      checks: HEALTHY_CHECKS,
    };
  } catch (error) {
    const code =
      error instanceof LibraryServiceFailure
        ? error.code
        : "filesystem_failure";
    return {
      schemaVersion: 1,
      service: "freed-library",
      ok: false,
      role: null,
      code,
      checks: [],
    };
  } finally {
    await close?.();
  }
}
