import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
  join(process.cwd(), "src/lib/automerge.worker.ts"),
  "utf8",
);

function caseBody(caseName: string): string {
  const pattern = new RegExp(`case "${caseName}":[\\s\\S]*?break;`);
  return workerSource.match(pattern)?.[0] ?? "";
}

function functionBody(functionName: string): string {
  const pattern = new RegExp(`function ${functionName}\\([\\s\\S]*?\\n}`);
  return workerSource.match(pattern)?.[0] ?? "";
}

describe("automerge worker memory routing", () => {
  const patchOnlyMutations = [
    "MARK_AS_READ",
    "MARK_ITEMS_AS_READ",
    "MARK_ALL_AS_READ",
    "TOGGLE_SAVED",
    "TOGGLE_ARCHIVED",
    "ARCHIVE_ITEMS",
    "ARCHIVE_ALL_READ_UNSAVED",
    "UNARCHIVE_SAVED_ITEMS",
    "TOGGLE_LIKED",
    "CONFIRM_LIKED_SYNCED",
    "CONFIRM_SEEN_SYNCED",
  ];

  it.each(patchOnlyMutations)("%s emits item patches without full hydration", (caseName) => {
    const body = caseBody(caseName);

    expect(body).toContain("applyItemPatchChange");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
  });

  it("patch persistence does not hydrate or send a full state update", () => {
    const body = workerSource.match(
      /async function persistAndBroadcastWithoutHydration[\s\S]*?\n}/,
    )?.[0] ?? "";

    expect(body).toContain("persistDoc");
    expect(body).toContain("storage.save");
    expect(body).not.toContain("hydrateFromDoc");
    expect(body).not.toContain("STATE_UPDATE");
  });

  it("caps oversized item text in the desktop UI projection", () => {
    const body = functionBody("trimFeedItemForDesktopUi");
    const patchBody = functionBody("cloneFeedItemForPatch");

    expect(workerSource).toContain("DESKTOP_UI_CONTENT_TEXT_LIMIT = 280");
    expect(workerSource).toContain("DESKTOP_UI_PRESERVED_TEXT_LIMIT = 0");
    expect(workerSource).toContain("DESKTOP_UI_LINK_DESCRIPTION_LIMIT = 180");
    expect(body).toContain("contentText.slice(0, DESKTOP_UI_CONTENT_TEXT_LIMIT)");
    expect(body).toContain("preservedText.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT)");
    expect(workerSource).toContain("linkDescription.slice(0, DESKTOP_UI_LINK_DESCRIPTION_LIMIT)");
    expect(workerSource).toContain("const tags = next.contentSignals.tags ?? []");
    expect(workerSource).toContain("contentSignals: tags.length > 0 ? ({ tags } as FeedItem[\"contentSignals\"]) : undefined");
    expect(workerSource).toContain(".map(trimFeedItemForDesktopUi)");
    expect(patchBody).toContain("trimFeedItemForDesktopUi(cloned)");
  });

  it("reader text requests fall back to full synced feed text", () => {
    const body = caseBody("GET_ITEM_PRESERVED_TEXT");

    expect(body).toContain("preservedContent?.text");
    expect(body).toContain("content.text");
  });

  it("compacts oversized feed text before hydrating loaded documents", () => {
    const initBody = caseBody("INIT");
    const replaceBody = caseBody("REPLACE_DOC");
    const mergeBody = caseBody("MERGE_DOC");

    expect(workerSource).toContain("compactLoadedFeedText");
    expect(workerSource).toContain("FRESH_DOC_REBUILD_MIN_CHANGED_BINARY_BYTES = 4 * 1024 * 1024");
    expect(workerSource).toContain("FRESH_DOC_REBUILD_MIN_HISTORY_BINARY_BYTES = 16 * 1024 * 1024");
    expect(initBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text\",");
    expect(replaceBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text\",");
    expect(mergeBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text after merge\",");
    expect(initBody.indexOf("compactLoadedFeedText")).toBeLessThan(initBody.indexOf("saveAndBroadcast"));
  });

  it("rebuilds a fresh Automerge document after compacting oversized loaded history", () => {
    const compactBody = functionBody("compactLoadedFeedText");
    const initBody = caseBody("INIT");
    const replaceBody = caseBody("REPLACE_DOC");

    expect(workerSource).toContain("createDocFromData");
    expect(compactBody).toContain("createDocFromData(plain)");
    expect(compactBody).toContain("rebuilt compacted document");
    expect(compactBody).toContain("shouldProbeLargeHistory");
    expect(compactBody).toContain("kept existing compacted document history");
    expect(initBody.indexOf("currentBinary = saved")).toBeLessThan(initBody.indexOf("compactLoadedFeedText"));
    expect(replaceBody.indexOf("currentBinary = req.binary")).toBeLessThan(replaceBody.indexOf("compactLoadedFeedText"));
    expect(replaceBody).not.toContain("await storage.save(req.binary)");
  });

  it("compacts oversized feed text before item writes", () => {
    for (const caseName of ["ADD_FEED_ITEM", "ADD_FEED_ITEMS", "BATCH_REFRESH_FEEDS", "BATCH_IMPORT_ITEMS"]) {
      expect(caseBody(caseName)).toContain("compactFeedItemTextForSync");
    }
    expect(caseBody("UPDATE_FEED_ITEM")).toContain("compactFeedItemTextForSync(item)");
  });

  it("last sync persists without rehydrating the full document", () => {
    const body = caseBody("UPDATE_LAST_SYNC");

    expect(body).toContain("persistAndBroadcastWithoutHydration");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
  });

  it("display preference updates avoid full feed hydration", () => {
    const body = caseBody("UPDATE_PREFERENCES");
    const applyBody = functionBody("applyPreferenceChange");
    const requiresBody = functionBody("preferenceUpdateRequiresFullHydration");

    expect(body).toContain("applyPreferenceChange");
    expect(body).not.toContain("applyRequestChange");
    expect(applyBody).toContain("persistAndBroadcastWithoutHydration");
    expect(applyBody).toContain("PREFERENCES_PATCH");
    expect(applyBody).toContain("saveAndBroadcast");
    expect(requiresBody).toContain("updates.weights !== undefined");
  });

  it.each(["HEAL_UNTITLED_FEEDS", "DEDUPLICATE_ITEMS", "PRUNE_ARCHIVED_ITEMS"])(
    "%s skips full hydration when no records change",
    (caseName) => {
      const body = caseBody(caseName);

      expect(body).toContain("applyCountedChange");
      expect(body).not.toContain("applyRequestChange");
    },
  );

  it("batches provisional connection repair into one document mutation", () => {
    const body = caseBody("UPSERT_CONNECTION_PERSONS");

    expect(body).toContain("applyRequestChange");
    expect(body).toContain("updatePerson");
    expect(body).toContain("updateAccount");
    expect(body).toContain("ack(req.reqId)");
  });
});
