import type {
  GalaxyLabBackendMetrics,
  GalaxyLabFieldStyle,
  GalaxyLabFrameStats,
} from "./backend.js";
import type {
  FriendsGalaxyCameraScaleLimits,
  FriendsGalaxyOutwardZoomEnvelope,
} from "../../src/lib/friends-galaxy-camera.js";
import type { GalaxyLabThemeId } from "./scene-fixture.js";
import type { FriendsGalaxyTransform } from "../../src/lib/friends-galaxy-viewport.js";
import type { GalaxyLabFixtureWorkerReceipt } from "./scene-fixture-worker-protocol.js";
import type { FriendsGalaxyLongTaskSnapshot } from "../../src/lib/friends-galaxy-long-tasks.js";

export const GALAXY_LAB_DIAGNOSTIC_SCHEMA_VERSION = 1;

export interface GalaxyLabDiagnosticSnapshotInput {
  capturedAt: string;
  receipt: GalaxyLabFixtureWorkerReceipt;
  personCount: number;
  accountCount: number;
  backgroundStarCount: number;
  backend: GalaxyLabBackendMetrics | null;
  theme: GalaxyLabThemeId;
  fieldStyle: GalaxyLabFieldStyle;
  transform: FriendsGalaxyTransform;
  cameraScaleLimits: FriendsGalaxyCameraScaleLimits;
  outwardZoomEnvelope: FriendsGalaxyOutwardZoomEnvelope;
  viewportWidth: number;
  viewportHeight: number;
  cameraInMotion: boolean;
  selectionActive: boolean;
  hoverActive: boolean;
  touchInputMode: string;
  wheelInputMode: string;
  inertialPanActive: boolean;
  presentationVisible: boolean;
  frameLoop: string;
  settlePending: boolean;
  renderResizePending: boolean;
  backendGeneration: number;
  backendRecoveryPending: boolean;
  backendTerminalFailure: boolean;
  recoveryReason: string | null;
  longTasks: FriendsGalaxyLongTaskSnapshot;
  frame: GalaxyLabFrameStats;
  submit: GalaxyLabFrameStats;
  activityPatchKeyCount: number;
  activityPatchNodeCount: number;
  unknownActivitySourceCount: number;
  avatarRequestedCount: number;
  avatarReadyCount: number;
  avatarFailureCount: number;
}

