import type { FriendsGalaxyActivityScenePatchBatch } from "./friends-galaxy-activity-patches.js";
import type { FriendsGalaxyFieldStyle } from "./friends-galaxy-provider-fields.js";
import type { FriendsGalaxyInteraction } from "./friends-galaxy-scene-index.js";
import type { FriendsGalaxyStarPalette } from "./friends-galaxy-palette.js";
import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";

export type FriendsGalaxyRendererId = "current-webgl2" | "raw-webgpu" | "three-webgpu";
export type FriendsGalaxyViewDetail = "overview" | "middle" | "close";

export interface FriendsGalaxyRendererMetrics {
  id: FriendsGalaxyRendererId;
  label: string;
  api: string;
  semanticStarCount: number;
  decorativeStarCount: number;
  motionDecorativeStarCount?: number;
  drawCalls: number | null;
  labelCount: number;
  avatarCount: number;
  labelAtlasBuildCount?: number;
  avatarAtlasBuildCount?: number;
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

export interface FriendsGalaxyRenderer<
  Scene,
  Palette extends FriendsGalaxyStarPalette,
> {
  readonly id: FriendsGalaxyRendererId;
  initialize(
    canvas: HTMLCanvasElement,
    scene: Scene,
    palette: Palette,
  ): Promise<void>;
  resize(width: number, height: number, pixelRatio: number): void;
  setPalette(palette: Palette): void;
  applyActivityPatches?(patches: FriendsGalaxyActivityScenePatchBatch): void;
  setAvatarImages?(images: ReadonlyMap<string, CanvasImageSource>): void;
  setAnimationEnabled?(enabled: boolean): void;
  setCameraMotion?(active: boolean): void;
  setFieldStyle?(style: FriendsGalaxyFieldStyle): void;
  setViewDetail(detail: FriendsGalaxyViewDetail): void;
  setSettledView?(detail: FriendsGalaxyViewDetail, transform: FriendsGalaxyTransform): void;
  pickNode(viewportX: number, viewportY: number): string | null;
  setInteraction(interaction: FriendsGalaxyInteraction): void;
  render(transform: FriendsGalaxyTransform, timeMs: number): void;
  takeFatalError?(): string | null;
  simulateDeviceLoss?(): void;
  metrics(): FriendsGalaxyRendererMetrics;
  dispose(): void;
}

export function friendsGalaxyRenderPixelRatio(
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
