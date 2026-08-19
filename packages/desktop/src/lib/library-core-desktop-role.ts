export type LibraryCoreDesktopRole = "primary" | "follower";

const STORAGE_KEY = "freed.libraryCore.desktopRoleV1";

export class LibraryCoreFollowerTransportInactiveError extends Error {
  constructor() {
    super(
      "This follower Freed Desktop cannot publish or replace the Primary cloud Library.",
    );
    this.name = "LibraryCoreFollowerTransportInactiveError";
  }
}

export class LibraryCoreFollowerTransportRequiredError extends Error {
  constructor() {
    super("This Google Drive operation is available only to a follower Freed Desktop.");
    this.name = "LibraryCoreFollowerTransportRequiredError";
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

export function requireFollowerLibraryCoreDesktopRole(): void {
  if (readLibraryCoreDesktopRole() !== "follower") {
    throw new LibraryCoreFollowerTransportRequiredError();
  }
}
