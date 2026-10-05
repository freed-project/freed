import { decodeLibraryCoreCanonicalValue, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { createDesktopLibraryCoreOperationId, queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

type ReviewRow = LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
/** Visit complete verified members, retaining at most one transport page. */
export async function visitRecoveryEditorMembers(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
  visit: (row: ReviewRow, envelope: Readonly<Record<string, unknown>>) => Promise<void>,
): Promise<RecoveryReissueReceipt | null> {
  if (review.replacement) return review.replacement;
  if (review.outcome.state === "confirmed_accepted") throw new Error("This edit was already accepted");
  let count = 0;
  let cursor: string | null = null;
  let bytes = 0;
  do {
    const page: LibraryCoreRecoveryIntentReviewResponseV1 = await queryNormalizedLibrary({ queryId: "recovery_intent_review_v1", schemaVersion: 1,
      recoveryId: review.recoveryId, transactionId: review.transactionId, includeOriginal: true, cursor, limit: 16,
      cancellationId: createDesktopLibraryCoreOperationId("editor-recovery-cancel"),
      readerSessionId: createDesktopLibraryCoreOperationId("editor-recovery-reader"),
    }, signal);
    if (page.archiveDigest !== review.archiveDigest || page.transactionDigest !== review.transactionDigest || page.memberCount !== review.memberCount)
      throw new Error("Recovery identity changed");
    if (page.replacement) return page.replacement;
    if (page.source.generationId !== review.source.generationId || page.source.projectionRevision !== review.source.projectionRevision || page.source.transitionSequence !== review.source.transitionSequence) throw new Error("CURSOR_STALE");
    for (const row of page.rows) {
      if (signal.aborted) throw new Error("QUERY_CANCELLED");
      if (row.memberIndex !== count || row.originalEnvelopeJson === null)
        throw new Error("This transaction needs a different editor; no members were removed");
      const encoded = new TextEncoder().encode(row.originalEnvelopeJson);
      bytes += encoded.length;
      if (bytes > 4194304 || count >= 1000) throw new Error("Recovery transaction exceeds its bounds");
      const envelope = decodeLibraryCoreCanonicalValue(encoded) as Readonly<Record<string, unknown>>;
      await visit(row, envelope);
      count += 1;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  if (count !== review.memberCount) throw new Error("Recovery transaction is incomplete");
  return null;
}
