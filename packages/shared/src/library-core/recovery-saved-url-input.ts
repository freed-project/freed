import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";
import { FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

type ReviewRow = LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
export interface RecoverySavedUrlDraft {
  readonly entityId: string;
  readonly url: string;
  readonly archivedItem: Readonly<Record<string, LibraryCoreCanonicalValue>>;
  readonly currentText: string | null;
  readonly currentState: "present" | "absent";
  readonly title: string;
  readonly description: string;
}

/** Use only an already verified archive member. This never fetches its URL. */
export function createLibraryCoreRecoverySavedUrlDraftV1(
  row: ReviewRow,
  envelope: Readonly<Record<string, unknown>>,
): RecoverySavedUrlDraft {
  if (row.operationType !== "feed_item_capture_upsert" || envelope.entity_type !== "FeedItem" ||
      envelope.entity_id !== row.entityId || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
    throw new Error("This complete transaction needs another editor");
  if (row.itemState === "deleted") throw new Error("This saved item was deleted. Recovery cannot recreate it.");
  if (row.itemState !== "present" && row.itemState !== "absent") throw new Error("Saved item state is unavailable");
  if (row.itemPresent !== (row.itemState === "present")) throw new Error("Saved item state is inconsistent");
  const payload = FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
  if (!payload.ok) throw new Error("Archived saved item is invalid");
  const item = payload.value.item;
  if (item.platform !== "saved" || item.globalId !== row.entityId)
    throw new Error("This capture needs its original editor");
  const content = item.content as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  const preview = content.linkPreview as Readonly<Record<string, LibraryCoreCanonicalValue>> | undefined;
  const url = item.sourceUrl ?? preview?.url;
  if (typeof url !== "string" || (preview?.url !== undefined && preview.url !== url))
    throw new Error("Archived saved URL identity is inconsistent");
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("Archived saved URL is unsupported");
  return {
    entityId: row.entityId, url, archivedItem: item,
    currentText: row.itemText, currentState: row.itemState,
    title: typeof preview?.title === "string" ? preview.title : url,
    description: typeof preview?.description === "string" ? preview.description : "",
  };
}

export interface RecoverySavedUrlEdit {
  readonly entityId: string;
  readonly title: string;
  readonly description: string;
}

/** Freeze only editable fields before asynchronous archive reads or signing. */
export function snapshotLibraryCoreRecoverySavedUrlEditsV1(edits: readonly RecoverySavedUrlEdit[]): readonly RecoverySavedUrlEdit[] {
  if (!edits.length || edits.length > 1000) throw new Error("Saved URL recovery exceeds its member bound");
  let bytes = 0;
  const identities = new Set<string>();
  return edits.map(edit => {
    if (typeof edit.entityId !== "string" || !edit.entityId || identities.has(edit.entityId) ||
        typeof edit.title !== "string" || typeof edit.description !== "string") throw new Error("Saved URL edits are invalid");
    identities.add(edit.entityId);
    const selected = { entityId: edit.entityId, title: edit.title, description: edit.description };
    bytes += new TextEncoder().encode(JSON.stringify(selected)).length;
    if (bytes > 4_194_304) throw new Error("Saved URL recovery exceeds its byte bound");
    return Object.freeze(selected);
  });
}

/** Preserve all non-editor fields from the verified archive, including target and URL. */
export function reviseLibraryCoreRecoverySavedUrlV1(draft: RecoverySavedUrlDraft, edit: RecoverySavedUrlEdit): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  if (edit.entityId !== draft.entityId) throw new Error("Saved URL recovery cannot redirect an item");
  const content = draft.archivedItem.content as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  const preview = content.linkPreview as Readonly<Record<string, LibraryCoreCanonicalValue>> | undefined;
  const result = FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({ item: {
    ...draft.archivedItem,
    content: { ...content, linkPreview: { ...preview, url: draft.url, title: edit.title, description: edit.description } },
  } });
  if (!result.ok) throw new Error("Revised saved URL is invalid or too large");
  return result.value.item;
}
