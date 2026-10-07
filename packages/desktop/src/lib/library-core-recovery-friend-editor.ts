import { readLibraryCoreRecoveryFriendDraftV1, type RecoveryFriendDraft, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** Preserve the whole one-member Friend edit and read only its bounded account union. */
export async function loadRecoveryFriendDraft(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; draft?: never } | { replacement: null; draft: RecoveryFriendDraft }
> {
  if (review.memberCount !== 1) throw new Error("Friend recovery requires its complete single-member transaction");
  let draft: RecoveryFriendDraft | undefined;
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    draft = await readLibraryCoreRecoveryFriendDraftV1(review, row, envelope,
      request => queryNormalizedLibrary(request, signal), () => { if (signal.aborted) throw new Error("QUERY_CANCELLED"); });
  });
  if (replacement) return { replacement };
  if (!draft) throw new Error("Friend recovery is incomplete");
  return { replacement: null, draft };
}
