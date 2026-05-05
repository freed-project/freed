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

    expect(workerSource).toContain("DESKTOP_UI_CONTENT_TEXT_LIMIT = 10_000");
    expect(body).toContain("contentText.slice(0, DESKTOP_UI_CONTENT_TEXT_LIMIT)");
    expect(body).toContain("preservedText.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT)");
    expect(workerSource).toContain(".map(trimFeedItemForDesktopUi)");
  });

  it("last sync persists without rehydrating the full document", () => {
    const body = caseBody("UPDATE_LAST_SYNC");

    expect(body).toContain("persistAndBroadcastWithoutHydration");
    expect(body).not.toContain("applyRequestChange");
    expect(body).not.toContain("saveAndBroadcast");
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
