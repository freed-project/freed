import { invoke } from "@tauri-apps/api/core";
import { parseLibraryCoreRecoveryReissueReceiptV1, type LibraryCoreRecoveryReissueReceiptV1, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";

export type RecoveryReissueReceipt = LibraryCoreRecoveryReissueReceiptV1;

/** Native owns key custody, fresh identities, archive verification and retry. */
export async function reapplyArchivedAssignments(review: LibraryCoreRecoveryIntentReviewResponseV1): Promise<RecoveryReissueReceipt> {
  const value = await invoke<unknown>("reapply_normalized_library_archived_assignments", { request: recoveryRequest(review) });
  const parsed = parseLibraryCoreRecoveryReissueReceiptV1(value, review);
  if (!parsed.ok) throw new Error("Recovery returned a mismatched receipt");
  return parsed.value;
}

function recoveryRequest(review: LibraryCoreRecoveryIntentReviewResponseV1) {
  return {
    schemaVersion: 1, recoveryId: review.recoveryId, archiveDigest: review.archiveDigest,
    transactionId: review.transactionId, transactionDigest: review.transactionDigest,
    reviewedGenerationId: review.source.generationId, reviewedRevision: review.source.projectionRevision,
    reviewedLocalSequence: review.source.transitionSequence, memberCount: review.memberCount,
  };
}

/** Retry with the same finalized envelopes; native linkage decides the result. */
export async function reapplyArchivedEditorTransaction(review: LibraryCoreRecoveryIntentReviewResponseV1, canonicalEnvelopeJson: readonly string[]): Promise<RecoveryReissueReceipt> {
  const value = await invoke<unknown>("reapply_normalized_library_archived_editor_transaction", {
    request: recoveryRequest(review), canonicalEnvelopeJson,
  });
  const parsed = parseLibraryCoreRecoveryReissueReceiptV1(value, review);
  if (!parsed.ok) throw new Error("Recovery returned a mismatched receipt");
  return parsed.value;
}
