import { mergeDefaultPreferences, type UserPreferences } from "../types.js";
import { decodeLibraryCoreFractionalNumbersV1, isLibraryCoreBinary64V1 } from "./fractional-number-codec.js";
import { PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import { parseLibraryCorePreferenceValueResponseV1 } from "./preference-value-contracts.js";
import { libraryCorePreferenceNodesToValueV1 } from "./preferences-snapshot-contracts.js";
import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

export interface RecoveryPreferenceField {
  /** Segments stay separate: a topic named "a.b" is not a nested setting. */
  readonly path: readonly string[];
  readonly kind: "assignment" | "empty_object";
  readonly archived: unknown;
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

export type RecoveryPreferenceCurrent =
  | { readonly kind: "absent" }
  | { readonly kind: "object_group"; readonly origin: "stored" | "default" }
  | { readonly kind: "value"; readonly origin: "stored" | "default"; readonly value: unknown };

/** Preserve original assignments without loading unrelated current preferences. */
export function createLibraryCoreRecoveryPreferenceDraftV1(
  row: LibraryCoreRecoveryIntentReviewResponseV1["rows"][number],
  envelope: Readonly<Record<string, unknown>>,
  checkCancellation: () => void = () => {},
): RecoveryPreferenceDraft {
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
      fields.push({ path, kind: object ? "empty_object" : "assignment",
        archived: decodeLibraryCoreFractionalNumbersV1(value) });
    };
    for (const [key, value] of Object.entries(payload.value.updates)) visit(value, [key]);
    return { updates: payload.value.updates, fields };
}

/** Retain only the selected comparison, pinned to the archived edit review's source. */
export async function readLibraryCoreRecoveryPreferenceCurrentV1(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  path: readonly string[],
  query: LibraryCoreNormalizedReaderRuntime["query"],
  checkCancellation: () => void,
): Promise<RecoveryPreferenceCurrent> {
  checkCancellation();
  const request = { queryId: "preference_value_v1" as const, schemaVersion: 1 as const, path,
    generationId: review.source.generationId, sourceRevision: review.source.projectionRevision };
  const response = await query(request);
  checkCancellation();
  const parsed = parseLibraryCorePreferenceValueResponseV1(response, request);
  if (!parsed.ok) throw new Error(parsed.error);
  if (parsed.value.kind === "object_group") return { kind: "object_group", origin: "stored" };
  if (parsed.value.kind === "value") return { kind: "value", origin: "stored",
    value: decodeLibraryCoreFractionalNumbersV1(libraryCorePreferenceNodesToValueV1(parsed.value.rows)._) };
  const current = ownPath(mergeDefaultPreferences({} as Partial<UserPreferences>), path);
  if (!current) return { kind: "absent" };
  return current.value !== null && typeof current.value === "object" && !Array.isArray(current.value)
    ? { kind: "object_group", origin: "default" }
    : { kind: "value", origin: "default", value: current.value };
}
