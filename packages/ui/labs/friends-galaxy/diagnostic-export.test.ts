import { describe, expect, it } from "vitest";
import type { GalaxyLabBackendMetrics } from "./backend.js";
import {
  createGalaxyLabDiagnosticSnapshot,
  serializeGalaxyLabDiagnosticSnapshot,
} from "./diagnostic-export.js";

const backend: GalaxyLabBackendMetrics = {
  id: "raw-webgpu",
  label: "Raw WebGPU",
  api: "WebGPU WGSL",
  semanticStarCount: 30_000,
  decorativeStarCount: 100_000,
  motionDecorativeStarCount: 50_000,
  drawCalls: 4,
  labelCount: 20,
  avatarCount: 6,
  labelAtlasBuildCount: 3,
  avatarAtlasBuildCount: 2,
  contextualEdgeCount: 4,
  bufferUploadCount: 18,
  residentStarUploadCount: 2,
  appliedActivityNodeCount: 1,
  pickCandidateCount: 14,
  pickSourceNodeCount: 30_000,
  renderPixelRatio: 1.5,
  trackedGpuDataBytes: 9_000_000,
  submissionMode: "Pre-recorded frame bundles",
  renderBundleCount: 4,
  fallbackReason: null,
  adapterDescription: "apple metal-3",
};

describe("Friends Galaxy diagnostic export", () => {
  it("serializes bounded renderer health without identity or content payloads", () => {
    const snapshot = createGalaxyLabDiagnosticSnapshot({
      capturedAt: "2026-07-18T18:10:00.000Z",
      receipt: {
        semanticNodeCount: 30_000,
        metadataNodeCount: 192,
        activitySummaryCount: 25_000,
        representedActivityItemCount: 250_000,
        transferableBufferCount: 21,
      },
      personCount: 5_000,
      accountCount: 25_000,
      backgroundStarCount: 100_000,
      backend,
      theme: "scriptorium",
      fieldStyle: "nebula",
      transform: { x: 120, y: -80, scale: 0.92 },
      cameraScaleLimits: {
        minimum: 0.07,
        resistance: 0.11,
        fitMinimum: 0.075,
        maximum: 3.7,
      },
      outwardZoomEnvelope: {
        target: 0.18,
        resistance: 0.27,
      },
      viewportWidth: 390,
      viewportHeight: 844,
      cameraInMotion: false,
      selectionActive: true,
      hoverActive: false,
      touchInputMode: "Native Touch Events",
      wheelInputMode: "pinch-zoom",
      inertialPanActive: false,
      presentationVisible: false,
      frameLoop: "idle",
      settlePending: false,
      renderResizePending: false,
      recoveryReason: null,
      longTasks: {
        supported: true,
        count: 2,
        totalDurationMs: 133,
        worstDurationMs: 81,
        latestStartTime: 240,
      },
      frame: { frameCount: 240, p50Ms: 16, p95Ms: 24, worstMs: 31 },
      submit: { frameCount: 240, p50Ms: 0.1, p95Ms: 0.2, worstMs: 0.4 },
      activityPatchKeyCount: 1,
      activityPatchNodeCount: 1,
      unknownActivitySourceCount: 0,
      avatarRequestedCount: 6,
      avatarReadyCount: 6,
      avatarFailureCount: 0,
    });
    const serialized = serializeGalaxyLabDiagnosticSnapshot(snapshot);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      source: {
        activitySummaryCount: 25_000,
        representedActivityItemCount: 250_000,
        transferableBufferCount: 21,
      },
      renderer: {
        id: "raw-webgpu",
        residentStarUploadCount: 2,
      },
      interaction: {
        selectionActive: true,
        hoverActive: false,
      },
      camera: {
        minimumScale: 0.07,
        fitMinimumScale: 0.075,
        outwardTargetScale: 0.18,
        resistanceScale: 0.27,
      },
      runtime: {
        presentationVisible: false,
        longTasks: {
          supported: true,
          count: 2,
          worstDurationMs: 81,
        },
      },
    });
    expect(serialized).not.toContain("nodeId");
    expect(serialized).not.toContain("personId");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("avatarUrl");
    expect(serialized).not.toContain("sampleItemIds");
    expect(serialized.length).toBeLessThan(5_000);
  });

  it("normalizes unavailable and non-finite backend values", () => {
    const snapshot = createGalaxyLabDiagnosticSnapshot({
      capturedAt: "2026-07-18T18:10:00.000Z",
      receipt: {
        semanticNodeCount: 0,
        metadataNodeCount: 0,
        activitySummaryCount: 0,
        representedActivityItemCount: 0,
        transferableBufferCount: 0,
      },
      personCount: 0,
      accountCount: 0,
      backgroundStarCount: 0,
      backend: { ...backend, renderPixelRatio: Number.NaN },
      theme: "vesper",
      fieldStyle: "rings",
      transform: { x: 0, y: 0, scale: 1 },
      cameraScaleLimits: {
        minimum: 0.1,
        resistance: 0.15,
        fitMinimum: 0.11,
        maximum: 4,
      },
      outwardZoomEnvelope: {
        target: 0.2,
        resistance: 0.3,
      },
      viewportWidth: 1,
      viewportHeight: 1,
      cameraInMotion: false,
      selectionActive: false,
      hoverActive: false,
      touchInputMode: "Pointer Events",
      wheelInputMode: "idle",
      inertialPanActive: false,
      presentationVisible: true,
      frameLoop: "idle",
      settlePending: false,
      renderResizePending: false,
      recoveryReason: null,
      longTasks: {
        supported: false,
        count: null,
        totalDurationMs: null,
        worstDurationMs: null,
        latestStartTime: null,
      },
      frame: { frameCount: 0, p50Ms: 0, p95Ms: 0, worstMs: 0 },
      submit: { frameCount: 0, p50Ms: 0, p95Ms: 0, worstMs: 0 },
      activityPatchKeyCount: 0,
      activityPatchNodeCount: 0,
      unknownActivitySourceCount: 0,
      avatarRequestedCount: 0,
      avatarReadyCount: 0,
      avatarFailureCount: 0,
    });

    expect(snapshot.renderer.renderPixelRatio).toBeNull();
  });
});
