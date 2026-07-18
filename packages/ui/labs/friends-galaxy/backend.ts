import type { FriendsGalaxyFieldStyle } from "../../src/lib/friends-galaxy-provider-fields.js";
import type { FriendsGalaxyInteraction } from "../../src/lib/friends-galaxy-scene-index.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyViewDetail,
} from "../../src/lib/friends-galaxy-renderer.js";

export type GalaxyLabBackendId = FriendsGalaxyRendererId;
export type GalaxyLabViewDetail = FriendsGalaxyViewDetail;
export type GalaxyLabFieldStyle = FriendsGalaxyFieldStyle;
export type GalaxyLabBackendMetrics = FriendsGalaxyRendererMetrics;
export type GalaxyLabInteraction = FriendsGalaxyInteraction;
export type GalaxyLabBackend = FriendsGalaxyRendererBackend;

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
