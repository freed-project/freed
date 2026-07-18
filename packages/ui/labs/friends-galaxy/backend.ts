import type { GalaxyActivityScenePatchBatch } from "./activity-scene-patches.js";
import type { GalaxyLabFixture, GalaxyLabPalette, GalaxyLabTransform } from "./scene-fixture.js";

export type GalaxyLabBackendId = "current-webgl2" | "three-webgpu" | "raw-webgpu";
export type GalaxyLabViewDetail = "overview" | "middle" | "close";
export type GalaxyLabFieldStyle = "nebula-rings" | "nebula" | "rings";

export interface GalaxyLabBackendMetrics {
  id: GalaxyLabBackendId;
  label: string;
  api: string;
  semanticStarCount: number;
  decorativeStarCount: number;
  drawCalls: number | null;
  labelCount: number;
  avatarCount: number;
  contextualEdgeCount: number;
  bufferUploadCount: number;
  residentStarUploadCount?: number;
  appliedActivityNodeCount?: number;
  pickCandidateCount?: number;
  pickSourceNodeCount?: number;
  renderPixelRatio?: number;
  trackedGpuDataBytes?: number;
  submissionMode?: string;
  renderBundleCount?: number;
  fallbackReason: string | null;
  adapterDescription: string | null;
}

export interface GalaxyLabInteraction {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
}

export interface GalaxyLabBackend {
  readonly id: GalaxyLabBackendId;
  initialize(
    canvas: HTMLCanvasElement,
    fixture: GalaxyLabFixture,
    palette: GalaxyLabPalette,
  ): Promise<void>;
  resize(width: number, height: number, pixelRatio: number): void;
  setPalette(palette: GalaxyLabPalette): void;
  applyActivityPatches?(patches: GalaxyActivityScenePatchBatch): void;
  setAvatarImages?(images: ReadonlyMap<string, CanvasImageSource>): void;
  setAnimationEnabled?(enabled: boolean): void;
  setCameraMotion?(active: boolean): void;
  setFieldStyle?(style: GalaxyLabFieldStyle): void;
  setViewDetail(detail: GalaxyLabViewDetail): void;
  pickNode(viewportX: number, viewportY: number): string | null;
  setInteraction(interaction: GalaxyLabInteraction): void;
  render(transform: GalaxyLabTransform, timeMs: number): void;
  takeFatalError?(): string | null;
  simulateDeviceLoss?(): void;
  metrics(): GalaxyLabBackendMetrics;
  dispose(): void;
}

export interface GalaxyLabFrameStats {
  frameCount: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
}

export function galaxyLabRenderPixelRatio(
  devicePixelRatio: number,
  viewportWidth: number,
  cameraInMotion: boolean,
): number {
  const normalizedRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const maximumRatio = cameraInMotion
    ? viewportWidth < 720 ? 1 : 1.25
    : 1.5;
  return Math.min(maximumRatio, Math.max(1, normalizedRatio));
}

export function frameStats(samples: readonly number[]): GalaxyLabFrameStats {
  if (samples.length === 0) {
    return { frameCount: 0, p50Ms: 0, p95Ms: 0, worstMs: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] ?? 0;
  return {
    frameCount: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    worstMs: sorted[sorted.length - 1] ?? 0,
  };
}

export function hexToRgb(value: string): [number, number, number] {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [1, 1, 1];
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}
