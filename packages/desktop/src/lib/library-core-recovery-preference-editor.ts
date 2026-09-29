import { LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, readLibraryCoreRecoveryPreferenceContextV1, type RecoveryPreferenceDraft, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** Original members stay ordered; all comparisons share one bounded current snapshot. */
export async function loadRecoveryPreferenceDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryPreferenceDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.preferences_leaf_assignment.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const drafts: RecoveryPreferenceDraft[] = [];
  let context: Awaited<ReturnType<typeof readLibraryCoreRecoveryPreferenceContextV1>> | undefined;
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    context ??= await readLibraryCoreRecoveryPreferenceContextV1(review, request => queryNormalizedLibrary(request, signal), () => { if (signal.aborted) throw new Error("QUERY_CANCELLED"); });
    drafts.push(context(row, envelope));
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
