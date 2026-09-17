import { invoke } from "@tauri-apps/api/core";

export type LibraryCoreDesktopRole = "primary" | "follower";
export interface DesktopLibraryInstallationStatus {
  readonly state: "unconfigured" | "creating_primary" | "joining" | "awaiting_enrollment" | "editable_consumer" | "standalone_primary" | "shared_primary" | "fenced";
  readonly role: LibraryCoreDesktopRole | null;
  readonly libraryId: string | null;
  readonly authorityEpochId: string | null;
  readonly actorId: string | null;
}
export type DesktopLibrarySetupChoice =
  | { readonly role: "primary" }
  | { readonly role: "follower"; readonly libraryId: string };

// Presentation cache only. Native SQLite and installation setup own authority.
// Missing or failed native state never defaults to Primary.
let installation: DesktopLibraryInstallationStatus | null = null;
let requestVersion = 0;
let pendingRoleRead: Promise<DesktopLibraryInstallationStatus> | null = null;
const LEGACY_ROLE_KEY = "freed.libraryCore.desktopRoleV1";
function legacyFollowerRequested(): boolean {
  try { return window.localStorage.getItem(LEGACY_ROLE_KEY) === "follower"; } catch { return false; }
}
function clearLegacyRole(): void {
  try { window.localStorage.removeItem(LEGACY_ROLE_KEY); } catch { /* Native revocation is durable. */ }
}

export class LibraryCoreFollowerTransportInactiveError extends Error {
  constructor() {
    super("This Freed Desktop is not an active Primary for cloud publication.");
    this.name = "LibraryCoreFollowerTransportInactiveError";
  }
}
export class LibraryCoreFollowerTransportRequiredError extends Error {
  constructor() {
    super("This Google Drive operation requires a consumer Library selection.");
    this.name = "LibraryCoreFollowerTransportRequiredError";
  }
}

const nativeStateRoles: Record<DesktopLibraryInstallationStatus["state"], LibraryCoreDesktopRole | null> = {
  unconfigured: null,
  creating_primary: "primary",
  joining: "follower",
  awaiting_enrollment: "follower",
  editable_consumer: "follower",
  standalone_primary: "primary",
  shared_primary: "primary",
  fenced: null,
};

function acceptNativeStatus(value: DesktopLibraryInstallationStatus): DesktopLibraryInstallationStatus {
  const digestOrNull = (id: unknown) => id === null || (typeof id === "string" && /^[a-f0-9]{64}$/.test(id));
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "actorId,authorityEpochId,libraryId,role,state"
    || !Object.hasOwn(nativeStateRoles, value.state)
    || value.role !== nativeStateRoles[value.state]
    || ![value.libraryId, value.authorityEpochId, value.actorId].every(digestOrNull)
    || (value.role === "follower" && value.libraryId === null)
    || (["awaiting_enrollment", "editable_consumer", "standalone_primary", "shared_primary"].includes(value.state)
      && (value.libraryId === null || value.authorityEpochId === null))
    || (["editable_consumer", "standalone_primary", "shared_primary"].includes(value.state) && value.actorId === null)) {
    throw new Error("Native Library installation state is invalid.");
  }
  installation = Object.freeze(value);
  return installation;
}

export function refreshLibraryCoreDesktopRole(): Promise<DesktopLibraryInstallationStatus> {
  if (pendingRoleRead) return pendingRoleRead;
  const version = ++requestVersion;
  const operation = (async () => {
    try {
      const status = await invoke<DesktopLibraryInstallationStatus>("normalized_desktop_installation_status", {
        legacyFollowerRequested: legacyFollowerRequested(),
      });
      if (version !== requestVersion) throw new Error("Native Library role check was superseded.");
      const accepted = acceptNativeStatus(status);
      clearLegacyRole();
      return accepted;
    } catch (error) {
      if (version === requestVersion) installation = null;
      throw error;
    }
  })().finally(() => { if (pendingRoleRead === operation) pendingRoleRead = null; });
  pendingRoleRead = operation;
  return operation;
}

export async function selectDesktopLibrarySetup(choice: DesktopLibrarySetupChoice): Promise<DesktopLibraryInstallationStatus> {
  const version = ++requestVersion;
  pendingRoleRead = null;
  installation = null;
  const status = await invoke<DesktopLibraryInstallationStatus>("select_normalized_desktop_library_setup", { choice });
  if (version !== requestVersion) throw new Error("Native Library setup was superseded.");
  const accepted = acceptNativeStatus(status);
  clearLegacyRole();
  return accepted;
}

export function readLibraryCoreDesktopRole(): LibraryCoreDesktopRole | null {
  return installation?.role ?? null;
}

export function requirePrimaryLibraryCoreDesktopRole(): void {
  if (installation?.role !== "primary" || !["standalone_primary", "shared_primary"].includes(installation.state)) {
    throw new LibraryCoreFollowerTransportInactiveError();
  }
}

export function requireFollowerLibraryCoreDesktopRole(): void {
  if (installation?.role !== "follower") {
    throw new LibraryCoreFollowerTransportRequiredError();
  }
}
