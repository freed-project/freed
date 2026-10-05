import { createLibraryCoreRecoverySavedUrlDraftV1, type RecoverySavedUrlDraft, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

/** Load every member before presenting a bounded, offline saved-URL editor. */
export async function loadRecoverySavedUrlDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoverySavedUrlDraft[] }
> {
  const drafts: RecoverySavedUrlDraft[] = [];
  let bytes = 0;
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const draft = createLibraryCoreRecoverySavedUrlDraftV1(row, envelope);
    bytes += new TextEncoder().encode(JSON.stringify(draft)).length;
    if (bytes > 4_194_304) throw new Error("Saved URL recovery exceeds its byte bound");
    drafts.push(draft);
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