export interface GalaxyLabDiagnosticSnapshot {
  schemaVersion: typeof GALAXY_LAB_DIAGNOSTIC_SCHEMA_VERSION;
  capturedAt: string;
  source: {
    personCount: number;
    accountCount: number;
    activitySummaryCount: number;
    representedActivityItemCount: number;
    semanticNodeCount: number;
    metadataNodeCount: number;
    backgroundStarCount: number;
    transferableBufferCount: number;
  };
  renderer: {
    id: string | null;
    label: string | null;
    api: string | null;
    adapterDescription: string | null;
    fallbackReason: string | null;
    semanticStarCount: number | null;
    decorativeStarCount: number | null;
    motionDecorativeStarCount: number | null;
    drawCalls: number | null;
    renderBundleCount: number | null;
    submissionMode: string | null;
    bufferUploadCount: number | null;
    residentStarUploadCount: number | null;
    renderPixelRatio: number | null;
    trackedGpuDataBytes: number | null;
  };
  presentation: {
    labelCount: number | null;
    avatarCount: number | null;
    contextualEdgeCount: number | null;
    labelAtlasBuildCount: number | null;
    avatarAtlasBuildCount: number | null;
    avatarRequestedCount: number;
    avatarReadyCount: number;
    avatarFailureCount: number;
  };
  activity: {
    patchKeyCount: number;
    patchNodeCount: number;
    unknownSourceCount: number;
    appliedNodeCount: number | null;
  };
  camera: {
    x: number;
    y: number;
    scale: number;
    minimumScale: number;
    resistanceScale: number;
    fitMinimumScale: number;
    outwardTargetScale: number;
    maximumScale: number;
    viewportWidth: number;
    viewportHeight: number;
    inMotion: boolean;
  };
  interaction: {
    selectionActive: boolean;
    hoverActive: boolean;
    touchInputMode: string;
    wheelInputMode: string;
    inertialPanActive: boolean;
  };
  runtime: {
    theme: GalaxyLabThemeId;
    fieldStyle: GalaxyLabFieldStyle;
    presentationVisible: boolean;
    frameLoop: string;
    settlePending: boolean;
    renderResizePending: boolean;
    backendGeneration: number;
    backendRecoveryPending: boolean;
    backendTerminalFailure: boolean;
    recoveryReason: string | null;
    frame: GalaxyLabFrameStats;
    submit: GalaxyLabFrameStats;
    longTasks: FriendsGalaxyLongTaskSnapshot;
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(value: string | null | undefined, maximumLength = 512): string | null {
  if (!value) return null;
  return value.slice(0, maximumLength);
}

export function createGalaxyLabDiagnosticSnapshot(
  input: GalaxyLabDiagnosticSnapshotInput,
): GalaxyLabDiagnosticSnapshot {
  const { backend } = input;
  return {
    schemaVersion: GALAXY_LAB_DIAGNOSTIC_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    source: {
      personCount: input.personCount,
      accountCount: input.accountCount,
      activitySummaryCount: input.receipt.activitySummaryCount,
      representedActivityItemCount: input.receipt.representedActivityItemCount,
      semanticNodeCount: input.receipt.semanticNodeCount,
      metadataNodeCount: input.receipt.metadataNodeCount,
      backgroundStarCount: input.backgroundStarCount,
      transferableBufferCount: input.receipt.transferableBufferCount,
    },
    renderer: {
      id: backend?.id ?? null,
      label: boundedText(backend?.label, 128),
      api: boundedText(backend?.api, 128),
      adapterDescription: boundedText(backend?.adapterDescription, 256),
      fallbackReason: boundedText(backend?.fallbackReason),
      semanticStarCount: finiteOrNull(backend?.semanticStarCount),
      decorativeStarCount: finiteOrNull(backend?.decorativeStarCount),
      motionDecorativeStarCount: finiteOrNull(backend?.motionDecorativeStarCount),
      drawCalls: finiteOrNull(backend?.drawCalls),
      renderBundleCount: finiteOrNull(backend?.renderBundleCount),
      submissionMode: boundedText(backend?.submissionMode, 128),
      bufferUploadCount: finiteOrNull(backend?.bufferUploadCount),
      residentStarUploadCount: finiteOrNull(backend?.residentStarUploadCount),
      renderPixelRatio: finiteOrNull(backend?.renderPixelRatio),
      trackedGpuDataBytes: finiteOrNull(backend?.trackedGpuDataBytes),
    },
    presentation: {
      labelCount: finiteOrNull(backend?.labelCount),
      avatarCount: finiteOrNull(backend?.avatarCount),
      contextualEdgeCount: finiteOrNull(backend?.contextualEdgeCount),
      labelAtlasBuildCount: finiteOrNull(backend?.labelAtlasBuildCount),
      avatarAtlasBuildCount: finiteOrNull(backend?.avatarAtlasBuildCount),
      avatarRequestedCount: input.avatarRequestedCount,
      avatarReadyCount: input.avatarReadyCount,
      avatarFailureCount: input.avatarFailureCount,
    },
    activity: {
      patchKeyCount: input.activityPatchKeyCount,
      patchNodeCount: input.activityPatchNodeCount,
      unknownSourceCount: input.unknownActivitySourceCount,
      appliedNodeCount: finiteOrNull(backend?.appliedActivityNodeCount),
    },
    camera: {
      x: input.transform.x,
      y: input.transform.y,
      scale: input.transform.scale,
      minimumScale: input.cameraScaleLimits.minimum,
      resistanceScale: input.outwardZoomEnvelope.resistance,
      fitMinimumScale: input.cameraScaleLimits.fitMinimum,
      outwardTargetScale: input.outwardZoomEnvelope.target,
      maximumScale: input.cameraScaleLimits.maximum,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      inMotion: input.cameraInMotion,
    },
    interaction: {
      selectionActive: input.selectionActive,
      hoverActive: input.hoverActive,
      touchInputMode: input.touchInputMode,
      wheelInputMode: input.wheelInputMode,
      inertialPanActive: input.inertialPanActive,
    },
    runtime: {
      theme: input.theme,
      fieldStyle: input.fieldStyle,
      presentationVisible: input.presentationVisible,
      frameLoop: input.frameLoop,
      settlePending: input.settlePending,
      renderResizePending: input.renderResizePending,
      backendGeneration: input.backendGeneration,
      backendRecoveryPending: input.backendRecoveryPending,
      backendTerminalFailure: input.backendTerminalFailure,
      recoveryReason: boundedText(input.recoveryReason),
      frame: { ...input.frame },
      submit: { ...input.submit },
      longTasks: { ...input.longTasks },
    },
  };
}

export function serializeGalaxyLabDiagnosticSnapshot(
  snapshot: GalaxyLabDiagnosticSnapshot,
): string {
  return JSON.stringify(snapshot, null, 2);
}
