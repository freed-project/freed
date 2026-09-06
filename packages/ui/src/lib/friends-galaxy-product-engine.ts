import type { FriendsGalaxyActivityScenePatchBatch } from "./friends-galaxy-activity-patches.js";
import {
  writeFriendsGalaxyWebGpuViewProjection,
  type FriendsGalaxyCameraFrameState,
} from "./friends-galaxy-camera.js";
import { FriendsGalaxyNavigationController } from "./friends-galaxy-navigation.js";
import type { FriendsGalaxyRendererPalette } from "./friends-galaxy-palette.js";
import { FriendsGalaxyProductPresentationIndex } from "./friends-galaxy-product-presentation.js";
import {
  FriendsGalaxyProductWorkerClient,
  type FriendsGalaxyProductWorkerActivityInput,
  type FriendsGalaxyProductWorkerFailure,
  type FriendsGalaxyProductWorkerPort,
  type FriendsGalaxyProductWorkerPresentationInput,
  type FriendsGalaxyProductWorkerNormalizedSourceInput,
  type FriendsGalaxySqliteGraphQuery,
} from "./friends-galaxy-product-worker-client.js";
import type {
  FriendsGalaxyProductWorkerActivityResponse,
  FriendsGalaxyProductWorkerPresentationResponse,
  FriendsGalaxyProductWorkerSelection,
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
import {
  FriendsGalaxySceneIndex,
  type FriendsGalaxyInteraction,
} from "./friends-galaxy-scene-index.js";
import type {
  FriendsGalaxyTransform,
  FriendsGalaxyViewportInsets,
} from "./friends-galaxy-viewport.js";
import type { IdentityGraphAtlasNode } from "./identity-graph-atlas.js";
import { FriendsGalaxyAvatarImageAdmission } from "./friends-galaxy-avatar-image-admission.js";
import { cropDecodedGalaxyAvatar } from "./friends-galaxy-avatar-crop.js";
import type { SampleAvatarFocalPoint } from "@freed/shared";
import { selectFriendsGalaxyAvatars } from "./friends-galaxy-presentation.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";

function decodePublicAvatar(url: string, focal?: SampleAvatarFocalPoint): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    const timeout = setTimeout(() => { image.src = ""; reject(new Error("Avatar load timed out")); }, 10_000);
    image.onload = () => {
      clearTimeout(timeout);
      try { resolve(cropDecodedGalaxyAvatar(image, image.naturalWidth, image.naturalHeight, focal)); }
      catch (error) { reject(error); }
    };
    image.onerror = () => { clearTimeout(timeout); reject(new Error("Avatar load failed")); };
    image.src = url;
  });
}

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
  /** Demo-only exact reviewed URL allowlist. Real libraries use the platform cache resolver. */
  approvedDemoAvatarUrls?: ReadonlySet<string>;
  approvedDemoAvatarDeliveryUrls?: ReadonlyMap<string, string>;
  approvedDemoAvatarFocalPoints?: ReadonlyMap<string, SampleAvatarFocalPoint>;
  resolveAvatarUrl?: (sourceUrl: string) => string;
}

interface FriendsGalaxyPresentationRequestState {
  input: FriendsGalaxyProductWorkerPresentationInput;
  cameraMotion: boolean;
}

