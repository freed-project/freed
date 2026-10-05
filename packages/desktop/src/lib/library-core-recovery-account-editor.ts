import { ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import type { RecoveryAccountLinkDraft } from "@freed/ui/components/RecoveryAccountLinkFields";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** Read fixed ordered targets without retaining complete account/person records. */
export async function loadRecoveryAccountLinkDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal):
Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryAccountLinkDraft[] }> {
  const drafts: RecoveryAccountLinkDraft[] = [];
  const check = (source: { generationId: string; projectionRevision: number }) => {
    if (source.generationId !== review.source.generationId || source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  };
  const person = async (id: string | null) => {
    if (id === null) return { id, label: "Unlinked", present: true };
    const response = await queryNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: id }, signal);
    check(response.source);
    return { id, label: response.person?.name.slice(0, 240) || "Person (absent)", present: response.person !== null };
  };
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const payload = ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "account_person_assignment" || envelope.entity_type !== "Account" || !payload.ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0) throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryNormalizedLibrary({ queryId: "account_detail_v1", schemaVersion: 1, accountId: row.entityId }, signal);
    check(response.source);
    const account = response.account;
    if (!account || account.id !== row.entityId) throw new Error("An account is no longer present. Its entire archived edit is preserved.");
    const current = await person(account.personId);
    const archived = await person(payload.value.person_id);
    drafts.push({ accountId: row.entityId, label: (account.displayName || account.handle || account.externalId).slice(0, 240), current, archived });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
