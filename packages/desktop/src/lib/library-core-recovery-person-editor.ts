import { type Person } from "@freed/shared";
import { encodeLibraryCoreCanonicalValue, PERSON_UPSERT_PAYLOAD_SCHEMA, LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, type LibraryCoreCanonicalValue, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import type { RecoveryPersonDraft } from "@freed/ui/components/RecoveryPersonFields";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

const rootKeys = new Set(["id", "name", "avatarUrl", "bio", "relationshipStatus", "careLevel", "reachOutIntervalDays", "tags", "notes", "sampleDataFingerprint", "createdAt", "updatedAt"]);

/** Keep whole verified roots within a fixed retained-byte budget; never read the Person catalog. */
export async function loadRecoveryPersonDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryPersonDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers) throw new Error("Person recovery exceeds its member bound");
  let retainedBytes = 0;
  const drafts: RecoveryPersonDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const payload = PERSON_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "person_upsert" || envelope.entity_type !== "Person" || !payload.ok ||
      payload.value.person.id !== row.entityId || Object.keys(payload.value.person).some(key => !rootKeys.has(key)) ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs a different editor. No members were removed.");
    if (row.personState === "deleted") throw new Error("A person in this edit was deleted. Recovery cannot recreate them.");
    if (row.personState !== "present" && row.personState !== "absent") throw new Error("Person recovery state is unavailable");
    const response = await queryNormalizedLibrary({ queryId: "person_root_v1", schemaVersion: 1, personId: row.entityId }, signal);
    if (signal.aborted) throw new Error("QUERY_CANCELLED");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision ||
      (response.person !== null) !== (row.personState === "present") || response.person && response.person.id !== row.entityId) throw new Error("CURSOR_STALE");
    const archived = payload.value.person as unknown as Person;
    const current = response.person ? response.person as unknown as Person : null;
    const person = { ...(current ?? archived) };
    // Recreating an absent record must not silently restore remote image loading.
    if (!current) delete person.avatarUrl;
    for (const value of [archived, current]) if (value) retainedBytes += encodeLibraryCoreCanonicalValue(value as unknown as LibraryCoreCanonicalValue).length;
    if (retainedBytes > 4194304) throw new Error("Person recovery exceeds its retained detail budget");
    drafts.push({ archived, current, person });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
