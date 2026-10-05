import { describe, expect, it } from "vitest";
import fixture from "./recovery-review-vector-v1.json";
import { createLibraryCoreRecoverySavedUrlDraftV1, snapshotLibraryCoreRecoverySavedUrlEditsV1, reviseLibraryCoreRecoverySavedUrlV1 } from "./recovery-saved-url-input.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

describe("saved URL recovery input", () => {
  const item = {
    globalId: "saved:bounded", platform: "saved", contentType: "article", capturedAt: 1, publishedAt: 1,
    author: { id: "author", handle: "ada", displayName: "Ada" },
    content: { text: "Preserved excerpt", mediaUrls: [], mediaTypes: [], linkPreview: { url: "https://example.org/article", title: "Archived title", description: "Archived description" } },
    topics: [], userState: { hidden: false, saved: true, archived: false, tags: [] },
    sourceUrl: "https://example.org/article",
  };
  const envelope = { entity_type: "FeedItem", entity_id: item.globalId, blob_references: [], payload: { item } };
  const row = { ...fixture.response.rows[0], entityId: item.globalId, operationType: "feed_item_capture_upsert", itemState: "absent", itemPresent: false } as LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
  it("retains the complete source payload and fixed target while allowing an absent item", () => {
    const draft = createLibraryCoreRecoverySavedUrlDraftV1(row, envelope);
    expect(draft).toMatchObject({ entityId: item.globalId, url: item.sourceUrl, title: "Archived title", currentState: "absent" });
    expect(draft.archivedItem).toEqual(item);
    expect(draft.archivedItem).not.toBe(item);
    expect(item.content.text).toBe("Preserved excerpt");
  });
  it("snapshots editable values and never lets a revision redirect or discard capture fields", () => {
    const draft = createLibraryCoreRecoverySavedUrlDraftV1(row, envelope);
    const edits = [{ entityId: item.globalId, title: "Reviewed title", description: "Reviewed description" }];
    const selected = snapshotLibraryCoreRecoverySavedUrlEditsV1(edits);
    edits[0]!.title = "Changed later";
    const revised = reviseLibraryCoreRecoverySavedUrlV1(draft, selected[0]!);
    expect(revised).toEqual({ ...item, content: { ...item.content, linkPreview: { ...item.content.linkPreview, title: "Reviewed title", description: "Reviewed description" } } });
    expect(() => reviseLibraryCoreRecoverySavedUrlV1(draft, { ...selected[0]!, entityId: "other" })).toThrow(/redirect/);
    expect(() => snapshotLibraryCoreRecoverySavedUrlEditsV1([selected[0]!, selected[0]!])).toThrow(/invalid/);
  });
  it("refuses deleted, inconsistent, redirected, provider and blob-backed targets", () => {
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1({ ...row, itemState: "deleted" }, envelope)).toThrow(/deleted/);
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1({ ...row, itemState: "present" }, envelope)).toThrow(/inconsistent/);
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1(row, { ...envelope, entity_id: "another" })).toThrow(/another editor/);
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1(row, { ...envelope, blob_references: ["a".repeat(64)] })).toThrow(/another editor/);
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1(row, { ...envelope, payload: { item: { ...item, platform: "rss" } } })).toThrow(/original editor/);
    expect(() => createLibraryCoreRecoverySavedUrlDraftV1(row, { ...envelope, payload: { item: { ...item, sourceUrl: "https://example.org/other" } } })).toThrow(/inconsistent/);
  });
});
