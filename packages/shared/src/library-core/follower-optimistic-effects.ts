import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";
import type { LibraryCoreOperationEnvelopeV1 } from "./operation-envelope-finalization.js";
import { LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS } from "./sqlite-contract.generated.js";

export type LibraryCoreOptimisticFieldValueTypeV1 =
  "boolean" | "integer" | "null";

export interface LibraryCoreOptimisticFieldV1 {
  readonly createdAt: number;
  readonly entityId: string;
  readonly entityType: string;
  readonly fieldPath: string;
  readonly value: boolean | number | null;
  readonly valueType: LibraryCoreOptimisticFieldValueTypeV1;
}

function field(
  envelope: LibraryCoreOperationEnvelopeV1,
  fieldPath: string,
  valueType: LibraryCoreOptimisticFieldValueTypeV1,
  value: boolean | number | null,
): LibraryCoreOptimisticFieldV1 {
  return Object.freeze({
    createdAt: envelope.created_at_ms,
    entityId: envelope.entity_id,
    entityType: envelope.entity_type,
    fieldPath,
    value,
    valueType,
  });
}

/**
 * Derive the sparse device-local projection for one verified follower member.
 *
 * The executable mutation registry selects the transform. Canonical rows and
 * revisions remain untouched until the Primary accepts the intent.
 */
export function libraryCoreOptimisticFieldsForEnvelopeV1(
  envelope: LibraryCoreOperationEnvelopeV1,
): readonly LibraryCoreOptimisticFieldV1[] {
  const program =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS[envelope.operation_type];
  const payload = envelope.payload as Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
  switch (program.optimisticEffectKind) {
    case "read_assignment":
      return Object.freeze([
        field(envelope, "read_at", "integer", payload.read_at_ms as number),
      ]);
    case "saved_assignment":
      return payload.assigned === true
        ? Object.freeze([
            field(envelope, "saved", "boolean", true),
            field(
              envelope,
              "saved_at",
              "integer",
              payload.assigned_at_ms as number,
            ),
            field(envelope, "archived", "boolean", false),
            field(envelope, "archived_at", "null", null),
          ])
        : Object.freeze([
            field(envelope, "saved", "boolean", false),
            field(envelope, "saved_at", "null", null),
          ]);
    case "archive_assignment":
      return payload.assigned === true
        ? Object.freeze([
            field(envelope, "archived", "boolean", true),
            field(
              envelope,
              "archived_at",
              "integer",
              payload.assigned_at_ms as number,
            ),
            field(envelope, "saved", "boolean", false),
            field(envelope, "saved_at", "null", null),
          ])
        : Object.freeze([
            field(envelope, "archived", "boolean", false),
            field(envelope, "archived_at", "null", null),
          ]);
    case "like_assignment":
      return Object.freeze([
        field(envelope, "liked", "boolean", payload.assigned as boolean),
        field(
          envelope,
          "liked_at",
          payload.assigned === true ? "integer" : "null",
          payload.assigned === true ? (payload.assigned_at_ms as number) : null,
        ),
      ]);
    case "none":
      return Object.freeze([]);
  }
}
