import type { GalaxyLabFixture, GalaxyLabPalette, GalaxyLabTransform } from "./scene-fixture.js";

export type GalaxyLabBackendId = "current-webgl2" | "three-webgpu" | "raw-webgpu";
export type GalaxyLabViewDetail = "overview" | "middle" | "close";

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
  setViewDetail(detail: GalaxyLabViewDetail): void;
  pickNode(viewportX: number, viewportY: number): string | null;
  setInteraction(interaction: GalaxyLabInteraction): void;
  render(transform: GalaxyLabTransform, timeMs: number): void;
  metrics(): GalaxyLabBackendMetrics;
  dispose(): void;
}

export interface GalaxyLabFrameStats {
  frameCount: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
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
