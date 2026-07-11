import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
  join(process.cwd(), "src/lib/automerge.worker.ts"),
  "utf8",
);
const clientSource = readFileSync(
  join(process.cwd(), "src/lib/automerge.ts"),
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

function sectionBody(start: string, end: string): string {
  const startIndex = workerSource.indexOf(start);
  const endIndex = workerSource.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return workerSource.slice(startIndex, endIndex);
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
    expect(workerSource).toContain("DESKTOP_UI_EVENT_EVIDENCE_LIMIT = 220");
    expect(body).toContain("contentText?.slice(0, DESKTOP_UI_CONTENT_TEXT_LIMIT)");
    expect(body).toContain("preservedText?.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT)");
    expect(workerSource).toContain("linkDescription?.slice(0, DESKTOP_UI_LINK_DESCRIPTION_LIMIT)");
    expect(workerSource).toContain("eventEvidence?.slice(0, DESKTOP_UI_EVENT_EVIDENCE_LIMIT)");
    expect(workerSource).toContain("const tags = item.contentSignals?.tags ?? []");
    expect(workerSource).toContain("contentSignals: tags.length > 0 ? ({ tags: [...tags] } as FeedItem[\"contentSignals\"]) : undefined");
    expect(workerSource).toContain("cloneFeedItemsForDesktopUi");
    expect(patchBody).toContain("trimFeedItemForDesktopUi(item)");
    expect(patchBody).not.toContain("JSON.parse(JSON.stringify(item))");
  });

  it("hydrates desktop UI state without deep cloning the whole document first", () => {
    const body = functionBody("hydrateFromDoc");

    expect(body).not.toContain("A.toJS(doc)");
    expect(body).toContain("cloneFeedItemsForDesktopUi");
    expect(body).toContain("cloneRecordValues(doc.rssFeeds");
    expect(body).toContain("docItemCount");
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
    expect(initBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text\",");
    expect(replaceBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text\",");
    expect(mergeBody).toContain("compactLoadedFeedText(\"Compact oversized synced feed text after merge\",");
    expect(initBody.indexOf("compactLoadedFeedText")).toBeLessThan(initBody.indexOf("hydrateAndBroadcastWithoutPersist"));
  });

  it("clean startup hydration avoids serializing and rewriting the loaded document", () => {
    const helperBody = workerSource.match(
      /async function hydrateAndBroadcastWithoutPersist[\s\S]*?\n}/,
    )?.[0] ?? "";
    const initBody = caseBody("INIT");

    expect(workerSource).toContain("hydrateAndBroadcastWithoutPersist");
    expect(helperBody).toContain("hydrateFromDoc");
    expect(helperBody).toContain("STATE_UPDATE");
    expect(helperBody).not.toContain("persistDoc");
    expect(helperBody).not.toContain("storage.save");
    expect(helperBody).not.toContain("A.save");
    expect(initBody).toContain("loadedDocNeedsPersist");
    expect(initBody).toContain("hydrateAndBroadcastWithoutPersist(trace)");
  });

  it("releases the Automerge document after idle and reloads it on demand", () => {
    const scheduleBody = functionBody("scheduleDocIdleUnload");
    const ensureBody = functionBody("ensureCurrentDocLoaded");
    const enqueueBody = functionBody("enqueueRequest");
    const handleBody = functionBody("handleRequest");

    expect(scheduleBody).toContain("currentDoc = null");
    expect(scheduleBody).toContain("createPersistenceState(currentBinary)");
    expect(scheduleBody).toContain("request queue drained");
    expect(ensureBody).toContain("A.load<FreedDoc>(currentBinary)");
    expect(enqueueBody).toContain("scheduleDocIdleUnload()");
    expect(handleBody).toContain("cancelDocIdleUnload()");
    expect(handleBody).toContain("ensureCurrentDocLoaded(req.type)");
  });

  it("keeps the unloaded worker shell through a bounded quiet window", () => {
    expect(clientSource).toContain("let worker: Worker | null = null");
    expect(clientSource).toContain("let idleWorkerStopTimer");
    expect(clientSource).toContain("IDLE_WORKER_STOP_DELAY_MS = 30_000");
    expect(clientSource).toContain("IDLE_WORKER_STOP_RETRY_MS = 1_000");
    expect(clientSource).toContain("function hasPendingWorkerRequests()");
    expect(clientSource).toContain("function stopIdleWorker()");
    expect(clientSource).toContain("function cancelIdleWorkerStop()");
    expect(clientSource).toContain("function completeWorkerActivity(");
    expect(clientSource).toContain("function scheduleIdleWorkerStop(");
    expect(clientSource).toContain("scheduleIdleWorkerStop(IDLE_WORKER_STOP_RETRY_MS)");
    expect(clientSource).toContain("worker.terminate()");
    expect(clientSource).toContain("ensureWorkerDocumentReadyFor(msg.type)");
    expect(clientSource).toContain("cancelIdleWorkerStop();");
    expect(clientSource).toContain("completeWorkerActivity(IDLE_WORKER_STOP_RETRY_MS)");
    expect(clientSource).toContain('if ("reqId" in msg && appDocumentInitialized)');
    expect(clientSource).toContain("await sendInit()");
    expect(clientSource).toContain("(msg.detail ?? \"\").startsWith(\"[automerge-worker] released idle document\")");
    expect(clientSource).toContain("scheduleIdleWorkerStop();");
  });

  it("rebuilds a fresh Automerge document only after compacting oversized text", () => {
    const compactBody = functionBody("compactLoadedFeedText");
    const initBody = caseBody("INIT");
    const replaceBody = caseBody("REPLACE_DOC");

    expect(workerSource).toContain("createDocFromData");
    expect(compactBody).toContain("createDocFromData(plain)");
    expect(compactBody).toContain("rebuilt compacted document");
    expect(compactBody).toContain("summary.changed > 0");
    expect(compactBody).not.toContain("shouldProbeLargeHistory");
    expect(compactBody).not.toContain("kept existing compacted document history");
    expect(workerSource).not.toContain("FRESH_DOC_REBUILD_MIN_HISTORY_BINARY_BYTES");
    expect(initBody.indexOf("currentBinary = saved")).toBeLessThan(initBody.indexOf("compactLoadedFeedText"));
    expect(replaceBody.indexOf("currentBinary = req.binary")).toBeLessThan(replaceBody.indexOf("compactLoadedFeedText"));
    expect(replaceBody).not.toContain("await storage.save(req.binary)");
  });

  it("compacts oversized feed text before item writes", () => {
    for (const caseName of ["ADD_FEED_ITEM", "BATCH_IMPORT_ITEMS"]) {
      expect(caseBody(caseName)).toContain("compactFeedItemTextForSync");
    }
    expect(workerSource).toContain("async function applyBatchRefreshFeedsPatchChange");
    expect(sectionBody(
      "async function applyBatchRefreshFeedsPatchChange",
      "async function handleRequest",
    )).toContain("compactFeedItemTextForSync(item)");
    expect(workerSource).toContain("async function applyAddFeedItemsPatchChange");
    expect(workerSource).toContain("compactFeedItemTextForSync(item)");
    expect(caseBody("UPDATE_FEED_ITEM")).toContain("compactFeedItemTextForSync(item)");
  });

  it("RSS batch refresh emits patches without hydrating every feed item", () => {
    const body = caseBody("BATCH_REFRESH_FEEDS");
    const helperBody = sectionBody(
      "async function applyBatchRefreshFeedsPatchChange",
      "async function handleRequest",
    );

    expect(body).toContain("applyBatchRefreshFeedsPatchChange(req.feeds, req.items, trace)");
    expect(body).not.toContain("applyRequestChange");
    expect(helperBody).toContain("persistAndBroadcastWithoutHydration");
    expect(helperBody).toContain("type: \"FEEDS_PATCH\"");
    expect(helperBody).toContain("type: \"ITEM_PATCH\"");
    expect(helperBody).toContain("hasKnownLinkPreviewUrl");
    expect(helperBody).not.toContain("Object.values(doc.feedItems");
    expect(helperBody).not.toContain("saveAndBroadcast");
  });

  it("batch item writes use item patches unless social dedup rewrites existing records", () => {
    const body = caseBody("ADD_FEED_ITEMS");

    expect(body).toContain("applyAddFeedItemsPatchChange(req.items, trace)");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
    expect(workerSource).toContain("async function applyAddFeedItemsPatchChange");
    expect(workerSource).toContain("await persistAndBroadcastWithoutHydration(trace)");
    expect(workerSource).toContain("type: \"ITEM_PATCH\"");
    expect(workerSource).toContain("preservePriorityOrder: true");
    expect(workerSource).toContain("cloneRankedFeedItemPatches");
    expect(workerSource).not.toContain("rankedVisibleItemIdsFromDoc");
    expect(workerSource).toContain("searchCorpusVersion");
    expect(workerSource).toContain("changedIds.length > 0");
    expect(workerSource).toContain("reason=social_dedup");
  });

  it("last sync persists without rehydrating the full document", () => {
    const body = caseBody("UPDATE_LAST_SYNC");

    expect(body).toContain("persistAndBroadcastWithoutHydration");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
  });

  it("RSS feed metadata writes avoid full feed item hydration", () => {
    const addBody = caseBody("ADD_RSS_FEED");
    const updateBody = caseBody("UPDATE_RSS_FEED");
    const removeBody = caseBody("REMOVE_RSS_FEED");
    const applyBody = functionBody("applyRssFeedPatchChange");
    const clientBody = clientSource.match(
      /if \(msg.type === "FEEDS_PATCH"\) \{[\s\S]*?return;\n  \}/,
    )?.[0] ?? "";

    for (const body of [addBody, updateBody]) {
      expect(body).toContain("applyRssFeedPatchChange");
      expect(body).not.toContain("applyRequestChange");
      expect(body).not.toContain("saveAndBroadcast");
    }

    expect(removeBody).toContain("if (req.includeItems)");
    expect(removeBody).toContain("applyRequestChange");
    expect(removeBody).toContain("applyRssFeedPatchChange");
    expect(applyBody).toContain("persistAndBroadcastWithoutHydration");
    expect(applyBody).toContain("FEEDS_PATCH");
    expect(applyBody).not.toContain("saveAndBroadcast");
    expect(clientBody).toContain("Object.assign(feeds, msg.patch.feeds)");
    expect(clientBody).toContain("source: \"feeds_patch\"");
  });

  it("display preference updates avoid full feed hydration", () => {
    const body = caseBody("UPDATE_PREFERENCES");
    const applyBody = functionBody("applyPreferenceChange");
    const requiresBody = functionBody("preferenceUpdateRequiresFullHydration");

    expect(body).toContain("applyPreferenceChange");
    expect(body).not.toContain("applyRequestChange");
    expect(applyBody).toContain("persistAndBroadcastWithoutHydration");
    expect(applyBody).toContain("PREFERENCES_PATCH");
    expect(applyBody).toContain("updates, mutation");
    expect(applyBody).toContain("saveAndBroadcast");
    expect(workerSource).not.toContain("A.toJS(doc.preferences");
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
