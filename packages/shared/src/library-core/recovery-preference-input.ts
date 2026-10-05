import { encodeLibraryCoreCanonicalValue, type LibraryCoreCanonicalValue } from "./canonical-codec.js";
import { isLibraryCoreBinary64V1 } from "./fractional-number-codec.js";
import { PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import { LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS } from "./sqlite-contract.generated.js";

/** Snapshot the complete wire patches before any asynchronous signing or context read. */
export function snapshotLibraryCoreRecoveryPreferencePatchesV1(patches: readonly unknown[]): readonly Readonly<Record<string, LibraryCoreCanonicalValue>>[] {
  if (!patches.length || patches.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.preferences_leaf_assignment.maximumMembers) throw new Error("Recovery exceeds its member bound");
  let bytes = 0;
  const selected: Readonly<Record<string, LibraryCoreCanonicalValue>>[] = [];
  for (const updates of patches) {
    const payload = PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate({ updates });
    if (!payload.ok) throw new Error("A complete preference patch is invalid");
    bytes += encodeLibraryCoreCanonicalValue({ updates: payload.value.updates }).length;
    if (bytes > 4_194_304) throw new Error("Recovery exceeds its byte bound");
    selected.push(payload.value.updates);
  }
  return Object.freeze(selected);
}

/** Call only after bounded payload validation; arrays and encoded numbers are scalar assignments. */
export function sameLibraryCoreRecoveryPreferenceScopeV1(original: LibraryCoreCanonicalValue, replacement: LibraryCoreCanonicalValue): boolean {
  const oldObject = original !== null && typeof original === "object" && !Array.isArray(original) && !isLibraryCoreBinary64V1(original);
  const newObject = replacement !== null && typeof replacement === "object" && !Array.isArray(replacement) && !isLibraryCoreBinary64V1(replacement);
  if (oldObject !== newObject) return false;
  if (!oldObject || !newObject) return true;
  const old = original as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  const next = replacement as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  return Object.keys(old).length === Object.keys(next).length && Object.keys(old).every(key =>
    Object.hasOwn(next, key) && sameLibraryCoreRecoveryPreferenceScopeV1(old[key]!, next[key]!));
}
