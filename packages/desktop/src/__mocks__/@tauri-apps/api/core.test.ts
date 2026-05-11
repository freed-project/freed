import { beforeEach, describe, expect, it } from "vitest";
import { invoke } from "./core";

type TauriMockWindow = Window & {
  __TAURI_MOCK_INVOCATIONS__?: Array<{ cmd: string; args?: Record<string, unknown> }>;
  __TAURI_MOCK_IPC_TIMINGS__?: Array<{ cmd: string; startMs: number; endMs: number }>;
};

describe("Tauri core mock", () => {
  beforeEach(() => {
    const w = window as TauriMockWindow;
    delete w.__TAURI_MOCK_INVOCATIONS__;
    delete w.__TAURI_MOCK_IPC_TIMINGS__;
    delete (globalThis as unknown as TauriMockWindow).__TAURI_MOCK_IPC_TIMINGS__;
  });

  it("recreates invoke and timing logs if a page script clears them", async () => {
    const w = window as TauriMockWindow;

    await invoke("broadcast_doc", { probe: true });
    const timings =
      w.__TAURI_MOCK_IPC_TIMINGS__ ??
      (globalThis as unknown as TauriMockWindow).__TAURI_MOCK_IPC_TIMINGS__;

    expect(w.__TAURI_MOCK_INVOCATIONS__).toEqual([
      { cmd: "broadcast_doc", args: { probe: true } },
    ]);
    expect(timings).toHaveLength(1);
    expect(timings?.[0].cmd).toBe("broadcast_doc");
    expect(timings?.[0].endMs).toBeGreaterThanOrEqual(timings?.[0].startMs ?? 0);
  });
});
