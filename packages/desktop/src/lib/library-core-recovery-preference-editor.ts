import { LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, createLibraryCoreRecoveryPreferenceDraftV1, type RecoveryPreferenceDraft, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** Verify complete original members before the form requests selected comparisons. */
export async function loadRecoveryPreferenceDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryPreferenceDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.preferences_leaf_assignment.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const drafts: RecoveryPreferenceDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    drafts.push(createLibraryCoreRecoveryPreferenceDraftV1(row, envelope, () => { if (signal.aborted) throw new Error("QUERY_CANCELLED"); }));
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
