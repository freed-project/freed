import { friendsGalaxyFrameStats, type FriendsGalaxyFrameStats } from "./friends-galaxy-diagnostics.js";
import { shouldContinueFriendsGalaxyFrame } from "./friends-galaxy-frame-loop.js";
import {
  friendsGalaxyGestureScaleRatio,
  friendsGalaxyWheelDeltaPixels,
  friendsGalaxyWheelScaleRatio,
} from "./friends-galaxy-gesture.js";
import {
  friendsGalaxyContextTarget,
  friendsGalaxyKeyboardCommand,
  FriendsGalaxyLongPressTracker,
  type FriendsGalaxyContextRequestSource,
  type FriendsGalaxyContextTarget,
} from "./friends-galaxy-interaction.js";
import {
  FriendsGalaxyInertialPan,
  FriendsGalaxyInertialZoom,
} from "./friends-galaxy-inertia.js";
import {
  FriendsGalaxyLongTaskMonitor,
  type FriendsGalaxyLongTaskSnapshot,
} from "./friends-galaxy-long-tasks.js";
import { FriendsGalaxyPointerRoster } from "./friends-galaxy-pointer-roster.js";
import type { FriendsGalaxyProductEngine } from "./friends-galaxy-product-engine.js";
import type { FriendsGalaxyProductWorkerSelection } from "./friends-galaxy-product-worker-protocol.js";
import {
  friendsGalaxyRenderPixelRatio,
  type FriendsGalaxyRendererMetrics,
} from "./friends-galaxy-renderer.js";
import { FriendsGalaxySampleRing } from "./friends-galaxy-samples.js";
import { FriendsGalaxySettleScheduler } from "./friends-galaxy-settle.js";
import {
  friendsGalaxyViewportGeometry,
  writeFriendsGalaxyCanvasPoint,
  type FriendsGalaxyCanvasPoint,
  type FriendsGalaxyTransform,
  type FriendsGalaxyViewportGeometry,
} from "./friends-galaxy-viewport.js";

const TRACKPAD_ZOOM_RELEASE_DELAY_MS = 72;
const TRACKPAD_ZOOM_MAX_RELEASE_LATENCY_MS = 120;
const INERTIAL_ZOOM_STALL_LOG_DELTA = 0.000002;
const SETTLE_DELAY_MS = 140;
const MOTION_PRESENTATION_INTERVAL_MS = 72;

interface SafariGestureEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

export interface FriendsGalaxyInputControllerOptions {
  viewport: HTMLElement;
  canvasHost: HTMLElement;
  engine: FriendsGalaxyProductEngine;
  onSelection(nodeId: string | null): void;
  onContext(target: FriendsGalaxyContextTarget | null): void;
  onDetails(nodeId: string): void;
  onStateChange?(): void;
  onPresentationVisibilityChange?(visible: boolean): void;
  devicePixelRatio?(): number;
  now?(): number;
}

export interface FriendsGalaxyInputControllerSnapshot {
  transform: FriendsGalaxyTransform | null;
  viewportGeometry: FriendsGalaxyViewportGeometry;
  cameraInMotion: boolean;
  presentationVisible: boolean;
  frameLoop: "active" | "idle";
  settlePending: boolean;
  renderResizePending: boolean;
  touchInputMode: "Native Touch Events" | "Pointer Events";
  wheelInputMode: "Ready" | "pinch-zoom" | "two-finger-pan";
  inertialPanActive: boolean;
  inertialZoomActive: boolean;
  inertialZoomPending: boolean;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  frame: FriendsGalaxyFrameStats;
  submit: FriendsGalaxyFrameStats;
  longTasks: FriendsGalaxyLongTaskSnapshot;
  renderer: FriendsGalaxyRendererMetrics | null;
}

function isGestureUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'button, input, select, textarea, [role="menu"], [data-graph-gesture-ignore="true"]',
  ));
}

function finitePixelRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function eventTime(event: Event, fallback: number): number {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : fallback;
}

