import { type Account } from "@freed/shared";
import { ACCOUNT_UPSERT_PAYLOAD_SCHEMA, LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import type { RecoveryAccountDraft } from "@freed/ui/components/RecoveryAccountFields";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** At most the registered member count of complete 64 KiB roots; no catalog read. */
export async function loadRecoveryAccountDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryAccountDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers) throw new Error("Account recovery exceeds its member bound");

  const drafts: RecoveryAccountDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const payload = ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "account_upsert" || envelope.entity_type !== "Account" || !payload.ok ||
      payload.value.account.id !== row.entityId ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryNormalizedLibrary({ queryId: "account_root_v1", schemaVersion: 1, accountId: row.entityId }, signal);
    if (signal.aborted) throw new Error("QUERY_CANCELLED");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision ||
      response.account && response.account.id !== row.entityId) throw new Error("CURSOR_STALE");
    const archived = payload.value.account as unknown as Account;
    const current = response.account ? response.account as unknown as Account : null;
    const account = { ...(current ?? archived) };
    // Recreating an absent record must not silently restore remote image loading.
    if (!current) delete account.avatarUrl;
    drafts.push({ archived, current, account });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
