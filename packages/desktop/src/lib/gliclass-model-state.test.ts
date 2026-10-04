import { describe, expect, it, vi } from "vitest";
import { createLocalAIModelService, subscribeToLocalAIModelState } from "./local-ai-models";
import type { LocalAIModelManifestEntry } from "@freed/shared";

// Tier 1: a failed native integrity check must revoke persisted readiness while
// preserving summary selection and emitting one bounded lifecycle update.
describe("isolated classifier model readiness", () => {
  it("persists error instead of ready and leaves summary state untouched", async () => {
    const root = "/synthetic-app/local-ai-models";
    const classifier = `${root}/gliclass-state.json`;
    const summary = `${root}/state.json`;
    const storage = new Map([
      [classifier, JSON.stringify({ version: 1, models: { "gliclass-base": { id: "gliclass-base", revision: "synthetic", status: "available", health: {} } } })],
      [summary, JSON.stringify({ version: 1, selectedModelId: "integrated-local-ai-balanced", models: {} })],
    ]);
    const manifest = { id: "gliclass-base", revision: "synthetic", requiresWebGPU: false, wasmFallback: false, files: [], estimatedDownloadBytes: 0 } as unknown as LocalAIModelManifestEntry;
    const service = createLocalAIModelService({
      appDataDir: async () => "/synthetic-app", exists: async path => storage.has(path), mkdir: async () => {},
      readTextFile: async path => { const value = storage.get(path); if (!value) throw new Error("missing"); return value; },
      open: async () => { throw new Error("Unexpected file stream"); },
      readFile: async () => { throw new Error("Unexpected model read"); },
      remove: async () => { throw new Error("Unexpected model deletion"); },
      rename: async () => { throw new Error("Unexpected promotion"); },
      size: async () => { throw new Error("Unexpected size check"); },
      fetch: () => { throw new Error("Unexpected network request"); },
      sha256File: async () => { throw new Error("Unexpected model hash"); },
      getHardwareProfile: async () => null,
      writeTextFile: async (path, value) => { storage.set(path, value); }, now: () => 1000, webGPUAvailable: () => false,
    }, [manifest], { stateFile: "gliclass-state.json" });
    expect((await service.listModels())[0].state.status).toBe("available");
    const unchangedSummary = storage.get(summary);
    const changed = vi.fn(); const unsubscribe = subscribeToLocalAIModelState(changed);
    try {
      await service.invalidateModel("gliclass-base", "Synthetic integrity check failed.");
      const reloaded = (await service.listModels())[0].state;
      expect(reloaded.status).toBe("error");
      expect(reloaded.lastError).toContain("integrity");
      expect(storage.get(summary)).toBe(unchangedSummary);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });
});
