import { afterEach, describe, expect, it, vi } from "vitest";

async function loadSemanticClassifierModule({
  enabled,
  summary = { updated: 1, remaining: 0, total: 28_349 },
}: {
  enabled: { current: boolean };
  summary?: { updated: number; remaining: number; total: number };
}) {
  vi.resetModules();

  const callbacks: {
    doc: ((state: { docItemCount: number }) => void) | null;
    model: (() => void) | null;
    preferences: (() => void) | null;
  } = {
    doc: null,
    model: null,
    preferences: null,
  };
  const mockDocBackfillContentSignals = vi.fn(async () => summary);
  const mockUpdateHealth = vi.fn(async () => undefined);
  const mockListModels = vi.fn(async () => [
    {
      selected: true,
      manifest: {
        id: "integrated-pro",
        supportsSemanticSearch: true,
      },
      state: {
        status: "available",
      },
    },
  ]);

  vi.doMock("./automerge.js", () => ({
    docBackfillContentSignals: mockDocBackfillContentSignals,
    subscribe: vi.fn((callback: (state: { docItemCount: number }) => void) => {
      callbacks.doc = callback;
      return () => {
        callbacks.doc = null;
      };
    }),
  }));
  vi.doMock("./local-ai-models.js", () => ({
    localAIModels: {
      listModels: mockListModels,
      updateHealth: mockUpdateHealth,
    },
    subscribeToLocalAIModelState: vi.fn((callback: () => void) => {
      callbacks.model = callback;
      return () => {
        callbacks.model = null;
      };
    }),
  }));
  vi.doMock("@freed/ui/lib/debug-store", () => ({
    addDebugEvent: vi.fn(),
  }));
  vi.doMock("./logger.js", () => ({
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const mod = await import("./semantic-classifier.js");
  mod.start({
    isEnabled: () => enabled.current,
    subscribeToPreferenceChanges: (callback) => {
      callbacks.preferences = callback;
      return () => {
        callbacks.preferences = null;
      };
    },
  });

  return {
    callbacks,
    mockDocBackfillContentSignals,
    mockUpdateHealth,
    mod,
  };
}

describe("semantic classifier", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("does not backfill or record health while workflow preferences are disabled", async () => {
    vi.useFakeTimers();
    const enabled = { current: false };
    const { callbacks, mockDocBackfillContentSignals, mockUpdateHealth, mod } =
      await loadSemanticClassifierModule({ enabled });

    callbacks.doc?.({ docItemCount: 1 });
    callbacks.model?.();
    callbacks.preferences?.();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();
    expect(mockUpdateHealth).not.toHaveBeenCalled();
    mod.stop();
  });

  it("starts classification and records health when Topics and ranking becomes enabled", async () => {
    vi.useFakeTimers();
    const enabled = { current: false };
    const { callbacks, mockDocBackfillContentSignals, mockUpdateHealth, mod } =
      await loadSemanticClassifierModule({ enabled });

    enabled.current = true;
    callbacks.preferences?.();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockDocBackfillContentSignals).toHaveBeenCalledWith(100);
    expect(mockUpdateHealth).toHaveBeenCalledWith("integrated-pro", {
      lastIndexedItemCount: 28_349,
      lastRunAt: expect.any(Number),
      failureCount: 0,
    });
    mod.stop();
  });
});