export class FriendsGalaxyProductEngine {
  private readonly avatarAdmission: FriendsGalaxyAvatarImageAdmission;
  private avatarScene: FriendsGalaxyRendererScene | null = null;
  private avatarAdmissionKey = "";
  private avatarBackend: FriendsGalaxyRendererBackend | null = null;
  private avatarGeneration = 0;
  private avatarPending = false;
  private avatarViewKey = "";
  private avatarViewScene: FriendsGalaxyRendererScene | null = null;
  private readonly approvedDemoAvatarUrls: ReadonlySet<string>;
  private readonly resolveAvatarUrl?: (sourceUrl: string) => string;
  private readonly presentation = new FriendsGalaxyProductPresentationIndex();
  private readonly sourceMetadataByNodeId = new Map<
    string,
    IdentityGraphAtlasNode
  >();
  private readonly worker: FriendsGalaxyProductWorkerClient;
  private readonly rendererOptions: Omit<
    FriendsGalaxyRendererHostOptions,
    "scene" | "palette" | "resolvePresentation"
  >;
  private readonly onSourceSceneReady: FriendsGalaxyProductEngineOptions["onSourceSceneReady"];
  private readonly onPresentationReady: FriendsGalaxyProductEngineOptions["onPresentationReady"];
  private readonly onActivityReady: FriendsGalaxyProductEngineOptions["onActivityReady"];
  private renderer: FriendsGalaxyRendererHost | null = null;
  private navigation: FriendsGalaxyNavigationController | null = null;
  private sceneIndex: FriendsGalaxySceneIndex | null = null;
  private readonly pickViewProjection = new Float32Array(16);
  private rendererId: FriendsGalaxyRendererId;
  private palette: FriendsGalaxyRendererPalette;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private viewportInsets: FriendsGalaxyViewportInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
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
  private latestPresentation: FriendsGalaxyPresentationRequestState | null = null;
  private pendingSourceResponse: FriendsGalaxyProductWorkerSourceResponse | null = null;
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
      approvedDemoAvatarUrls,
      approvedDemoAvatarDeliveryUrls,
      approvedDemoAvatarFocalPoints,
      resolveAvatarUrl,
      ...rendererOptions
    } = options;
    this.approvedDemoAvatarUrls = new Set(approvedDemoAvatarUrls ?? []);
    this.resolveAvatarUrl = resolveAvatarUrl;
    // The same exact URL allowlist controls requests. Crop metadata grants no admission.
    const focalPoints = new Map(approvedDemoAvatarFocalPoints ?? []);
    const deliveryUrls = new Map(approvedDemoAvatarDeliveryUrls ?? []);
    this.avatarAdmission = new FriendsGalaxyAvatarImageAdmission(
      (url) => decodePublicAvatar(deliveryUrls.get(url) ?? resolveAvatarUrl?.(url) ?? url, focalPoints.get(url)), 64, 3,
    );
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

  get rendererGeneration(): number {
    return this.renderer?.generation ?? 0;
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

  get presentationInFlight(): boolean {
    return this.worker.presentationInFlight;
  }

  get presentationQueued(): boolean {
    return this.worker.presentationQueued;
  }

  get activityInFlight(): boolean {
    return this.worker.activityInFlight;
  }

  get activityQueued(): boolean {
    return this.worker.activityQueued;
  }

  get requestedSourceRevision(): number | null {
    return this.worker.activeSourceRevision;
  }

  get presentationNodeCount(): number {
    return this.presentation.nodeCount;
  }

  get cameraTransform(): FriendsGalaxyTransform | null {
    return this.navigation ? { ...this.navigation.transform } : null;
  }

  get cameraFrame(): FriendsGalaxyCameraFrameState | null {
    return this.navigation?.frame ?? null;
  }

  get interactionState(): FriendsGalaxyInteraction {
    return { ...this.interaction };
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

  requestNormalizedSource(
    input: FriendsGalaxyProductWorkerNormalizedSourceInput,
    query: FriendsGalaxySqliteGraphQuery,
  ): number | null {
    this.assertActive();
    this.latestPresentation = null;
    this.pendingSourceResponse = null;
    this.activityPatches = null;
    return this.worker.requestNormalizedSource(input, query);
  }

  requestSettledPresentation(
    input: FriendsGalaxyProductWorkerPresentationInput,
  ): number | null {
    return this.requestPresentation(input, false);
  }

  private requestPresentation(
    input: FriendsGalaxyProductWorkerPresentationInput,
    cameraMotion: boolean,
  ): number | null {
    this.assertActive();
    const previousPresentation = this.latestPresentation;
    this.latestPresentation = {
      input: {
        ...input,
        viewport: {
          ...input.viewport,
          transform: { ...input.viewport.transform },
        },
      },
      cameraMotion,
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

  requestCameraPresentation(
    presentationRevision: number,
    selection: FriendsGalaxyProductWorkerSelection = {},
  ): number | null {
    this.assertActive();
    const navigation = this.navigation;
    const sourceRevision = this.worker.activeSourceRevision;
    if (!navigation || sourceRevision === null) return null;
    return this.requestPresentation({
      kind: "presentation",
      sourceRevision,
      presentationRevision,
      viewport: {
        width: this.width,
        height: this.height,
        transform: { ...navigation.transform },
        ...selection,
        hoveredNodeId: this.interaction.hoveredNodeId,
      },
    }, this.cameraMotion);
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
    this.navigation?.resize(this.width, this.height, this.viewportInsets);
    this.renderer?.resize(this.width, this.height, this.pixelRatio);
  }

  setViewportInsets(insets: FriendsGalaxyViewportInsets): void {
    this.viewportInsets = { ...insets };
    this.navigation?.resize(this.width, this.height, this.viewportInsets);
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
    if (!active && this.pendingSourceResponse) {
      const response = this.pendingSourceResponse;
      this.pendingSourceResponse = null;
      this.admitSource(response);
    }
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

  fitAll(initial = false): boolean {
    const navigation = this.navigation;
    if (!navigation) return false;
    navigation.fit(initial);
    return true;
  }

  fittedCameraTransform(initial = false): FriendsGalaxyTransform | null {
    return this.navigation?.fittedTransform(initial) ?? null;
  }

  setCameraTransform(transform: FriendsGalaxyTransform): boolean {
    return this.navigation?.setTransform(transform) ?? false;
  }

  focusNode(nodeId: string, minimumScale = 0.92): boolean {
    return this.navigation?.focusNode(nodeId, minimumScale) ?? false;
  }

  panCameraBy(deltaX: number, deltaY: number): boolean {
    return this.navigation?.panBy(deltaX, deltaY) ?? false;
  }

  zoomCameraAt(
    viewportX: number,
    viewportY: number,
    scaleRatio: number,
  ): boolean {
    return this.navigation?.zoomAt(viewportX, viewportY, scaleRatio) ?? false;
  }

  zoomCameraBetween(
    previousViewportX: number,
    previousViewportY: number,
    nextViewportX: number,
    nextViewportY: number,
    scaleRatio: number,
  ): boolean {
    return this.navigation?.zoomBetween(
      previousViewportX,
      previousViewportY,
      nextViewportX,
      nextViewportY,
      scaleRatio,
    ) ?? false;
  }

  pinchCamera(
    previousFirstX: number,
    previousFirstY: number,
    previousSecondX: number,
    previousSecondY: number,
    nextFirstX: number,
    nextFirstY: number,
    nextSecondX: number,
    nextSecondY: number,
  ): boolean {
    return this.navigation?.pinch(
      previousFirstX,
      previousFirstY,
      previousSecondX,
      previousSecondY,
      nextFirstX,
      nextFirstY,
      nextSecondX,
      nextSecondY,
    ) ?? false;
  }

  settleCamera(): FriendsGalaxyViewDetail | null {
    const transform = this.cameraTransform;
    if (!transform) return null;
    const detail = friendsGalaxyViewDetailForScale(transform.scale);
    this.setSettledView(detail, transform);
    return detail;
  }

  applyActivityPatches(patches: FriendsGalaxyActivityScenePatchBatch): void {
    this.activityPatches = patches;
    this.renderer?.applyActivityPatches(patches);
  }

  metadata(nodeId: string): IdentityGraphAtlasNode | null {
    return this.sourceMetadataByNodeId.get(nodeId) ?? null;
  }

  avatarUrl(nodeId: string): string | null {
    return this.presentation.avatarUrl(nodeId);
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    const navigation = this.navigation;
    const sceneIndex = this.sceneIndex;
    if (!navigation || !sceneIndex) return null;
    writeFriendsGalaxyWebGpuViewProjection(
      this.pickViewProjection,
      navigation.transform,
      this.width,
      this.height,
    );
    return sceneIndex.pickNode(
      this.pickViewProjection,
      this.width,
      this.height,
      viewportX,
      viewportY,
      "zero-to-one",
    );
  }

  render(transform: FriendsGalaxyTransform, timeMs: number): void {
    this.admitVisibleAvatars(transform);
    this.renderer?.render(transform, timeMs);
  }

  renderCamera(timeMs: number): void {
    const navigation = this.navigation;
    if (navigation) this.render(navigation.transform, timeMs);
  }

  metrics(): FriendsGalaxyRendererMetrics | null {
    return this.renderer?.metrics() ?? null;
  }

  hasActivePresentationTransition(): boolean {
    return this.avatarPending || (this.renderer?.activeBackend?.hasActivePresentationTransition?.() ?? false);
  }

  pollHealth(): void {
    this.worker.poll();
    void this.renderer?.pollHealth();
  }

  recoverActiveRenderer(reason: string): void {
    const renderer = this.renderer;
    const backend = renderer?.activeBackend;
    if (!renderer || !backend) return;
    void renderer.recoverFromFatalError(backend, reason);
  }

  simulateDeviceLoss(): void {
    this.renderer?.simulateDeviceLoss();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.avatarGeneration += 1;
    this.avatarAdmission.dispose();
    this.worker.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.navigation = null;
    this.sceneIndex = null;
    this.latestPresentation = null;
    this.pendingSourceResponse = null;
    this.admittedSourceRevision = null;
    this.sourceMetadataByNodeId.clear();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Friends Galaxy product engine is disposed.");
    }
  }

  private receiveSource(response: FriendsGalaxyProductWorkerSourceResponse): void {
    if (this.cameraMotion && this.admittedSourceRevision !== null) {
      this.pendingSourceResponse = response;
      return;
    }
    this.admitSource(response);
  }

  private admitSource(response: FriendsGalaxyProductWorkerSourceResponse): void {
    this.avatarScene = response.rendererScene;
    this.avatarAdmissionKey = "";
    this.avatarGeneration += 1;
    this.avatarPending = false;
    this.sourceMetadataByNodeId.clear();
    for (const node of response.rendererScene.atlas.nodes) {
      this.sourceMetadataByNodeId.set(node.id, node);
    }
    this.presentation.replace(response.rendererScene.atlas);
    this.admittedSourceRevision = response.sourceRevision;
    this.sceneIndex = new FriendsGalaxySceneIndex(
      response.rendererScene.scene,
      response.rendererScene.interactionIndex,
    );
    if (this.navigation) this.navigation.replaceScene(response.rendererScene);
    else {
      this.navigation = new FriendsGalaxyNavigationController(
        response.rendererScene,
        this.width,
        this.height,
        this.viewportInsets,
      );
    }
    if (!this.settledTransform && this.navigation) {
      this.settledTransform = { ...this.navigation.transform };
      this.settledDetail = friendsGalaxyViewDetailForScale(
        this.navigation.transform.scale,
      );
    }
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
    const requestState = this.latestPresentation;
    const request = requestState?.input;
    if (
      !request ||
      request.sourceRevision !== response.sourceRevision ||
      request.presentationRevision !== response.presentationRevision
    ) return;
    this.presentation.replace(response.atlas);
    if (this.avatarScene) this.avatarScene = { ...this.avatarScene, atlas: response.atlas };
    const detail = friendsGalaxyViewDetailForScale(request.viewport.transform.scale);
    if (requestState.cameraMotion || this.cameraMotion) {
      this.renderer?.setPresentationAtlas(response.atlas);
    } else {
      this.settledDetail = detail;
      this.settledTransform = { ...request.viewport.transform };
      this.renderer?.setSettledPresentation(
        response.atlas,
        detail,
        this.settledTransform,
      );
    }
    this.onPresentationReady?.(response);
  }

  private admitVisibleAvatars(transform: FriendsGalaxyTransform): void {
    const backend = this.renderer?.activeBackend;
    const scene = this.avatarScene;
    if (this.avatarPending && backend !== this.avatarBackend) {
      this.avatarGeneration += 1;
      this.avatarPending = false;
    }
    if ((!this.resolveAvatarUrl && this.approvedDemoAvatarUrls.size === 0) || this.disposed || !backend?.setAvatarImages || !scene) return;
    const viewKey = `${transform.x}:${transform.y}:${transform.scale}:${this.width}:${this.height}:${this.interaction.selectedNodeId}`;
    if (this.avatarAdmissionKey && backend === this.avatarBackend && scene === this.avatarViewScene && viewKey === this.avatarViewKey) return;
    this.avatarViewKey = viewKey;
    this.avatarViewScene = scene;
    const detail = friendsGalaxyViewDetailForScale(transform.scale);
    // Retain outgoing avatars until their time-based fade has completed.
    if (detail !== "close") return;
    writeFriendsGalaxyWebGpuViewProjection(this.pickViewProjection, transform, this.width, this.height);
    const avatars = selectFriendsGalaxyAvatars(scene, this.palette, this.presentation.resolve,
      this.interaction.selectedNodeId, this.width < 720, detail,
      { viewProjection: this.pickViewProjection, width: this.width, height: this.height });
    const requests = avatars.flatMap(({ nodeId }) => {
      const node = this.presentation.node(nodeId);
      // Identity candidates are populated exclusively from linked social accounts.
      const sourceKeys = (node?.avatarUrlCandidates ?? []).filter((url) => (this.resolveAvatarUrl || this.approvedDemoAvatarUrls.has(url)) && /^https:\/\//i.test(url));
      return sourceKeys.length ? [{ nodeId, sourceKey: sourceKeys[0]!, sourceKeys }] : [];
    });
    const key = JSON.stringify(requests);
    if (backend === this.avatarBackend && key === this.avatarAdmissionKey) return;
    if (backend !== this.avatarBackend) backend.setAvatarImages(new Map(), true);
    this.avatarBackend = backend;
    this.avatarAdmissionKey = key;
    const generation = ++this.avatarGeneration;
    this.avatarPending = true;
    void this.avatarAdmission.admit(requests).then(({ images }) => {
      if (this.disposed || generation !== this.avatarGeneration || backend !== this.renderer?.activeBackend) return;
      this.avatarPending = false;
      // Image readiness must not depend on the user ending a zoom gesture.
      backend.setAvatarImages?.(images, true);
    }).catch(() => {
      if (generation === this.avatarGeneration) this.avatarPending = false;
    });
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
