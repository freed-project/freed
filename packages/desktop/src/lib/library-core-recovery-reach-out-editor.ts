import { PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA, LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import type { RecoveryReachOutDraft, RecoveryReachOutHistory } from "@freed/ui/components/RecoveryReachOutFields";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

export async function readRecoveryReachOutHistory(review: LibraryCoreRecoveryIntentReviewResponseV1, personId: string, signal: AbortSignal): Promise<RecoveryReachOutHistory> {
  const response = await queryNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId }, signal);
  if (signal.aborted) throw new Error("QUERY_CANCELLED");
  if (!response.person || response.person.id !== personId || response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  return { name: response.person.name, events: response.person.reachOuts };
}

/** Retain only original event payloads, not a history window for every Person. */
export async function loadRecoveryReachOutDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryReachOutDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_reach_out_append.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const drafts: RecoveryReachOutDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const payload = PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "person_reach_out_append" || envelope.entity_type !== "Person" || !payload.ok || typeof envelope.operation_id !== "string" || !Array.isArray(envelope.blob_references) || envelope.blob_references.length)
      throw new Error("This transaction needs another editor. No members were removed.");
    // Read and discard each bounded current history, retaining only event drafts.
    const history = await readRecoveryReachOutHistory(review, row.entityId, signal);
    if (history.events.some(event => event.reachOutId === envelope.operation_id)) throw new Error("The original event is already present");
    drafts.push({ personId: row.entityId, originalOperationId: envelope.operation_id, archived: payload.value, event: payload.value });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