function workerSelectionForNode(
  nodeId: string | null,
): FriendsGalaxyProductWorkerSelection {
  if (nodeId?.startsWith("person:")) {
    return { selectedPersonId: nodeId.slice("person:".length) };
  }
  if (nodeId?.startsWith("account:")) {
    return { selectedAccountId: nodeId.slice("account:".length) };
  }
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FriendsGalaxyInputController {
  private readonly viewport: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly engine: FriendsGalaxyProductEngine;
  private readonly onSelection: FriendsGalaxyInputControllerOptions["onSelection"];
  private readonly onContext: FriendsGalaxyInputControllerOptions["onContext"];
  private readonly onDetails: FriendsGalaxyInputControllerOptions["onDetails"];
  private readonly onStateChange: FriendsGalaxyInputControllerOptions["onStateChange"];
  private readonly onPresentationVisibilityChange:
    FriendsGalaxyInputControllerOptions["onPresentationVisibilityChange"];
  private readonly devicePixelRatio: () => number;
  private readonly now: () => number;
  private readonly pointers = new FriendsGalaxyPointerRoster(2);
  private readonly inertialPan = new FriendsGalaxyInertialPan();
  private readonly inertialZoom = new FriendsGalaxyInertialZoom();
  private readonly settleScheduler = new FriendsGalaxySettleScheduler();
  private readonly longPress = new FriendsGalaxyLongPressTracker();
  private readonly frameSamples = new FriendsGalaxySampleRing(180);
  private readonly submitSamples = new FriendsGalaxySampleRing(180);
  private readonly longTasks = new FriendsGalaxyLongTaskMonitor();
  private readonly canvasPointValue: FriendsGalaxyCanvasPoint = { x: 0, y: 0 };
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly resizeObserver: ResizeObserver;
  private geometryValue: FriendsGalaxyViewportGeometry;
  private nativeTouchInput: boolean;
  private presentationVisible = true;
  private dirty = true;
  private frameRequest = 0;
  private hoverRequest = 0;
  private longPressTimeout = 0;
  private lastFrameAt = 0;
  private cameraInMotion = false;
  private renderResizePending = true;
  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  private workerSelection: FriendsGalaxyProductWorkerSelection = {};
  private presentationRevision = 0;
  private nextMotionPresentationAt = 0;
  private gestureMoved = false;
  private gestureInterruptedInertia = false;
  private pendingHover = false;
  private pendingHoverX = 0;
  private pendingHoverY = 0;
  private inertialZoomFocalX = 0;
  private inertialZoomFocalY = 0;
  private wheelZoomReleaseAt = 0;
  private wheelInputMode: FriendsGalaxyInputControllerSnapshot["wheelInputMode"] = "Ready";
  private safariGestureActive = false;
  private safariGesturePreviousScale = 1;
  private safariGesturePreviousX = 0;
  private safariGesturePreviousY = 0;
  private disposed = false;

  constructor(options: FriendsGalaxyInputControllerOptions) {
    this.viewport = options.viewport;
    this.canvasHost = options.canvasHost;
    this.engine = options.engine;
    this.onSelection = options.onSelection;
    this.onContext = options.onContext;
    this.onDetails = options.onDetails;
    this.onStateChange = options.onStateChange;
    this.onPresentationVisibilityChange = options.onPresentationVisibilityChange;
    this.devicePixelRatio = options.devicePixelRatio ?? (() => window.devicePixelRatio || 1);
    this.now = options.now ?? (() => performance.now());
    this.nativeTouchInput = navigator.maxTouchPoints > 0 && "ontouchstart" in window;
    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.geometryValue = friendsGalaxyViewportGeometry(
      this.canvasHost.getBoundingClientRect(),
      this.viewport.getBoundingClientRect(),
    );
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.install();
  }

  get geometry(): FriendsGalaxyViewportGeometry {
    return this.geometryValue;
  }

  get transform(): FriendsGalaxyTransform | null {
    return this.engine.cameraTransform;
  }

  get isPresentationVisible(): boolean {
    return this.presentationVisible;
  }

  sourceReady(): void {
    if (this.disposed) return;
    this.refreshGeometry();
    this.settleNow();
    this.markDirty();
  }

  setSelection(
    nodeId: string | null,
    workerSelection: FriendsGalaxyProductWorkerSelection,
  ): void {
    const changed = nodeId !== this.selectedNodeId;
    this.selectedNodeId = nodeId;
    this.workerSelection = { ...workerSelection };
    if (changed && this.hoveredNodeId === nodeId) this.hoveredNodeId = null;
    this.applyInteraction();
    if (changed && this.engine.sourceReady) this.settleNow();
    else this.markDirty();
  }

  fitAll(): void {
    this.cancelCameraInertia();
    if (!this.engine.fitAll(false)) return;
    this.settleNow();
    this.markDirty();
  }

  focusNode(nodeId: string): boolean {
    this.cancelCameraInertia();
    const focused = this.engine.focusNode(nodeId);
    if (!focused) return false;
    this.settleNow();
    this.markDirty();
    return true;
  }

  setPresentationVisible(visible: boolean): void {
    if (visible === this.presentationVisible) return;
    this.presentationVisible = visible;
    this.viewport.dataset.presentationVisible = String(visible);
    this.canvasHost.dataset.presentationVisible = String(visible);
    this.onPresentationVisibilityChange?.(visible);
    if (!visible) {
      this.viewport.inert = true;
      this.viewport.setAttribute("aria-hidden", "true");
      if (document.activeElement === this.viewport) this.viewport.blur();
      this.suspendTransientWork();
      return;
    }
    this.viewport.inert = false;
    this.viewport.removeAttribute("aria-hidden");
    this.refreshGeometry();
    this.renderResizePending = true;
    this.settleNow();
    this.markDirty();
  }

  wake(): void {
    if (this.disposed) return;
    this.dirty = true;
    this.notifyStateChange();
    this.requestFrame();
  }

  snapshot(): FriendsGalaxyInputControllerSnapshot {
    return {
      transform: this.engine.cameraTransform,
      viewportGeometry: {
        ...this.geometryValue,
        insets: { ...this.geometryValue.insets },
      },
      cameraInMotion: this.cameraInMotion,
      presentationVisible: this.presentationVisible,
      frameLoop: this.frameRequest === 0 ? "idle" : "active",
      settlePending: this.settleScheduler.isPending,
      renderResizePending: this.renderResizePending,
      touchInputMode: this.nativeTouchInput ? "Native Touch Events" : "Pointer Events",
      wheelInputMode: this.wheelInputMode,
      inertialPanActive: this.inertialPan.isActive,
      inertialZoomActive: this.inertialZoom.isActive,
      inertialZoomPending: this.wheelZoomReleaseAt > 0,
      selectedNodeId: this.selectedNodeId,
      hoveredNodeId: this.hoveredNodeId,
      frame: friendsGalaxyFrameStats(this.frameSamples.snapshot()),
      submit: friendsGalaxyFrameStats(this.submitSamples.snapshot()),
      longTasks: this.longTasks.snapshot(),
      renderer: this.engine.metrics(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFrameLoop();
    if (this.hoverRequest > 0) cancelAnimationFrame(this.hoverRequest);
    this.hoverRequest = 0;
    this.clearLongPress();
    this.resizeObserver.disconnect();
    this.reducedMotionQuery.removeEventListener("change", this.handleReducedMotionChange);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.removeEventListeners();
    this.cancelCameraInertia();
    this.settleScheduler.cancel();
    this.longTasks.dispose();
  }

  private install(): void {
    this.viewport.style.touchAction = "none";
    this.viewport.style.overscrollBehavior = "contain";
    this.viewport.dataset.touchInputMode = this.nativeTouchInput
      ? "native-touch-events"
      : "pointer-events";
    this.viewport.dataset.presentationVisible = "true";
    this.viewport.dataset.frameLoop = "idle";
    this.viewport.dataset.inertialPan = "false";
    this.viewport.dataset.inertialZoom = "false";
    this.viewport.dataset.wheelInputMode = "ready";
    this.addEventListeners();
    this.resizeObserver.observe(this.canvasHost);
    this.resizeObserver.observe(this.viewport);
    this.reducedMotionQuery.addEventListener("change", this.handleReducedMotionChange);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.engine.setAmbientMotionEnabled(!this.reducedMotionQuery.matches);
    this.refreshGeometry();
    this.requestFrame();
  }

  private addEventListeners(): void {
    this.viewport.addEventListener("pointerdown", this.handlePointerDown);
    this.viewport.addEventListener("pointermove", this.handlePointerMove);
    this.viewport.addEventListener("pointerup", this.handlePointerRelease);
    this.viewport.addEventListener("pointercancel", this.handlePointerRelease);
    this.viewport.addEventListener("pointerleave", this.handlePointerLeave);
    this.viewport.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    this.viewport.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    this.viewport.addEventListener("touchend", this.handleTouchEnd, { passive: false });
    this.viewport.addEventListener("touchcancel", this.handleTouchCancel, { passive: false });
    this.viewport.addEventListener("wheel", this.handleWheel, { passive: false });
    this.viewport.addEventListener("contextmenu", this.handleContextMenu);
    this.viewport.addEventListener("gesturestart", this.handleGestureStart as EventListener, { passive: false });
    this.viewport.addEventListener("gesturechange", this.handleGestureChange as EventListener, { passive: false });
    this.viewport.addEventListener("gestureend", this.handleGestureEnd as EventListener, { passive: false });
    this.viewport.addEventListener("keydown", this.handleKeyDown);
    this.viewport.addEventListener("dblclick", this.handleDoubleClick);
  }

  private removeEventListeners(): void {
    this.viewport.removeEventListener("pointerdown", this.handlePointerDown);
    this.viewport.removeEventListener("pointermove", this.handlePointerMove);
    this.viewport.removeEventListener("pointerup", this.handlePointerRelease);
    this.viewport.removeEventListener("pointercancel", this.handlePointerRelease);
    this.viewport.removeEventListener("pointerleave", this.handlePointerLeave);
    this.viewport.removeEventListener("touchstart", this.handleTouchStart);
    this.viewport.removeEventListener("touchmove", this.handleTouchMove);
    this.viewport.removeEventListener("touchend", this.handleTouchEnd);
    this.viewport.removeEventListener("touchcancel", this.handleTouchCancel);
    this.viewport.removeEventListener("wheel", this.handleWheel);
    this.viewport.removeEventListener("contextmenu", this.handleContextMenu);
    this.viewport.removeEventListener("gesturestart", this.handleGestureStart as EventListener);
    this.viewport.removeEventListener("gesturechange", this.handleGestureChange as EventListener);
    this.viewport.removeEventListener("gestureend", this.handleGestureEnd as EventListener);
    this.viewport.removeEventListener("keydown", this.handleKeyDown);
    this.viewport.removeEventListener("dblclick", this.handleDoubleClick);
  }

  private canPresent(): boolean {
    return this.presentationVisible && document.visibilityState === "visible";
  }

  private refreshGeometry(): void {
    const next = friendsGalaxyViewportGeometry(
      this.canvasHost.getBoundingClientRect(),
      this.viewport.getBoundingClientRect(),
    );
    this.geometryValue = next;
    this.engine.setViewportInsets(next.insets);
    this.resizeEngine();
    this.notifyStateChange();
  }

  private resizeEngine(): void {
    const width = this.geometryValue.canvasWidth;
    this.engine.resize(
      width,
      this.geometryValue.canvasHeight,
      friendsGalaxyRenderPixelRatio(
        finitePixelRatio(this.devicePixelRatio()),
        width,
        this.cameraInMotion,
      ),
    );
    this.renderResizePending = false;
  }

  private setCameraInMotion(active: boolean): void {
    if (active === this.cameraInMotion) return;
    this.cameraInMotion = active;
    this.nextMotionPresentationAt = 0;
    this.engine.setCameraMotion(active);
    this.renderResizePending = true;
    this.notifyStateChange();
  }

  private canvasPoint(clientX: number, clientY: number): FriendsGalaxyCanvasPoint {
    return writeFriendsGalaxyCanvasPoint(
      this.canvasPointValue,
      this.geometryValue,
      clientX,
      clientY,
    );
  }

  private applyInteraction(): void {
    this.engine.setInteraction({
      selectedNodeId: this.selectedNodeId,
      hoveredNodeId: this.hoveredNodeId,
    });
    this.markDirty();
  }

  private select(nodeId: string | null): void {
    const changed = nodeId !== this.selectedNodeId;
    this.selectedNodeId = nodeId;
    this.workerSelection = workerSelectionForNode(nodeId);
    this.hoveredNodeId = null;
    this.applyInteraction();
    if (changed) {
      this.onSelection(nodeId);
      this.settleNow();
    }
  }

  private requestContextAt(
    canvasX: number,
    canvasY: number,
    source: FriendsGalaxyContextRequestSource,
  ): boolean {
    const nodeId = this.engine.pickNode(canvasX, canvasY);
    this.viewport.dataset.lastContextSource = source;
    this.viewport.dataset.lastContextX = canvasX.toFixed(2);
    this.viewport.dataset.lastContextY = canvasY.toFixed(2);
    this.viewport.dataset.lastContextNodeId = nodeId ?? "";
    const transform = this.engine.cameraTransform;
    if (!nodeId || !transform) {
      this.onContext(null);
      return false;
    }
    const target = friendsGalaxyContextTarget(
      nodeId,
      source,
      canvasX,
      canvasY,
      transform,
      this.geometryValue,
    );
    this.onContext(target);
    return target !== null;
  }

  private scheduleHover(canvasX: number, canvasY: number): void {
    this.pendingHoverX = canvasX;
    this.pendingHoverY = canvasY;
    this.pendingHover = true;
    if (this.hoverRequest !== 0) return;
    this.hoverRequest = requestAnimationFrame(() => {
      this.hoverRequest = 0;
      if (!this.pendingHover) return;
      this.pendingHover = false;
      if (
        this.pointers.count > 0 || this.inertialPan.isActive ||
        this.inertialZoom.isActive || this.wheelZoomReleaseAt > 0
      ) return;
      const hoveredNodeId = this.engine.pickNode(
        this.pendingHoverX,
        this.pendingHoverY,
      );
      if (hoveredNodeId === this.hoveredNodeId) return;
      this.hoveredNodeId = hoveredNodeId;
      this.applyInteraction();
    });
  }

  private beginLongPress(pointerId: number, x: number, y: number): void {
    this.clearLongPress();
    this.longPress.begin(pointerId, x, y, this.now());
    this.longPressTimeout = window.setTimeout(() => {
      this.longPressTimeout = 0;
      const activation = this.longPress.activate(this.now());
      if (!activation) return;
      this.gestureMoved = true;
      this.requestContextAt(activation.x, activation.y, "long-press");
    }, this.longPress.durationMs);
  }

  private moveLongPress(pointerId: number, x: number, y: number): boolean {
    if (!this.longPress.isTracking(pointerId)) return false;
    if (this.longPress.isActivated) return true;
    if (!this.longPress.isPending) return false;
    if (this.longPress.move(pointerId, x, y)) return true;
    this.clearLongPressTimeout();
    return false;
  }

  private releaseLongPress(pointerId: number): void {
    this.longPress.release(pointerId);
    if (!this.longPress.isPending) this.clearLongPressTimeout();
  }

  private clearLongPressTimeout(): void {
    if (this.longPressTimeout === 0) return;
    window.clearTimeout(this.longPressTimeout);
    this.longPressTimeout = 0;
  }

  private clearLongPress(): void {
    this.clearLongPressTimeout();
    this.longPress.cancel();
  }

  private beginPanSample(timeMs: number): boolean {
    const interrupted = this.cancelCameraInertia();
    this.inertialPan.begin(timeMs);
    this.viewport.dataset.inertialPan = "false";
    return interrupted;
  }

  private startPanInertia(releaseTimeMs: number): boolean {
    this.inertialZoom.cancel();
    this.wheelZoomReleaseAt = 0;
    const started = this.inertialPan.start(
      releaseTimeMs,
      this.now(),
      this.reducedMotionQuery.matches,
    );
    this.viewport.dataset.inertialPan = String(started);
    if (!started) return false;
    this.settleScheduler.cancel();
    this.setCameraInMotion(true);
    this.markDirty();
    return true;
  }

  private beginZoomSample(timeMs: number, x: number, y: number): void {
    this.cancelCameraInertia();
    this.inertialZoom.begin(timeMs);
    this.inertialZoomFocalX = x;
    this.inertialZoomFocalY = y;
  }

  private sampleZoom(scaleRatio: number, timeMs: number, x: number, y: number): void {
    this.inertialZoom.sample(scaleRatio, timeMs);
    this.inertialZoomFocalX = x;
    this.inertialZoomFocalY = y;
  }

  private startZoomInertia(releaseTimeMs: number, frameTimeMs: number): boolean {
    this.wheelZoomReleaseAt = 0;
    const started = this.inertialZoom.start(
      releaseTimeMs,
      frameTimeMs,
      this.reducedMotionQuery.matches,
    );
    this.viewport.dataset.inertialZoom = String(started);
    if (!started) return false;
    this.settleScheduler.cancel();
    this.setCameraInMotion(true);
    this.markDirty();
    return true;
  }

  private cancelCameraInertia(): boolean {
    const active = this.inertialPan.isActive || this.inertialZoom.isActive ||
      this.wheelZoomReleaseAt > 0;
    this.inertialPan.cancel();
    this.inertialZoom.cancel();
    this.wheelZoomReleaseAt = 0;
    this.viewport.dataset.inertialPan = "false";
    this.viewport.dataset.inertialZoom = "false";
    return active;
  }

  private scheduleSettle(): void {
    if (!this.canPresent()) {
      this.settleScheduler.cancel();
      return;
    }
    this.settleScheduler.schedule(
      this.presentationRevision + 1,
      this.now(),
      SETTLE_DELAY_MS,
    );
    this.requestFrame();
  }

  private settleNow(): void {
    if (!this.canPresent() || !this.engine.sourceReady) return;
    this.settleScheduler.cancel();
    this.setCameraInMotion(false);
    if (this.renderResizePending) this.resizeEngine();
    this.engine.settleCamera();
    this.presentationRevision += 1;
    this.engine.requestCameraPresentation(
      this.presentationRevision,
      this.workerSelection,
    );
    this.markDirty();
  }

  private requestMotionPresentation(timeMs: number): void {
    if (
      !this.cameraInMotion ||
      !this.engine.sourceReady ||
      timeMs < this.nextMotionPresentationAt
    ) return;
    this.presentationRevision += 1;
    const requestId = this.engine.requestCameraPresentation(
      this.presentationRevision,
      this.workerSelection,
    );
    this.nextMotionPresentationAt = timeMs +
      (requestId === null ? 16 : MOTION_PRESENTATION_INTERVAL_MS);
  }

  private markDirty(): void {
    this.dirty = true;
    this.notifyStateChange();
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.canPresent() || this.frameRequest !== 0 || this.disposed) return;
    this.frameRequest = requestAnimationFrame(this.renderFrame);
    this.viewport.dataset.frameLoop = "active";
  }

  private stopFrameLoop(): void {
    if (this.frameRequest > 0) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.lastFrameAt = 0;
    this.viewport.dataset.frameLoop = "idle";
  }

  private notifyStateChange(): void {
    try {
      this.onStateChange?.();
    } catch {
      // Diagnostics cannot interrupt input or rendering.
    }
  }

  private renderFrame = (timeMs: number): void => {
    this.frameRequest = -1;
    if (!this.canPresent()) {
      this.frameRequest = 0;
      this.lastFrameAt = 0;
      this.viewport.dataset.frameLoop = "idle";
      return;
    }

    if (this.wheelZoomReleaseAt > 0 && timeMs >= this.wheelZoomReleaseAt) {
      const releaseAt = this.wheelZoomReleaseAt;
      if (
        timeMs - releaseAt > TRACKPAD_ZOOM_MAX_RELEASE_LATENCY_MS ||
        !this.startZoomInertia(releaseAt, timeMs)
      ) {
        this.inertialZoom.cancel();
        this.wheelZoomReleaseAt = 0;
        this.scheduleSettle();
      }
    }

    const panStep = this.inertialPan.step(timeMs);
    if (panStep.deltaX !== 0 || panStep.deltaY !== 0) {
      this.engine.panCameraBy(panStep.deltaX, panStep.deltaY);
      this.dirty = true;
    }
    if (panStep.finished) {
      this.viewport.dataset.inertialPan = "false";
      this.scheduleSettle();
    }

    const zoomStep = this.inertialZoom.step(timeMs);
    let zoomStalled = false;
    if (zoomStep.scaleRatio !== 1) {
      const previousScale = this.engine.cameraTransform?.scale ?? 0;
      this.engine.zoomCameraAt(
        this.inertialZoomFocalX,
        this.inertialZoomFocalY,
        zoomStep.scaleRatio,
      );
      const nextScale = this.engine.cameraTransform?.scale ?? previousScale;
      if (
        previousScale > 0 &&
        Math.abs(Math.log(nextScale / previousScale)) <= INERTIAL_ZOOM_STALL_LOG_DELTA
      ) {
        this.inertialZoom.cancel();
        zoomStalled = true;
      } else {
        this.dirty = true;
      }
    }
    if (zoomStep.finished || zoomStalled) {
      this.viewport.dataset.inertialZoom = "false";
      this.scheduleSettle();
    }

    const settledGeneration = this.settleScheduler.takeDue(timeMs);
    if (settledGeneration !== null) this.settleNow();
    if (this.renderResizePending) this.resizeEngine();
    if (this.dirty) this.requestMotionPresentation(timeMs);
    this.engine.pollHealth();

    const metrics = this.engine.metrics();
    const ambientMotion = metrics?.ambientMotionEnabled === true;
    const transition = this.engine.hasActivePresentationTransition();
    const renderable = Boolean(
      this.engine.activeRenderer && !this.engine.recoveryPending &&
      !this.engine.terminalRendererFailure,
    );
    if (renderable && (ambientMotion || this.dirty || transition)) {
      if (this.lastFrameAt > 0 && ambientMotion) {
        this.frameSamples.push(timeMs - this.lastFrameAt);
      }
      this.lastFrameAt = timeMs;
      const submitStartedAt = this.now();
      try {
        this.engine.renderCamera(timeMs);
        this.submitSamples.push(this.now() - submitStartedAt);
      } catch (error) {
        this.engine.recoverActiveRenderer(errorMessage(error));
      }
      this.dirty = false;
    } else {
      this.lastFrameAt = 0;
    }

    this.notifyStateChange();
    this.frameRequest = 0;
    if (shouldContinueFriendsGalaxyFrame(
      renderable && ambientMotion,
      renderable && this.dirty,
      this.settleScheduler.isPending || this.inertialPan.isActive ||
        this.inertialZoom.isActive || this.wheelZoomReleaseAt > 0 || transition,
      this.canPresent(),
    )) {
      this.requestFrame();
    } else {
      this.viewport.dataset.frameLoop = "idle";
    }
  };

  private suspendTransientWork(): void {
    this.settleScheduler.cancel();
    this.clearLongPress();
    this.pointers.clear();
    this.cancelCameraInertia();
    this.safariGestureActive = false;
    this.gestureMoved = false;
    this.gestureInterruptedInertia = false;
    this.pendingHover = false;
    if (this.hoverRequest > 0) cancelAnimationFrame(this.hoverRequest);
    this.hoverRequest = 0;
    this.viewport.dataset.dragging = "false";
    if (this.hoveredNodeId !== null) {
      this.hoveredNodeId = null;
      this.applyInteraction();
    }
    this.setCameraInMotion(false);
    this.stopFrameLoop();
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    this.cancelCameraInertia();
    this.refreshGeometry();
    this.settleNow();
    this.markDirty();
  };

  private handleReducedMotionChange = (): void => {
    if (this.reducedMotionQuery.matches) {
      this.cancelCameraInertia();
      this.scheduleSettle();
    }
    this.engine.setAmbientMotionEnabled(!this.reducedMotionQuery.matches);
    this.markDirty();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.suspendTransientWork();
      return;
    }
    if (!this.presentationVisible) return;
    this.refreshGeometry();
    this.settleNow();
    this.markDirty();
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (
      isGestureUiTarget(event.target) ||
      (this.nativeTouchInput && event.pointerType === "touch") ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) return;
    event.preventDefault();
    this.settleScheduler.cancel();
    const interrupted = this.beginPanSample(eventTime(event, this.now()));
    this.viewport.focus({ preventScroll: true });
    if (this.pointers.count === 0) {
      this.refreshGeometry();
      this.gestureMoved = false;
      this.gestureInterruptedInertia = interrupted;
    } else {
      this.gestureInterruptedInertia ||= interrupted;
    }
    const point = this.canvasPoint(event.clientX, event.clientY);
    const pointerIndex = this.pointers.begin(event.pointerId, point.x, point.y);
    if (pointerIndex < 0) return;
    if (this.pointers.count > 1) {
      this.gestureMoved = true;
      this.clearLongPress();
    } else if (event.pointerType === "touch") {
      this.beginLongPress(event.pointerId, point.x, point.y);
    }
    try {
      this.viewport.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events do not always have browser capture state.
    }
    this.viewport.dataset.dragging = "true";
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.nativeTouchInput && event.pointerType === "touch") return;
    const pointerIndex = this.pointers.indexOf(event.pointerId);
    if (pointerIndex < 0) {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        const point = this.canvasPoint(event.clientX, event.clientY);
        this.scheduleHover(point.x, point.y);
      }
      return;
    }
    event.preventDefault();
    const point = this.canvasPoint(event.clientX, event.clientY);
    if (
      event.pointerType === "touch" &&
      this.moveLongPress(event.pointerId, point.x, point.y)
    ) {
      this.pointers.update(pointerIndex, point.x, point.y);
      return;
    }
    this.setCameraInMotion(true);
    if (
      this.pointers.movedBeyond(pointerIndex, point.x, point.y, 4) ||
      this.pointers.count > 1
    ) this.gestureMoved = true;
    if (this.pointers.count >= 2) {
      this.beginPanSample(eventTime(event, this.now()));
      const previousFirstX = this.pointers.xAt(0);
      const previousFirstY = this.pointers.yAt(0);
      const previousSecondX = this.pointers.xAt(1);
      const previousSecondY = this.pointers.yAt(1);
      this.pointers.update(pointerIndex, point.x, point.y);
      this.engine.pinchCamera(
        previousFirstX,
        previousFirstY,
        previousSecondX,
        previousSecondY,
        this.pointers.xAt(0),
        this.pointers.yAt(0),
        this.pointers.xAt(1),
        this.pointers.yAt(1),
      );
      this.scheduleSettle();
    } else {
      const deltaX = point.x - this.pointers.xAt(pointerIndex);
      const deltaY = point.y - this.pointers.yAt(pointerIndex);
      this.inertialPan.sample(deltaX, deltaY, eventTime(event, this.now()));
      this.engine.panCameraBy(deltaX, deltaY);
      this.pointers.update(pointerIndex, point.x, point.y);
    }
    this.markDirty();
  };

  private handlePointerRelease = (event: PointerEvent): void => {
    if (this.nativeTouchInput && event.pointerType === "touch") return;
    const pointerIndex = this.pointers.indexOf(event.pointerId);
    if (pointerIndex < 0) return;
    const activeCount = this.pointers.count;
    const point = this.canvasPoint(event.clientX, event.clientY);
    const shouldSelect = event.type === "pointerup" && activeCount === 1 &&
      !this.gestureMoved;
    this.releaseLongPress(event.pointerId);
    this.pointers.remove(event.pointerId);
    if (this.viewport.hasPointerCapture(event.pointerId)) {
      try {
        this.viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
    }
    if (this.pointers.count === 0) {
      this.viewport.dataset.dragging = "false";
      if (shouldSelect) {
        this.select(this.engine.pickNode(point.x, point.y));
      } else if (this.gestureMoved || event.type === "pointercancel") {
        const started = event.type === "pointerup" && activeCount === 1 &&
          this.startPanInertia(eventTime(event, this.now()));
        if (!started) this.scheduleSettle();
      } else if (this.gestureInterruptedInertia) {
        this.scheduleSettle();
      }
      this.gestureMoved = false;
      this.gestureInterruptedInertia = false;
    } else if (this.pointers.count === 1) {
      this.beginPanSample(eventTime(event, this.now()));
      this.settleScheduler.cancel();
    }
  };

  private handlePointerLeave = (): void => {
    if (this.pointers.count > 0) return;
    this.pendingHover = false;
    if (this.hoveredNodeId === null) return;
    this.hoveredNodeId = null;
    this.applyInteraction();
  };

  private handleTouchStart = (event: TouchEvent): void => {
    if (isGestureUiTarget(event.target)) return;
    event.preventDefault();
    this.settleScheduler.cancel();
    const interrupted = this.beginPanSample(eventTime(event, this.now()));
    this.viewport.focus({ preventScroll: true });
    if (this.pointers.count === 0) {
      this.refreshGeometry();
      this.gestureMoved = false;
      this.gestureInterruptedInertia = interrupted;
    } else {
      this.gestureInterruptedInertia ||= interrupted;
    }
    let longPressId: number | null = null;
    let longPressX = 0;
    let longPressY = 0;
    for (let index = 0; index < event.changedTouches.length; index += 1) {
      const touch = event.changedTouches.item(index);
      if (!touch) continue;
      const point = this.canvasPoint(touch.clientX, touch.clientY);
      longPressId = touch.identifier;
      longPressX = point.x;
      longPressY = point.y;
      this.pointers.begin(touch.identifier, point.x, point.y);
    }
    if (this.pointers.count > 1) {
      this.gestureMoved = true;
      this.clearLongPress();
    } else if (longPressId !== null) {
      this.beginLongPress(longPressId, longPressX, longPressY);
    }
    if (this.pointers.count > 0) this.viewport.dataset.dragging = "true";
  };

  private handleTouchMove = (event: TouchEvent): void => {
    if (this.pointers.count === 0) return;
    event.preventDefault();
    const previousFirstX = this.pointers.xAt(0);
    const previousFirstY = this.pointers.yAt(0);
    const previousSecondX = this.pointers.xAt(1);
    const previousSecondY = this.pointers.yAt(1);
    let holdForLongPress = false;
    for (let index = 0; index < event.touches.length; index += 1) {
      const touch = event.touches.item(index);
      if (!touch) continue;
      const pointerIndex = this.pointers.indexOf(touch.identifier);
      if (pointerIndex < 0) continue;
      const point = this.canvasPoint(touch.clientX, touch.clientY);
      holdForLongPress ||= this.moveLongPress(touch.identifier, point.x, point.y);
      if (this.pointers.movedBeyond(pointerIndex, point.x, point.y, 4)) {
        this.gestureMoved = true;
      }
      this.pointers.update(pointerIndex, point.x, point.y);
    }
    if (holdForLongPress && this.pointers.count === 1) return;
    this.setCameraInMotion(true);
    if (this.pointers.count >= 2) {
      this.gestureMoved = true;
      this.beginPanSample(eventTime(event, this.now()));
      this.engine.pinchCamera(
        previousFirstX,
        previousFirstY,
        previousSecondX,
        previousSecondY,
        this.pointers.xAt(0),
        this.pointers.yAt(0),
        this.pointers.xAt(1),
        this.pointers.yAt(1),
      );
      this.scheduleSettle();
    } else {
      const deltaX = this.pointers.xAt(0) - previousFirstX;
      const deltaY = this.pointers.yAt(0) - previousFirstY;
      this.inertialPan.sample(deltaX, deltaY, eventTime(event, this.now()));
      this.engine.panCameraBy(deltaX, deltaY);
    }
    this.markDirty();
  };

  private handleTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();
    const activeCount = this.pointers.count;
    const releaseTouch = event.changedTouches.item(0);
    const shouldSelect = event.type === "touchend" && activeCount === 1 &&
      !this.gestureMoved && releaseTouch !== null;
    for (let index = 0; index < event.changedTouches.length; index += 1) {
      const touch = event.changedTouches.item(index);
      if (!touch) continue;
      this.releaseLongPress(touch.identifier);
      this.pointers.remove(touch.identifier);
    }
    if (this.pointers.count > 0) {
      this.beginPanSample(eventTime(event, this.now()));
      this.settleScheduler.cancel();
      return;
    }
    this.viewport.dataset.dragging = "false";
    if (shouldSelect && releaseTouch) {
      const point = this.canvasPoint(releaseTouch.clientX, releaseTouch.clientY);
      this.select(this.engine.pickNode(point.x, point.y));
    } else if (this.gestureMoved) {
      const started = event.type === "touchend" && activeCount === 1 &&
        this.startPanInertia(eventTime(event, this.now()));
      if (!started) this.scheduleSettle();
    } else if (this.gestureInterruptedInertia) {
      this.scheduleSettle();
    }
    this.gestureMoved = false;
    this.gestureInterruptedInertia = false;
  };

  private handleTouchCancel = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
    this.clearLongPress();
    this.pointers.clear();
    this.cancelCameraInertia();
    this.viewport.dataset.dragging = "false";
    this.gestureMoved = false;
    this.gestureInterruptedInertia = false;
    this.scheduleSettle();
  };

  private handleWheel = (event: WheelEvent): void => {
    if (isGestureUiTarget(event.target) || this.safariGestureActive) return;
    event.preventDefault();
    const point = this.canvasPoint(event.clientX, event.clientY);
    if (event.ctrlKey || event.shiftKey) {
      this.wheelInputMode = "pinch-zoom";
      this.viewport.dataset.wheelInputMode = this.wheelInputMode;
      const sampleTime = this.now();
      const continuing = this.wheelZoomReleaseAt > 0 &&
        sampleTime <= this.wheelZoomReleaseAt && !this.inertialZoom.isActive;
      if (continuing) {
        this.inertialPan.cancel();
      } else {
        this.beginZoomSample(sampleTime, point.x, point.y);
      }
      const speed = event.shiftKey && !event.ctrlKey ? 0.0035 : 0.012;
      const scaleRatio = friendsGalaxyWheelScaleRatio(event.deltaY, speed);
      this.sampleZoom(scaleRatio, sampleTime, point.x, point.y);
      this.wheelZoomReleaseAt = sampleTime + TRACKPAD_ZOOM_RELEASE_DELAY_MS;
      this.viewport.dataset.inertialZoom = "false";
      this.settleScheduler.cancel();
      this.setCameraInMotion(true);
      this.engine.zoomCameraAt(point.x, point.y, scaleRatio);
      this.markDirty();
      return;
    }
    this.cancelCameraInertia();
    const deltaX = friendsGalaxyWheelDeltaPixels(
      event.deltaX,
      event.deltaMode,
      this.geometryValue.interactionWidth,
    );
    const deltaY = friendsGalaxyWheelDeltaPixels(
      event.deltaY,
      event.deltaMode,
      this.geometryValue.interactionHeight,
    );
    if (deltaX === 0 && deltaY === 0) return;
    this.wheelInputMode = "two-finger-pan";
    this.viewport.dataset.wheelInputMode = this.wheelInputMode;
    this.setCameraInMotion(true);
    this.engine.panCameraBy(-deltaX, -deltaY);
    this.markDirty();
    this.scheduleSettle();
  };

  private handleContextMenu = (event: MouseEvent): void => {
    if (isGestureUiTarget(event.target)) return;
    event.preventDefault();
    const interrupted = this.cancelCameraInertia();
    this.refreshGeometry();
    const point = this.canvasPoint(event.clientX, event.clientY);
    this.requestContextAt(point.x, point.y, "pointer");
    if (interrupted) this.scheduleSettle();
  };

  private handleGestureStart = (event: SafariGestureEvent): void => {
    if (isGestureUiTarget(event.target)) return;
    event.preventDefault();
    this.wheelInputMode = "pinch-zoom";
    this.viewport.dataset.wheelInputMode = this.wheelInputMode;
    this.setCameraInMotion(true);
    this.settleScheduler.cancel();
    this.safariGesturePreviousScale = Number.isFinite(event.scale) && event.scale! > 0
      ? event.scale!
      : 1;
    this.refreshGeometry();
    const fallbackX = this.geometryValue.interactionCenterX;
    const fallbackY = this.geometryValue.interactionCenterY;
    this.safariGesturePreviousX = Number.isFinite(event.clientX)
      ? event.clientX! - this.geometryValue.canvasClientLeft
      : fallbackX;
    this.safariGesturePreviousY = Number.isFinite(event.clientY)
      ? event.clientY! - this.geometryValue.canvasClientTop
      : fallbackY;
    this.beginZoomSample(
      this.now(),
      this.safariGesturePreviousX,
      this.safariGesturePreviousY,
    );
    this.safariGestureActive = true;
  };

  private handleGestureChange = (event: SafariGestureEvent): void => {
    if (!this.safariGestureActive) return;
    event.preventDefault();
    const x = Number.isFinite(event.clientX)
      ? event.clientX! - this.geometryValue.canvasClientLeft
      : this.safariGesturePreviousX;
    const y = Number.isFinite(event.clientY)
      ? event.clientY! - this.geometryValue.canvasClientTop
      : this.safariGesturePreviousY;
    const scaleRatio = friendsGalaxyGestureScaleRatio(
      this.safariGesturePreviousScale,
      event.scale ?? 1,
    );
    this.sampleZoom(scaleRatio, this.now(), x, y);
    this.engine.zoomCameraBetween(
      this.safariGesturePreviousX,
      this.safariGesturePreviousY,
      x,
      y,
      scaleRatio,
    );
    if (Number.isFinite(event.scale) && event.scale! > 0) {
      this.safariGesturePreviousScale = event.scale!;
    }
    this.safariGesturePreviousX = x;
    this.safariGesturePreviousY = y;
    this.markDirty();
    this.settleScheduler.cancel();
  };

  private handleGestureEnd = (event: SafariGestureEvent): void => {
    if (!this.safariGestureActive) return;
    event.preventDefault();
    this.safariGestureActive = false;
    const releaseTime = this.now();
    if (!this.startZoomInertia(releaseTime, releaseTime)) this.scheduleSettle();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const command = friendsGalaxyKeyboardCommand(event);
    if (!command) return;
    let handled = true;
    switch (command.type) {
      case "pan":
        this.cancelCameraInertia();
        this.setCameraInMotion(true);
        this.engine.panCameraBy(command.deltaX, command.deltaY);
        this.scheduleSettle();
        break;
      case "zoom":
        this.cancelCameraInertia();
        this.setCameraInMotion(true);
        this.engine.zoomCameraAt(
          this.geometryValue.interactionCenterX,
          this.geometryValue.interactionCenterY,
          command.ratio,
        );
        this.scheduleSettle();
        break;
      case "fit":
        this.fitAll();
        break;
      case "clear":
        this.select(null);
        break;
      case "details":
        if (this.selectedNodeId) this.onDetails(this.selectedNodeId);
        else handled = false;
        break;
      case "context-menu":
        if (this.selectedNodeId) {
          const x = this.geometryValue.interactionCenterX;
          const y = this.geometryValue.interactionCenterY;
          const transform = this.engine.cameraTransform;
          this.onContext(transform
            ? friendsGalaxyContextTarget(
              this.selectedNodeId,
              "keyboard",
              x,
              y,
              transform,
              this.geometryValue,
            )
            : null);
        } else handled = false;
        break;
    }
    if (!handled) return;
    event.preventDefault();
    this.markDirty();
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    if (isGestureUiTarget(event.target)) return;
    event.preventDefault();
    this.fitAll();
  };
}
