import type { FriendsGalaxyActivityScenePatchBatch } from "./friends-galaxy-activity-patches.js";
import {
  FriendsGalaxyBackendRuntime,
  type FriendsGalaxyBackendActivation,
  type FriendsGalaxyBackendFailure,
  type FriendsGalaxyBackendLoading,
  type FriendsGalaxyBackendRecovery,
} from "./friends-galaxy-backend-runtime.js";
import { createFriendsGalaxyRendererBackend } from "./friends-galaxy-backend-factory.js";
import type { FriendsGalaxyRendererPalette } from "./friends-galaxy-palette.js";
import type { FriendsGalaxyNodePresentationResolver } from "./friends-galaxy-presentation.js";
import type { FriendsGalaxyFieldStyle } from "./friends-galaxy-provider-fields.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyRendererScene,
  FriendsGalaxyViewDetail,
} from "./friends-galaxy-renderer.js";
import type { FriendsGalaxyInteraction } from "./friends-galaxy-scene-index.js";
import type { IdentityGraphAtlas } from "./identity-graph-atlas.js";
import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";

type RendererActivation = FriendsGalaxyBackendActivation<
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererBackend,
  HTMLCanvasElement
>;

export interface FriendsGalaxyRendererHostOptions {
  scene: FriendsGalaxyRendererScene;
  palette: FriendsGalaxyRendererPalette;
  resolvePresentation: FriendsGalaxyNodePresentationResolver;
  createSurface(id: FriendsGalaxyRendererId): HTMLCanvasElement;
  mountSurface(surface: HTMLCanvasElement, id: FriendsGalaxyRendererId): void;
  showSurface(surface: HTMLCanvasElement, id: FriendsGalaxyRendererId): void;
  removeSurface(surface: HTMLCanvasElement): void;
  createBackend?(id: FriendsGalaxyRendererId): Promise<FriendsGalaxyRendererBackend>;
  onLoading?(loading: FriendsGalaxyBackendLoading<FriendsGalaxyRendererId>): void;
  onActivated?(activation: RendererActivation): void;
  onRecovering?(recovery: FriendsGalaxyBackendRecovery<FriendsGalaxyRendererId>): void;
  onFailure?(failure: FriendsGalaxyBackendFailure<FriendsGalaxyRendererId>): void;
  onDisposed?(): void;
}

export class FriendsGalaxyRendererHost {
  private scene: FriendsGalaxyRendererScene;
  private palette: FriendsGalaxyRendererPalette;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private ambientMotionEnabled = true;
  private cameraMotion = false;
  private fieldStyle: FriendsGalaxyFieldStyle = "nebula";
  private interaction: FriendsGalaxyInteraction = {
    selectedNodeId: null,
    hoveredNodeId: null,
  };
  private detail: FriendsGalaxyViewDetail = "overview";
  private settledTransform: FriendsGalaxyTransform | null = null;
  private activityPatches: FriendsGalaxyActivityScenePatchBatch | null = null;
  private readonly runtime: FriendsGalaxyBackendRuntime<
    FriendsGalaxyRendererId,
    FriendsGalaxyRendererBackend,
    HTMLCanvasElement
  >;

  constructor(options: FriendsGalaxyRendererHostOptions) {
    this.scene = options.scene;
    this.palette = options.palette;
    const createBackend = options.createBackend ?? ((id) =>
      createFriendsGalaxyRendererBackend(id, options.resolvePresentation));
    this.runtime = new FriendsGalaxyBackendRuntime({
      compatibilityId: "current-webgl2",
      createSurface: options.createSurface,
      mountSurface: options.mountSurface,
      showSurface: options.showSurface,
      removeSurface: options.removeSurface,
      createBackend,
      initializeBackend: async (backend, canvas) => {
        await backend.initialize(canvas, this.scene, this.palette);
        this.applyState(backend);
      },
      fallbackReason: (backend) => backend.metrics().fallbackReason,
      backendLabel: (backend) => backend.metrics().label,
      onLoading: options.onLoading,
      onActivated: options.onActivated,
      onRecovering: options.onRecovering,
      onFailure: options.onFailure,
      onDisposed: options.onDisposed,
    });
  }

  get activeBackend(): FriendsGalaxyRendererBackend | null {
    return this.runtime.activeBackend;
  }

  get activeId(): FriendsGalaxyRendererId | null {
    return this.runtime.activeId;
  }

