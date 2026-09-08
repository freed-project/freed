import { expect, it, vi } from "vitest";
import { generateSampleLibraryData } from "@freed/shared";
import { decodeLibraryCoreItemScanCursorV1 } from "@freed/shared/library-core";
import { tauriInitScript } from "./tauri-init.js";

it("serializes yielding mock writes and saves each complete snapshot before acknowledgment", async () => {
  vi.useFakeTimers();
  try {
    let time = 0;
    const runtime = { name: "" } as {
      name: string;
      __TAURI_MOCK_SQLITE_LIBRARY__: {
        revision: number;
        items: Record<string, { globalId: string; userState: { readAt?: number } }>;
      };
      __TAURI_MOCK_HANDLERS__: Record<string, (args?: unknown) => Promise<unknown>>;
    };
    const boot = (target: unknown) => new Function("window", "performance", tauriInitScript())(
      target, { now: () => time += 5 },
    );
    boot(runtime);
    runtime.__TAURI_MOCK_SQLITE_LIBRARY__.items = {
      first: { globalId: "first", userState: {} },
      second: { globalId: "second", userState: {} },
    };
    const initialize = runtime.__TAURI_MOCK_HANDLERS__.ensure_fresh_normalized_desktop_library();
    await vi.runAllTimersAsync();
    await initialize;
    const initialSnapshot = runtime.name;
    const commit = (entityId: string, readAt: number) =>
      runtime.__TAURI_MOCK_HANDLERS__.commit_normalized_library_transaction({
        request: {
          canonicalEnvelopeJson: [JSON.stringify({
            entity_id: entityId,
            operation_type: "feed_item_read_assignment",
            payload: { read_at_ms: readAt },
          })],
        },
      });
    const acknowledged: string[] = [];
    const first = commit("first", 123).then(() => acknowledged.push(runtime.name));
    const second = commit("second", 456).then(() => acknowledged.push(runtime.name));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.name).toBe(initialSnapshot);
    expect(acknowledged).toEqual([]);
    expect(runtime.__TAURI_MOCK_SQLITE_LIBRARY__.items.second.userState.readAt).toBeUndefined();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    const restored = acknowledged.map(name => {
      const target = { name } as typeof runtime;
      boot(target);
      return target.__TAURI_MOCK_SQLITE_LIBRARY__;
    });
    expect(restored[0].revision).toBe(1);
    expect(restored[0].items.first.userState.readAt).toBe(123);
    expect(restored[0].items.second.userState.readAt).toBeUndefined();
    expect(restored[1]).toEqual(runtime.__TAURI_MOCK_SQLITE_LIBRARY__);
    expect(restored[1].revision).toBe(2);
    expect(restored[1].items.second.userState.readAt).toBe(456);
    // A rejected command must not poison the serialization queue.
    await expect(runtime.__TAURI_MOCK_HANDLERS__.mutate_normalized_device_graph_layout({
      mutation: { mutationId: "person_position_set_v1", entityId: "missing" },
    })).rejects.toThrow("target is unavailable");
    const next = commit("first", 789);
    await vi.runAllTimersAsync();
    await next;
    const afterFailure = { name: runtime.name } as typeof runtime;
    boot(afterFailure);
    expect(afterFailure.__TAURI_MOCK_SQLITE_LIBRARY__).toEqual(runtime.__TAURI_MOCK_SQLITE_LIBRARY__);
    expect(afterFailure.__TAURI_MOCK_SQLITE_LIBRARY__.items.first.userState.readAt).toBe(789);
  } finally {
    vi.useRealTimers();
  }
});

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
