import type {
  FriendsGalaxyRendererMetrics,
} from "./friends-galaxy-renderer.js";
import type { FriendsGalaxyFieldStyle } from "./friends-galaxy-provider-fields.js";
import type {
  FriendsGalaxyCameraScaleLimits,
  FriendsGalaxyOutwardZoomEnvelope,
} from "./friends-galaxy-camera.js";
import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";
import type { FriendsGalaxyLongTaskSnapshot } from "./friends-galaxy-long-tasks.js";

export const FRIENDS_GALAXY_DIAGNOSTIC_SCHEMA_VERSION = 1;

export interface FriendsGalaxyDiagnosticSourceReceipt {
  semanticNodeCount: number;
  metadataNodeCount: number;
  activitySummaryCount: number;
  representedActivityItemCount: number;
  transferableBufferCount: number;
}

export interface FriendsGalaxyFrameStats {
  frameCount: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
}

export function friendsGalaxyFrameStats(
  samples: readonly number[],
): FriendsGalaxyFrameStats {
  if (samples.length === 0) {
    return { frameCount: 0, p50Ms: 0, p95Ms: 0, worstMs: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number): number => sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))
  ] ?? 0;
  return {
    frameCount: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    worstMs: sorted[sorted.length - 1] ?? 0,
  };
}

export interface FriendsGalaxyDiagnosticSnapshotInput {
  capturedAt: string;
  receipt: FriendsGalaxyDiagnosticSourceReceipt;
  personCount: number;
  accountCount: number;
  backgroundStarCount: number;
  backend: FriendsGalaxyRendererMetrics | null;
  theme: string;
  fieldStyle: FriendsGalaxyFieldStyle;
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
  frame: FriendsGalaxyFrameStats;
  submit: FriendsGalaxyFrameStats;
  activityPatchKeyCount: number;
  activityPatchNodeCount: number;
  unknownActivitySourceCount: number;
  avatarRequestedCount: number;
  avatarReadyCount: number;
  avatarFailureCount: number;
}

export interface FriendsGalaxyDiagnosticSnapshot {
  schemaVersion: typeof FRIENDS_GALAXY_DIAGNOSTIC_SCHEMA_VERSION;
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
    theme: string;
    fieldStyle: FriendsGalaxyFieldStyle;
    presentationVisible: boolean;
    frameLoop: string;
    settlePending: boolean;
    renderResizePending: boolean;
    backendGeneration: number;
    backendRecoveryPending: boolean;
    backendTerminalFailure: boolean;
    recoveryReason: string | null;
    frame: FriendsGalaxyFrameStats;
    submit: FriendsGalaxyFrameStats;
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

function boundedRequiredText(value: string, maximumLength = 128): string {
  return value.slice(0, maximumLength);
}

export function createFriendsGalaxyDiagnosticSnapshot(
  input: FriendsGalaxyDiagnosticSnapshotInput,
): FriendsGalaxyDiagnosticSnapshot {
  const { backend } = input;
  return {
    schemaVersion: FRIENDS_GALAXY_DIAGNOSTIC_SCHEMA_VERSION,
    capturedAt: boundedRequiredText(input.capturedAt, 64),
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
      touchInputMode: boundedRequiredText(input.touchInputMode, 64),
      wheelInputMode: boundedRequiredText(input.wheelInputMode, 64),
      inertialPanActive: input.inertialPanActive,
    },
    runtime: {
      theme: boundedRequiredText(input.theme, 64),
      fieldStyle: input.fieldStyle,
      presentationVisible: input.presentationVisible,
      frameLoop: boundedRequiredText(input.frameLoop, 64),
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

export function serializeFriendsGalaxyDiagnosticSnapshot(
  snapshot: FriendsGalaxyDiagnosticSnapshot,
): string {
  return JSON.stringify(snapshot, null, 2);
}