  get generation(): number {
    return this.runtime.generation;
  }

  get recoveryPending(): boolean {
    return this.runtime.recoveryPending;
  }

  get terminalFailure(): boolean {
    return this.runtime.terminalFailure;
  }

  get recoveryReason(): string | null {
    return this.runtime.recoveryReason;
  }

  activate(id: FriendsGalaxyRendererId): Promise<RendererActivation | null> {
    return this.runtime.activate(id);
  }

  replaceScene(scene: FriendsGalaxyRendererScene): Promise<RendererActivation | null> {
    this.scene = scene;
    return this.activeId ? this.activate(this.activeId) : Promise.resolve(null);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Number.isFinite(width) && width > 0 ? width : 1;
    this.height = Number.isFinite(height) && height > 0 ? height : 1;
    this.pixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0
      ? pixelRatio
      : 1;
    this.activeBackend?.resize(this.width, this.height, this.pixelRatio);
  }

  setPalette(palette: FriendsGalaxyRendererPalette): void {
    this.palette = palette;
    this.activeBackend?.setPalette(palette);
  }

  setAmbientMotionEnabled(enabled: boolean): void {
    this.ambientMotionEnabled = enabled;
    this.activeBackend?.setAmbientMotionEnabled?.(enabled);
  }

  setCameraMotion(active: boolean): void {
    this.cameraMotion = active;
    this.activeBackend?.setCameraMotion?.(active);
  }

  setFieldStyle(style: FriendsGalaxyFieldStyle): void {
    this.fieldStyle = style;
    this.activeBackend?.setFieldStyle?.(style);
  }

  setInteraction(interaction: FriendsGalaxyInteraction): void {
    this.interaction = { ...interaction };
    this.activeBackend?.setInteraction(this.interaction);
  }

  setSettledView(
    detail: FriendsGalaxyViewDetail,
    transform: FriendsGalaxyTransform,
  ): void {
    this.detail = detail;
    this.settledTransform = { ...transform };
    const backend = this.activeBackend;
    if (!backend) return;
    if (backend.setSettledView) backend.setSettledView(detail, this.settledTransform);
    else backend.setViewDetail(detail);
  }

  setSettledPresentation(
    atlas: IdentityGraphAtlas,
    detail: FriendsGalaxyViewDetail,
    transform: FriendsGalaxyTransform,
  ): void {
    this.scene = { ...this.scene, atlas };
    this.detail = detail;
    this.settledTransform = { ...transform };
    const backend = this.activeBackend;
    if (!backend) return;
    backend.setPresentationAtlas(atlas);
    if (backend.setSettledView) backend.setSettledView(detail, this.settledTransform);
    else backend.setViewDetail(detail);
  }

  applyActivityPatches(patches: FriendsGalaxyActivityScenePatchBatch): void {
    this.activityPatches = patches;
    this.activeBackend?.applyActivityPatches?.(patches);
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    return this.activeBackend?.pickNode(viewportX, viewportY) ?? null;
  }

  render(transform: FriendsGalaxyTransform, timeMs: number): void {
    this.activeBackend?.render(transform, timeMs);
  }

  metrics(): FriendsGalaxyRendererMetrics | null {
    return this.activeBackend?.metrics() ?? null;
  }

  pollHealth(): Promise<RendererActivation | null> | null {
    return this.runtime.pollHealth();
  }

  recoverFromFatalError(
    backend: FriendsGalaxyRendererBackend,
    reason: string,
  ): Promise<RendererActivation | null> | null {
    return this.runtime.recoverFromFatalError(backend, reason);
  }

  simulateDeviceLoss(): void {
    this.activeBackend?.simulateDeviceLoss?.();
  }

  dispose(): void {
    this.runtime.dispose();
  }

  private applyState(backend: FriendsGalaxyRendererBackend): void {
    backend.setAmbientMotionEnabled?.(this.ambientMotionEnabled);
    backend.setCameraMotion?.(this.cameraMotion);
    backend.setFieldStyle?.(this.fieldStyle);
    backend.resize(this.width, this.height, this.pixelRatio);
    backend.setInteraction(this.interaction);
    if (this.settledTransform && backend.setSettledView) {
      backend.setSettledView(this.detail, this.settledTransform);
    } else {
      backend.setViewDetail(this.detail);
    }
    if (this.activityPatches) backend.applyActivityPatches?.(this.activityPatches);
  }
}
