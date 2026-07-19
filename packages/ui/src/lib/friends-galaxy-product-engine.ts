import type { FriendsGalaxyActivityScenePatchBatch } from "./friends-galaxy-activity-patches.js";
import type { FriendsGalaxyRendererPalette } from "./friends-galaxy-palette.js";
import { FriendsGalaxyProductPresentationIndex } from "./friends-galaxy-product-presentation.js";
import {
  FriendsGalaxyProductWorkerClient,
  type FriendsGalaxyProductWorkerActivityInput,
  type FriendsGalaxyProductWorkerFailure,
  type FriendsGalaxyProductWorkerPort,
  type FriendsGalaxyProductWorkerPresentationInput,
  type FriendsGalaxyProductWorkerSourceInput,
} from "./friends-galaxy-product-worker-client.js";
import type {
  FriendsGalaxyProductWorkerActivityResponse,
  FriendsGalaxyProductWorkerPresentationResponse,
  FriendsGalaxyProductWorkerSourceResponse,
} from "./friends-galaxy-product-worker-protocol.js";
import type { FriendsGalaxyFieldStyle } from "./friends-galaxy-provider-fields.js";
import {
  FriendsGalaxyRendererHost,
  type FriendsGalaxyRendererHostOptions,
} from "./friends-galaxy-renderer-host.js";
import {
  friendsGalaxyViewDetailForScale,
  type FriendsGalaxyRendererBackend,
  type FriendsGalaxyRendererId,
  type FriendsGalaxyRendererMetrics,
  type FriendsGalaxyViewDetail,
} from "./friends-galaxy-renderer.js";
import type { FriendsGalaxyInteraction } from "./friends-galaxy-scene-index.js";
import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";
import type { IdentityGraphAtlasNode } from "./identity-graph-atlas.js";

export interface FriendsGalaxyProductEngineOptions extends Omit<
  FriendsGalaxyRendererHostOptions,
  "scene" | "palette" | "resolvePresentation"
> {
  palette: FriendsGalaxyRendererPalette;
  rendererId?: FriendsGalaxyRendererId;
  createWorker?: () => FriendsGalaxyProductWorkerPort;
  workerTimeoutMs?: number;
  now?: () => number;
  onWorkerFailure?(failure: FriendsGalaxyProductWorkerFailure): void;
  onSourceSceneReady?(response: FriendsGalaxyProductWorkerSourceResponse): void;
  onPresentationReady?(
    response: FriendsGalaxyProductWorkerPresentationResponse,
  ): void;
  onActivityReady?(response: FriendsGalaxyProductWorkerActivityResponse): void;
}

export class FriendsGalaxyProductEngine {
  private readonly presentation = new FriendsGalaxyProductPresentationIndex();
  private readonly worker: FriendsGalaxyProductWorkerClient;
  private readonly rendererOptions: Omit<
    FriendsGalaxyRendererHostOptions,
    "scene" | "palette" | "resolvePresentation"
  >;
  private readonly onSourceSceneReady: FriendsGalaxyProductEngineOptions["onSourceSceneReady"];
  private readonly onPresentationReady: FriendsGalaxyProductEngineOptions["onPresentationReady"];
  private readonly onActivityReady: FriendsGalaxyProductEngineOptions["onActivityReady"];
  private renderer: FriendsGalaxyRendererHost | null = null;
  private rendererId: FriendsGalaxyRendererId;
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
  private settledDetail: FriendsGalaxyViewDetail = "overview";
  private settledTransform: FriendsGalaxyTransform | null = null;
  private activityPatches: FriendsGalaxyActivityScenePatchBatch | null = null;
  private latestPresentation: FriendsGalaxyProductWorkerPresentationInput | null = null;
  private admittedSourceRevision: number | null = null;
  private disposed = false;

