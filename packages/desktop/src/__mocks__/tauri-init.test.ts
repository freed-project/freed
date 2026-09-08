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

it("mock transactions preserve current rows across reload without hot-path corpus snapshots", () => {
  const listeners = new Map<string, () => void>();
  let snapshotWrites = 0;
  let snapshot = "";
  const runtime = {
    get name() { return snapshot; },
    set name(value: string) { snapshot = value; snapshotWrites += 1; },
    addEventListener(type: string, listener: () => void) { listeners.set(type, listener); },
  } as typeof window & {
    __TAURI_MOCK_SQLITE_LIBRARY__: { revision: number; persons: Record<string, unknown> };
    __TAURI_MOCK_HANDLERS__: Record<string, (args: unknown) => unknown>;
  };
  new Function("window", tauriInitScript())(runtime);
  for (const displayName of ["First", "Latest"]) {
    runtime.__TAURI_MOCK_HANDLERS__.commit_normalized_library_transaction({
      request: { canonicalEnvelopeJson: [JSON.stringify({
        operation_type: "person_upsert", entity_id: "person:reload",
        payload: { person: { id: "person:reload", displayName } },
      })] },
    });
  }
  expect(snapshotWrites).toBe(0);
  expect(runtime.__TAURI_MOCK_SQLITE_LIBRARY__.persons["person:reload"]).toEqual({ id: "person:reload", displayName: "Latest" });
  listeners.get("beforeunload")!();
  listeners.get("pagehide")!();
  expect(snapshotWrites).toBe(1);
  const reloaded = { name: snapshot } as typeof runtime;
  new Function("window", tauriInitScript())(reloaded);
  expect(reloaded.__TAURI_MOCK_SQLITE_LIBRARY__).toEqual(runtime.__TAURI_MOCK_SQLITE_LIBRARY__);
});
