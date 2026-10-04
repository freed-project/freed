import { FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA, type FeedItemAnnotationsReplacePayloadV1, type LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

export interface RecoveryAnnotationDraft {
  readonly entityId: string;
  readonly label: string;
  readonly highlights: FeedItemAnnotationsReplacePayloadV1["highlights"];
  readonly tags: readonly string[];
}
/** Preserve the complete normalized set. Never hydrate or discard blob references. */
export async function loadRecoveryAnnotationDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal): Promise<
  { replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryAnnotationDraft[] }
> {
  const drafts: RecoveryAnnotationDraft[] = [];
  let draftBytes = 0;
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "feed_item_annotations_replace" || envelope.entity_type !== "FeedItem" || row.itemPresent !== true)
      throw new Error("The complete transaction needs an available item and annotation editor");
    const payload = FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (!payload.ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("The original annotation envelope cannot be preserved by this editor");
    const draft = { entityId: row.entityId, label: row.itemText?.slice(0, 240) || `Item ...${row.entityId.slice(-8)}`, highlights: payload.value.highlights, tags: payload.value.tags };
    draftBytes += new TextEncoder().encode(JSON.stringify(draft)).length;
    if (draftBytes > 4194304) throw new Error("Recovery annotation draft exceeds its bounds");
    drafts.push(draft);
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
