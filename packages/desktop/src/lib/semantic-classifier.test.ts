import { afterEach, describe, expect, it, vi } from "vitest";
import localAIHealthFeedbackReplay from "../../tests/fixtures/local-ai-health-feedback-replay.json";

async function loadSemanticClassifierModule({
  enabled,
  summary = { updated: 1, remaining: 0, total: 28_349 },
  backfillImpl,
  notifyModelSubscriberOnHealthUpdate = false,
}: {
  enabled: { current: boolean };
  summary?: { updated: number; remaining: number; total: number };
  backfillImpl?: () => Promise<{ updated: number; remaining: number; total: number }>;
  notifyModelSubscriberOnHealthUpdate?: boolean;
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
  const mockDocBackfillContentSignals = vi.fn(
    backfillImpl ?? (async () => summary),
  );
  const mockUpdateHealth = vi.fn(async () => {
    if (notifyModelSubscriberOnHealthUpdate) callbacks.model?.();
  });
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

  it("drains an in-flight document backfill before reset cleanup begins", async () => {
    vi.useFakeTimers();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeSettled = vi.fn();
    const enabled = { current: true };
    const { mockDocBackfillContentSignals, mod } =
      await loadSemanticClassifierModule({
        enabled,
        backfillImpl: async () => {
          await writeGate;
          writeSettled();
          return { updated: 1, remaining: 0, total: 1 };
        },
      });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mockDocBackfillContentSignals).toHaveBeenCalledOnce();

    const cleanupStarted = vi.fn();
    const draining = mod.stopAndDrain().then(cleanupStarted);
    await Promise.resolve();
    expect(cleanupStarted).not.toHaveBeenCalled();

    releaseWrite();
    await draining;
    expect(writeSettled).toHaveBeenCalledOnce();
    expect(writeSettled.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupStarted.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
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
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 5_000);

    expect(mockDocBackfillContentSignals).toHaveBeenCalledWith(100);
    expect(mockUpdateHealth).toHaveBeenCalledWith("integrated-pro", {
      lastIndexedItemCount: 28_349,
      lastRunAt: expect.any(Number),
      failureCount: 0,
    });
    mod.stop();
  });

  it("does not run semantic enrichment during the launch memory quiet period", async () => {
    vi.useFakeTimers();
    const enabled = { current: true };
    const { mockDocBackfillContentSignals, mod } =
      await loadSemanticClassifierModule({ enabled });

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);

    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();
    mod.stop();
  });

  it("replays the five-second feedback loop when a health write is broadcast as a lifecycle change", async () => {
    vi.useFakeTimers();
    const enabled = { current: true };
    const replay = localAIHealthFeedbackReplay.automergeLoop;
    const terminalSummary = replay.semanticClassifier.terminalSummary;
    expect(localAIHealthFeedbackReplay.networkBoundary.providerTraffic).toBe(false);
    expect(replay.semanticClassifier.runtimeSummaryObserved).toBe(false);
    expect(replay.causalContract).toMatchObject({
      timerOwner: "semantic_classifier",
      rearmOwner: "local_ai_health_update_notification",
      cloudUploadSkipIsDownstream: true,
      cloudUploadSkipSchedulesClassifierTick: false,
    });
    const { mockDocBackfillContentSignals, mockUpdateHealth, mod } =
      await loadSemanticClassifierModule({
        enabled,
        summary: terminalSummary,
        notifyModelSubscriberOnHealthUpdate: true,
      });

    await vi.advanceTimersByTimeAsync(
      replay.semanticClassifier.startupDelayMs +
        (replay.semanticClassifier.processIntervalMs * 3),
    );

    expect(mockDocBackfillContentSignals).toHaveBeenCalledTimes(
      replay.expectedPositiveControl.healthBroadcastBatchCount,
    );
    expect(mockUpdateHealth).toHaveBeenCalledTimes(
      replay.expectedPositiveControl.healthBroadcastBatchCount,
    );
    mod.stop();
  });

  it("does not rearm a terminal batch when health persistence is not a lifecycle change", async () => {
    vi.useFakeTimers();
    const enabled = { current: true };
    const replay = localAIHealthFeedbackReplay.automergeLoop;
    const terminalSummary = replay.semanticClassifier.terminalSummary;
    const { mockDocBackfillContentSignals, mockUpdateHealth, mod } =
      await loadSemanticClassifierModule({
        enabled,
        summary: terminalSummary,
      });

    await vi.advanceTimersByTimeAsync(
      replay.semanticClassifier.startupDelayMs +
        (replay.semanticClassifier.processIntervalMs * 3),
    );

    expect(mockDocBackfillContentSignals).toHaveBeenCalledTimes(
      replay.expectedPositiveControl.isolatedHealthBatchCount,
    );
    expect(mockUpdateHealth).toHaveBeenCalledTimes(
      replay.expectedPositiveControl.isolatedHealthBatchCount,
    );
    mod.stop();
  });
});
