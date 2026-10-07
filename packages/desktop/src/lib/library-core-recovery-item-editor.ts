import { ACCOUNT_REMOVE_PAYLOAD_SCHEMA, FEED_ITEM_REMOVE_PAYLOAD_SCHEMA, PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

export interface RecoveryItemRemovalDraft {
  readonly entityId: string;
  readonly label: string;
  readonly present: boolean;
}

/** Retain every ordered target, including absent items, without expanding scope. */
export async function loadRecoveryItemRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
): Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryItemRemovalDraft[] }> {
  const drafts: RecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "feed_item_remove" || envelope.entity_type !== "FeedItem" ||
        typeof row.itemPresent !== "boolean" || !FEED_ITEM_REMOVE_PAYLOAD_SCHEMA.validate(envelope.payload).ok ||
        !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    drafts.push({ entityId: row.entityId, label: row.itemText?.slice(0, 240) || `Item ...${row.entityId.slice(-8)}`, present: row.itemPresent });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Person deletion retains its original targets and resolves current labels only. */
export async function loadRecoveryPersonRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
): Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryItemRemovalDraft[] }> {
  const drafts: RecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "person_remove_and_accounts" || envelope.entity_type !== "Person" ||
      !PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA.validate(envelope.payload).ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    const current = await queryNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: row.entityId }, signal);
    if (signal.aborted) throw new Error("QUERY_CANCELLED");
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    if (current.person && current.person.id !== row.entityId) throw new Error("Person identity changed");
    drafts.push({ entityId: row.entityId, label: current.person?.name.slice(0, 240) || "Person (absent)", present: current.person !== null });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Account deletion keeps absent and duplicate targets in their original order. */
export async function loadRecoveryAccountRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
): Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryItemRemovalDraft[] }> {
  const drafts: RecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "account_remove" || envelope.entity_type !== "Account" ||
      !ACCOUNT_REMOVE_PAYLOAD_SCHEMA.validate(envelope.payload).ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    const current = await queryNormalizedLibrary({ queryId: "account_detail_v1", schemaVersion: 1, accountId: row.entityId }, signal);
    if (signal.aborted) throw new Error("QUERY_CANCELLED");
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    if (current.account && current.account.id !== row.entityId) throw new Error("Account identity changed");
    const account = current.account;
    drafts.push({ entityId: row.entityId, label: account ? (account.displayName || account.handle || account.externalId).slice(0, 240) : "Account (absent)", present: account !== null });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
