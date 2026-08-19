export type LibraryCoreDesktopRole = "primary" | "follower";

const STORAGE_KEY = "freed.libraryCore.desktopRoleV1";

export class LibraryCoreFollowerTransportInactiveError extends Error {
  constructor() {
    super(
      "Editable follower sync is not active in this candidate yet. This Freed Desktop did not publish or replace the cloud Library.",
    );
    this.name = "LibraryCoreFollowerTransportInactiveError";
  }
}

export function readLibraryCoreDesktopRole(): LibraryCoreDesktopRole {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "follower"
      ? "follower"
      : "primary";
  } catch {
    return "primary";
  }
}

export function writeLibraryCoreDesktopRole(
  role: LibraryCoreDesktopRole,
): void {
  window.localStorage.setItem(STORAGE_KEY, role);
}

/**
 * Refuse every authoritative cloud path before it can discover, create, or
 * update a Drive control object when this installation is a follower.
 */
export function requirePrimaryLibraryCoreDesktopRole(): void {
  if (readLibraryCoreDesktopRole() === "follower") {
    throw new LibraryCoreFollowerTransportInactiveError();
  }
}

