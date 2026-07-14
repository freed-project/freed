import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedWorkerDebugEvents,
  getPersistedWorkerDebugEvents,
  persistWorkerDebugEvent,
} from "./automerge-worker-debug";

describe("PWA worker debug storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("clears persisted diagnostics during factory reset", () => {
    persistWorkerDebugEvent({ kind: "worker-init", detail: "test" });
    expect(getPersistedWorkerDebugEvents()).toHaveLength(1);

    clearPersistedWorkerDebugEvents();

    expect(getPersistedWorkerDebugEvents()).toEqual([]);
  });

  it("propagates storage removal failures", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => clearPersistedWorkerDebugEvents()).toThrow("storage unavailable");
  });
});
