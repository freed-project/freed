import { expect, it } from "vitest";
import { generateSampleLibraryData } from "@freed/shared";
import { decodeLibraryCoreItemScanCursorV1 } from "@freed/shared/library-core";
import { tauriInitScript } from "./tauri-init.js";

it("preview cleanup scans the entire showcase with bounded source-bound cursors", () => {
  const runtime = {} as {
    __TAURI_MOCK_SQLITE_LIBRARY__: { items: Record<string, unknown> };
    __TAURI_MOCK_HANDLERS__: Record<string, (args: unknown) => {
      rows: Array<{ globalId: string }>;
      nextCursor: string | null;
      source: { generationId: string; projectionRevision: number; transitionSequence: number };
    }>;
  };
  new Function("window", tauriInitScript())(runtime);
  const items = generateSampleLibraryData({ seed: 42 }).items;
  runtime.__TAURI_MOCK_SQLITE_LIBRARY__.items = Object.fromEntries(items.map(item => [item.globalId, item]));
  let cursor: string | null = null;
  const seen: string[] = [];
  do {
    const page = runtime.__TAURI_MOCK_HANDLERS__.query_normalized_library({
      request: { queryId: "background_item_page_v1", schemaVersion: 1, limit: 64, cursor },
    });
    expect(page.rows.length).toBeLessThanOrEqual(64);
    seen.push(...page.rows.map(row => row.globalId));
    cursor = page.nextCursor;
    if (cursor) expect(decodeLibraryCoreItemScanCursorV1(cursor)).toEqual({
      ok: true,
      value: { ...page.source, globalId: page.rows.at(-1)!.globalId },
    });
    expect(seen.length).toBeLessThanOrEqual(items.length);
  } while (cursor);
  expect(seen).toEqual(items.map(item => item.globalId).sort());
});