  constructor(options: FriendsGalaxyProductEngineOptions) {
    const {
      palette,
      rendererId = "raw-webgpu",
      createWorker,
      workerTimeoutMs,
      now,
      onWorkerFailure,
      onSourceSceneReady,
      onPresentationReady,
      onActivityReady,
      ...rendererOptions
    } = options;
    this.palette = palette;
    this.rendererId = rendererId;
    this.rendererOptions = rendererOptions;
    this.onSourceSceneReady = onSourceSceneReady;
    this.onPresentationReady = onPresentationReady;
    this.onActivityReady = onActivityReady;
    this.worker = new FriendsGalaxyProductWorkerClient({
      createWorker,
      timeoutMs: workerTimeoutMs,
      now,
      onSourceReady: (response) => this.receiveSource(response),
      onPresentationReady: (response) => this.receivePresentation(response),
      onActivityReady: (response) => this.receiveActivity(response),
      onFailure: (failure) => onWorkerFailure?.(failure),
    });
  }

  get activeRenderer(): FriendsGalaxyRendererBackend | null {
    return this.renderer?.activeBackend ?? null;
  }

  get activeRendererId(): FriendsGalaxyRendererId | null {
    return this.renderer?.activeId ?? null;
  }

  get activeSourceRevision(): number | null {
    return this.admittedSourceRevision;
  }

  get sourceReady(): boolean {
    return this.admittedSourceRevision !== null;
  }

  get workerSourceReady(): boolean {
    return this.worker.sourceReady;
  }

  get requestedSourceRevision(): number | null {
    return this.worker.activeSourceRevision;
  }

  get presentationNodeCount(): number {
    return this.presentation.nodeCount;
  }

  get droppedWorkerResponseCount(): number {
    return this.worker.droppedResponseCount;
  }

  get workerFailureCount(): number {
    return this.worker.failureCount;
  }

  get recoveryPending(): boolean {
    return this.renderer?.recoveryPending ?? false;
  }

  get terminalRendererFailure(): boolean {
    return this.renderer?.terminalFailure ?? false;
  }

  get recoveryReason(): string | null {
    return this.renderer?.recoveryReason ?? null;
  }

  requestSource(input: FriendsGalaxyProductWorkerSourceInput): number {
    this.assertActive();
    this.latestPresentation = null;
    this.activityPatches = null;
    return this.worker.requestSource(input);
  }

  requestSettledPresentation(
    input: FriendsGalaxyProductWorkerPresentationInput,
  ): number | null {
    this.assertActive();
    const previousPresentation = this.latestPresentation;
    this.latestPresentation = {
      ...input,
      viewport: {
        ...input.viewport,
        transform: { ...input.viewport.transform },
      },
    };
    const requestId = this.worker.requestPresentation(input);
    if (requestId === null) this.latestPresentation = previousPresentation;
    return requestId;
  }

  requestActivity(
    input: FriendsGalaxyProductWorkerActivityInput,
  ): number | null {
    this.assertActive();
    return this.worker.requestActivity(input);
  }

  activateRenderer(
    rendererId: FriendsGalaxyRendererId,
  ): ReturnType<FriendsGalaxyRendererHost["activate"]> {
    this.assertActive();
    this.rendererId = rendererId;
    return this.renderer?.activate(rendererId) ?? Promise.resolve(null);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Number.isFinite(width) && width > 0 ? width : 1;
    this.height = Number.isFinite(height) && height > 0 ? height : 1;
    this.pixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0
      ? pixelRatio
      : 1;
    this.renderer?.resize(this.width, this.height, this.pixelRatio);
  }

  setPalette(palette: FriendsGalaxyRendererPalette): void {
    this.palette = palette;
    this.renderer?.setPalette(palette);
  }

  setAmbientMotionEnabled(enabled: boolean): void {
    this.ambientMotionEnabled = enabled;
    this.renderer?.setAmbientMotionEnabled(enabled);
  }

  setCameraMotion(active: boolean): void {
    this.cameraMotion = active;
    this.renderer?.setCameraMotion(active);
  }

