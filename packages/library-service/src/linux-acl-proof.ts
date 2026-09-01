import { LibraryServiceFailure } from "./contracts.js";

function permissionTriplet(bits: number): string {
  return `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${bits & 1 ? "x" : "-"}`;
}

export function assertLinuxAclOutputHasOnlyModeEntries(
  stdout: string,
  stderr: string,
  mode: number,
): void {
  if (
    typeof stdout !== "string" ||
    typeof stderr !== "string" ||
    stderr !== "" ||
    !Number.isSafeInteger(mode) ||
    mode < 0
  ) {
    throw new LibraryServiceFailure("acl_probe_malformed");
  }
  const expected = new Set([
    `user::${permissionTriplet((mode >> 6) & 7)}`,
    `group::${permissionTriplet((mode >> 3) & 7)}`,
    `other::${permissionTriplet(mode & 7)}`,
  ]);
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  const found = new Set<string>();
  for (const line of lines) {
    if (expected.has(line)) {
      if (found.has(line)) {
        throw new LibraryServiceFailure("acl_probe_malformed");
      }
      found.add(line);
      continue;
    }
    if (/^(?:user|group|other)::[rwx-]{3}$/.test(line)) {
      throw new LibraryServiceFailure("acl_probe_malformed");
    }
    if (/^(?:default:)?(?:user|group|mask|other):/.test(line)) {
      throw new LibraryServiceFailure("acl_present");
    }
    throw new LibraryServiceFailure("acl_probe_malformed");
  }
  if (found.size !== expected.size) {
    throw new LibraryServiceFailure("acl_probe_malformed");
  }
}
