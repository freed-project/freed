import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const AUTOMATION_HOST_PROFILE_ROOT =
  "/Library/Application Support/Freed";
export const AUTOMATION_HOST_PROFILE_PATH = path.join(
  AUTOMATION_HOST_PROFILE_ROOT,
  "automation-host.json",
);
export const PRIMARY_AUTOMATION_HOST_ROLE = "primary-automation-host";
export const CANONICAL_AUTOMATION_REPOSITORY = "freed-project/freed";
export const MAX_AUTOMATION_HOST_RECORD_BYTES = 16 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === [...expected].sort().join("\n")
  );
}

function parseBoundedJson(
  filePath,
  maxBytes = MAX_AUTOMATION_HOST_RECORD_BYTES,
) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new Error("record is not a bounded physical regular file");
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function parseAutomationHostProfile(value) {
  if (!exactKeys(value, ["schemaVersion", "hostId", "repository"])) {
    throw new Error("automation host profile has an unsupported shape");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("automation host profile schemaVersion must be 1");
  }
  if (!UUID_PATTERN.test(value.hostId)) {
    throw new Error(
      "automation host profile hostId must be a lowercase UUIDv4",
    );
  }
  if (value.repository !== CANONICAL_AUTOMATION_REPOSITORY) {
    throw new Error(
      `automation host profile repository must be ${CANONICAL_AUTOMATION_REPOSITORY}`,
    );
  }
  return Object.freeze({ ...value });
}

export function parseAutomationHostAssignments(value) {
  if (!exactKeys(value, ["schemaVersion", "roles"])) {
    throw new Error("automation host assignments have an unsupported shape");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("automation host assignments schemaVersion must be 1");
  }
  if (!exactKeys(value.roles, [PRIMARY_AUTOMATION_HOST_ROLE])) {
    throw new Error(
      `automation host assignments must define only ${PRIMARY_AUTOMATION_HOST_ROLE}`,
    );
  }
  const hostId = value.roles[PRIMARY_AUTOMATION_HOST_ROLE];
  if (!UUID_PATTERN.test(hostId)) {
    throw new Error(
      `${PRIMARY_AUTOMATION_HOST_ROLE} must name a lowercase UUIDv4`,
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    roles: Object.freeze({ [PRIMARY_AUTOMATION_HOST_ROLE]: hostId }),
  });
}

function inspectRootOwnedProfile(
  profilePath,
  { profileRoot = AUTOMATION_HOST_PROFILE_ROOT, requiredUid = 0 } = {},
) {
  try {
    const root = path.resolve(profileRoot);
    if (
      !path.isAbsolute(profilePath) ||
      realpathSync(profilePath) !== profilePath ||
      !path.isAbsolute(root) ||
      realpathSync(root) !== root ||
      path.dirname(profilePath) !== root
    ) {
      return { ready: false, reason: "host profile path is not canonical" };
    }
    const fileStats = lstatSync(profilePath);
    const rootStats = lstatSync(root);
    if (
      !fileStats.isFile() ||
      fileStats.isSymbolicLink() ||
      fileStats.uid !== requiredUid ||
      (fileStats.mode & 0o7022) !== 0 ||
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      rootStats.uid !== requiredUid ||
      (rootStats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: "host profile is not root-owned and immutable",
      };
    }
    return { ready: true, reason: "" };
  } catch (error) {
    return {
      ready: false,
      reason: `host profile cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function inspectAutomationHostAssignment({
  assignmentPath,
  profilePath = AUTOMATION_HOST_PROFILE_PATH,
  profileRoot = AUTOMATION_HOST_PROFILE_ROOT,
  requiredUid = 0,
} = {}) {
  let assignments;
  try {
    assignments = parseAutomationHostAssignments(
      parseBoundedJson(assignmentPath),
    );
  } catch (error) {
    return {
      ready: false,
      reason: `host assignment cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      profilePath,
      assignmentPath,
      hostId: null,
      assignedHostId: null,
    };
  }
  const assignedHostId = assignments.roles[PRIMARY_AUTOMATION_HOST_ROLE];
  if (!existsSync(profilePath)) {
    return {
      ready: false,
      reason: `root-owned host profile is missing at ${profilePath}`,
      profilePath,
      assignmentPath,
      hostId: null,
      assignedHostId,
    };
  }
  const inspection = inspectRootOwnedProfile(profilePath, {
    profileRoot,
    requiredUid,
  });
  if (!inspection.ready) {
    return {
      ready: false,
      reason: inspection.reason,
      profilePath,
      assignmentPath,
      hostId: null,
      assignedHostId,
    };
  }
  let profile;
  try {
    profile = parseAutomationHostProfile(parseBoundedJson(profilePath));
  } catch (error) {
    return {
      ready: false,
      reason: `host profile cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      profilePath,
      assignmentPath,
      hostId: null,
      assignedHostId,
    };
  }
  if (profile.hostId !== assignedHostId) {
    return {
      ready: false,
      reason: `host ${profile.hostId} is not assigned ${PRIMARY_AUTOMATION_HOST_ROLE}`,
      profilePath,
      assignmentPath,
      hostId: profile.hostId,
      assignedHostId,
    };
  }
  return {
    ready: true,
    reason: "assigned primary automation host",
    role: PRIMARY_AUTOMATION_HOST_ROLE,
    profilePath,
    assignmentPath,
    hostId: profile.hostId,
    assignedHostId,
  };
}