  setFieldStyle(style: FriendsGalaxyFieldStyle): void {
    this.fieldStyle = style;
    this.renderer?.setFieldStyle(style);
  }

  setInteraction(interaction: FriendsGalaxyInteraction): void {
    this.interaction = { ...interaction };
    this.renderer?.setInteraction(this.interaction);
  }

  setSettledView(
    detail: FriendsGalaxyViewDetail,
    transform: FriendsGalaxyTransform,
  ): void {
    this.settledDetail = detail;
    this.settledTransform = { ...transform };
    this.renderer?.setSettledView(detail, this.settledTransform);
  }

  applyActivityPatches(patches: FriendsGalaxyActivityScenePatchBatch): void {
    this.activityPatches = patches;
    this.renderer?.applyActivityPatches(patches);
  }

  metadata(nodeId: string): IdentityGraphAtlasNode | null {
    return this.presentation.node(nodeId);
  }

  avatarUrl(nodeId: string): string | null {
    return this.presentation.avatarUrl(nodeId);
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    return this.renderer?.pickNode(viewportX, viewportY) ?? null;
  }

  render(transform: FriendsGalaxyTransform, timeMs: number): void {
    this.renderer?.render(transform, timeMs);
  }

  metrics(): FriendsGalaxyRendererMetrics | null {
    return this.renderer?.metrics() ?? null;
  }

  hasActivePresentationTransition(): boolean {
    return this.renderer?.activeBackend?.hasActivePresentationTransition?.() ?? false;
  }

  pollHealth(): void {
    this.worker.poll();
    void this.renderer?.pollHealth();
  }

  simulateDeviceLoss(): void {
    this.renderer?.simulateDeviceLoss();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.latestPresentation = null;
    this.admittedSourceRevision = null;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Friends Galaxy product engine is disposed.");
    }
  }

  private receiveSource(response: FriendsGalaxyProductWorkerSourceResponse): void {
    this.presentation.replace(response.rendererScene.atlas);
    this.admittedSourceRevision = response.sourceRevision;
    if (this.renderer) {
      void this.renderer.replaceScene(response.rendererScene);
    } else {
      this.renderer = new FriendsGalaxyRendererHost({
        ...this.rendererOptions,
        scene: response.rendererScene,
        palette: this.palette,
        resolvePresentation: this.presentation.resolve,
      });
      this.replayRendererState(this.renderer);
      void this.renderer.activate(this.rendererId);
    }
    this.onSourceSceneReady?.(response);
  }

  private receivePresentation(
    response: FriendsGalaxyProductWorkerPresentationResponse,
  ): void {
    const request = this.latestPresentation;
    if (
      !request ||
      request.sourceRevision !== response.sourceRevision ||
      request.presentationRevision !== response.presentationRevision
    ) return;
    this.presentation.replace(response.atlas);
    const detail = friendsGalaxyViewDetailForScale(request.viewport.transform.scale);
    this.settledDetail = detail;
    this.settledTransform = { ...request.viewport.transform };
    this.renderer?.setSettledPresentation(
      response.atlas,
      detail,
      this.settledTransform,
    );
    this.onPresentationReady?.(response);
  }

  private receiveActivity(
    response: FriendsGalaxyProductWorkerActivityResponse,
  ): void {
    this.applyActivityPatches(response.scenePatches);
    this.onActivityReady?.(response);
  }

  private replayRendererState(renderer: FriendsGalaxyRendererHost): void {
    renderer.resize(this.width, this.height, this.pixelRatio);
    renderer.setAmbientMotionEnabled(this.ambientMotionEnabled);
    renderer.setCameraMotion(this.cameraMotion);
    renderer.setFieldStyle(this.fieldStyle);
    renderer.setInteraction(this.interaction);
    if (this.settledTransform) {
      renderer.setSettledView(this.settledDetail, this.settledTransform);
    }
    if (this.activityPatches) renderer.applyActivityPatches(this.activityPatches);
  }
}
