import { mergeDefaultPreferences, type UserPreferences } from "../types.js";
import { decodeLibraryCoreFractionalNumbersV1, isLibraryCoreBinary64V1 } from "./fractional-number-codec.js";
import { PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import { libraryCorePreferenceNodesToValueV1 } from "./preferences-snapshot-contracts.js";
import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

export interface RecoveryPreferenceField {
  /** Segments stay separate: a topic named "a.b" is not a nested setting. */
  readonly path: readonly string[];
  readonly kind: "assignment" | "empty_object";
  readonly archived: unknown;
  readonly current: { readonly origin: "stored" | "default"; readonly value: unknown } | null;
}
export interface RecoveryPreferenceDraft {
  /** Retain empty groups and original numeric encodings, not just visible leaves. */
  readonly updates: Readonly<Record<string, LibraryCoreCanonicalValue>>;
  readonly fields: readonly RecoveryPreferenceField[];
}

function ownPath(root: unknown, path: readonly string[]): { value: unknown } | null {
  let value = root;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.hasOwn(value, key)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined ? null : { value };
}

/** Read one bounded snapshot for the entire verified transaction, including repeated paths. */
export async function readLibraryCoreRecoveryPreferenceContextV1(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  query: LibraryCoreNormalizedReaderRuntime["query"],
  checkCancellation: () => void,
): Promise<(row: LibraryCoreRecoveryIntentReviewResponseV1["rows"][number], envelope: Readonly<Record<string, unknown>>) => RecoveryPreferenceDraft> {
  checkCancellation();
  const snapshot = await query({ queryId: "preferences_snapshot_v1", schemaVersion: 1 });
  checkCancellation();
  // Snapshot transitionSequence is the canonical revision. Archive review also
  // tracks installation-local changes, so compare their shared source fields.
  if (snapshot.source.generationId !== review.source.generationId || snapshot.source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  const stored = decodeLibraryCoreFractionalNumbersV1(libraryCorePreferenceNodesToValueV1(snapshot.rows));
  const effective = mergeDefaultPreferences(stored as Partial<UserPreferences>);
  return (row, envelope) => {
    checkCancellation();
    const payload = PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "preferences_leaf_assignment" || row.entityId !== "preferences" || envelope.entity_type !== "UserPreferences" || !payload.ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("The complete preference edit cannot be represented. Its archive is preserved.");
    const fields: RecoveryPreferenceField[] = [];
    const visit = (value: LibraryCoreCanonicalValue, path: readonly string[]) => {
      checkCancellation();
      const object = value !== null && typeof value === "object" && !Array.isArray(value) && !isLibraryCoreBinary64V1(value);
      if (object && Object.keys(value).length > 0) {
        for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
        return;
      }
      const persisted = ownPath(stored, path), current = ownPath(effective, path);
      fields.push({ path, kind: object ? "empty_object" : "assignment",
        archived: decodeLibraryCoreFractionalNumbersV1(value),
        current: current ? { origin: persisted ? "stored" : "default", value: current.value } : null });
    };
    for (const [key, value] of Object.entries(payload.value.updates)) visit(value, [key]);
    return { updates: payload.value.updates, fields };
  };
}
