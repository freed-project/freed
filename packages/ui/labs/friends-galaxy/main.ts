import "./styles.css";
import {
  frameStats,
  galaxyLabRenderPixelRatio,
  hexToRgb,
  type GalaxyLabBackend,
  type GalaxyLabBackendId,
  type GalaxyLabFieldStyle,
  type GalaxyLabFrameStats,
  type GalaxyLabInteraction,
  type GalaxyLabViewDetail,
} from "./backend.js";
import {
  GALAXY_LAB_THEMES,
  galaxyLabNodePresentation,
  type GalaxyLabPalette,
  type GalaxyLabThemeId,
  type GalaxyLabTransform,
} from "./scene-fixture.js";
import { loadGalaxyLabFixture } from "./scene-fixture-loader.js";
import { findGalaxyLabSceneNodeIndex } from "./scene-interaction-index.js";
import {
  applyGalaxyLabPinch,
  applyGalaxyLabResistedZoomAt,
  applyGalaxyLabZoomAt,
  galaxyLabResistedScaleAtRatio,
  galaxyLabWheelDeltaPixels,
} from "./gesture-math.js";
import {
  GalaxyActivityScenePatchEncoder,
  type GalaxyActivitySceneBinding,
} from "./activity-scene-patches.js";
import {
  GalaxyActivitySummaryIndex,
  type GalaxyActivitySourceKey,
} from "./activity-summary-index.js";
import { GalaxyLabAvatarAdmissionState } from "./avatar-admission-state.js";
import { selectGalaxyLabAvatars } from "./avatar-atlas.js";
import {
  GalaxyLabAvatarImageAdmission,
  type GalaxyLabAvatarImageAdmissionResult,
} from "./avatar-image-admission.js";
import {
  galaxyLabCameraScaleLimits,
  galaxyLabInitialCameraScale,
  galaxyLabOutwardZoomEnvelope,
  type GalaxyLabOutwardZoomEnvelope,
  writeGalaxyLabFocusedTransform,
  writeGalaxyLabWebGpuViewProjection,
} from "./camera-math.js";
import { shouldContinueGalaxyLabFrame } from "./frame-loop.js";
import { GalaxyLabInertialPan } from "./inertial-pan.js";
import { GalaxyLabPointerRoster } from "./pointer-roster.js";
import {
  GalaxyLabSampleRing,
  shouldRefreshGalaxyLabDiagnostics,
} from "./sample-ring.js";
import { GalaxyLabSettleScheduler } from "./settle-scheduler.js";
import {
  createGalaxyLabDiagnosticSnapshot,
  serializeGalaxyLabDiagnosticSnapshot,
} from "./diagnostic-export.js";
import { GalaxyLabLongTaskMonitor } from "./long-task-monitor.js";
import {
  galaxyLabGraphDescription,
  galaxyLabRecoveryAnnouncement,
  galaxyLabSelectionAnnouncement,
  galaxyLabUnavailableAnnouncement,
  type GalaxyLabSelectionAnnouncementKind,
} from "./accessibility.js";
import {
  galaxyLabViewportGeometry,
  reanchorGalaxyLabTransformToInteraction,
  writeGalaxyLabCanvasPoint,
  type GalaxyLabCanvasPoint,
  type GalaxyLabViewportGeometry,
} from "./viewport-geometry.js";
import {
  GalaxyLabLongPressTracker,
  galaxyLabContextTarget,
  galaxyLabKeyboardCommand,
  type GalaxyLabContextRequestSource,
  type GalaxyLabContextTarget,
} from "./interaction-contract.js";
import { projectGalaxyLabWorldPoint } from "./viewport-projection.js";

const DEFAULT_PERSON_COUNT = 5_000;
const DEFAULT_ACCOUNT_COUNT = 25_000;
const DEFAULT_BACKGROUND_COUNT = 100_000;
const DEFAULT_ACTIVITY_SUMMARY_COUNT = 25_000;
const DEFAULT_REPRESENTED_ACTIVITY_ITEM_COUNT = 250_000;
const PROGRAMMATIC_FOCUS_SCALE = 0.92;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const scaleFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });
type GalaxyLabWheelInputMode = "idle" | "two-finger-pan" | "pinch-zoom";
const labParameters = new URLSearchParams(window.location.search);
const animationProbeDisabled = labParameters.get("animate") === "0";
const pixelRatioParameter = Number.parseFloat(labParameters.get("dpr") ?? "");
const pixelRatioOverride = Number.isFinite(pixelRatioParameter) && pixelRatioParameter > 0
  ? pixelRatioParameter
  : null;
if (labParameters.get("compact") === "1") {
  document.documentElement.dataset.compactProbe = "true";
}
if (labParameters.get("controls") === "hidden") {
  document.documentElement.dataset.controlsHidden = "true";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing renderer lab element: ${id}`);
  return element as T;
}

const viewport = requiredElement<HTMLElement>("viewport");
const canvasHost = requiredElement<HTMLElement>("canvas-host");
const graphDescription = requiredElement<HTMLElement>("galaxy-description");
const graphAnnouncer = requiredElement<HTMLElement>("galaxy-announcer");
const backendSelect = requiredElement<HTMLSelectElement>("backend");
const themeSelect = requiredElement<HTMLSelectElement>("theme");
const fieldStyleSelect = requiredElement<HTMLSelectElement>("field-style");
const fitButton = requiredElement<HTMLButtonElement>("fit");
const copyDiagnosticsButton = requiredElement<HTMLButtonElement>("copy-diagnostics");
const simulateLossButton = requiredElement<HTMLButtonElement>("simulate-loss");
const animateControl = requiredElement<HTMLInputElement>("animate");
const statusElement = requiredElement<HTMLElement>("status");
const metricsElement = requiredElement<HTMLElement>("metrics");
const nativeTouchInput = navigator.maxTouchPoints > 0 && "ontouchstart" in window;
viewport.dataset.touchInputMode = nativeTouchInput
  ? "native-touch-events"
  : "pointer-events";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const longTaskMonitor = new GalaxyLabLongTaskMonitor();
let animatePreferenceTouched = false;
animateControl.checked = !animationProbeDisabled && !reducedMotionQuery.matches;

function setStatus(message: string, error = false): void {
  statusElement.textContent = message;
  statusElement.dataset.error = String(error);
}

const fixtureWorker = new Worker(
  new URL("./scene-fixture.worker.ts", import.meta.url),
  { type: "module" },
);
const fixtureLoad = await loadGalaxyLabFixture(fixtureWorker, {
  personCount: DEFAULT_PERSON_COUNT,
  accountCount: DEFAULT_ACCOUNT_COUNT,
  backgroundStarCount: DEFAULT_BACKGROUND_COUNT,
  activitySummaryCount: DEFAULT_ACTIVITY_SUMMARY_COUNT,
  representedActivityItemCount: DEFAULT_REPRESENTED_ACTIVITY_ITEM_COUNT,
}).catch((error: unknown) => {
  viewport.dataset.fixtureWorker = "error";
  simulateLossButton.disabled = true;
  fitButton.disabled = true;
  setStatus(
    error instanceof Error ? error.message : "Friends Galaxy scene compilation failed.",
    true,
  );
  throw error;
});
const { fixture, receipt: fixtureWorkerReceipt } = fixtureLoad;
viewport.dataset.fixtureWorker = "ready";
viewport.dataset.fixtureMetadataNodeCount = String(fixtureWorkerReceipt.metadataNodeCount);
viewport.dataset.fixtureTransferCount = String(fixtureWorkerReceipt.transferableBufferCount);
viewport.dataset.activitySummaryCount = String(fixtureWorkerReceipt.activitySummaryCount);
viewport.dataset.representedActivityItemCount = String(
  fixtureWorkerReceipt.representedActivityItemCount,
);

function activitySourceForNode(nodeIndex: number): GalaxyActivitySourceKey | null {
  const provider = fixture.scene.providers[nodeIndex];
  const accountId = fixture.scene.accountIds[nodeIndex];
  if (!provider || !accountId) return null;
  return provider === "rss"
    ? { namespace: "rss", key: `feed:${accountId}` }
    : { namespace: "social", key: `${provider}:${accountId}` };
}

const activityProbeNodeIndex = fixture.personCount;
const activityProbeSource = activitySourceForNode(activityProbeNodeIndex);
if (!activityProbeSource) throw new Error("The Friends Galaxy fixture requires one activity source.");
const activityScenePatchEncoder = new GalaxyActivityScenePatchEncoder([{
  ...activityProbeSource,
  nodeIndex: activityProbeNodeIndex,
} satisfies GalaxyActivitySceneBinding]);
const activityProbeIndex = new GalaxyActivitySummaryIndex([{
  ...activityProbeSource,
  globalId: "lab-activity-probe-1",
  publishedAt: 1_725_000_000_000,
  hasLocation: false,
  avatarUrl: null,
}]);
const activityProbeSummaryPatch = activityProbeIndex.applyDeltas([{
  previous: null,
  next: {
    ...activityProbeSource,
    globalId: "lab-activity-probe-2",
    publishedAt: 1_725_000_060_000,
    hasLocation: true,
    avatarUrl: "https://lab.invalid/avatar.png",
  },
}], () => []);
const activityProbeScenePatch = activityScenePatchEncoder.encode(
  activityProbeSummaryPatch.patches,
  activityProbeSummaryPatch.revision,
  1_725_000_120_000,
);

const transform: GalaxyLabTransform = { x: 0, y: 0, scale: 0.12 };
let cameraScaleLimits = galaxyLabCameraScaleLimits(
  1,
  fixture.scene.bounds.minZ,
  fixture.scene.bounds.maxZ,
);
let outwardZoomEnvelope: GalaxyLabOutwardZoomEnvelope =
  galaxyLabOutwardZoomEnvelope(cameraScaleLimits.fitMinimum, cameraScaleLimits);
let activeBackend: GalaxyLabBackend | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let activeTheme = themeSelect.value as GalaxyLabThemeId;
let activeFieldStyle = fieldStyleSelect.value as GalaxyLabFieldStyle;
let switchGeneration = 0;
let backendRecoveryPending = false;
let lastRecoveryReason: string | null = null;
let frameRequest = 0;
let lastFrameAt = 0;
let lastMetricsAt = 0;
let dirty = true;
let metricsDirty = true;
let userMovedCamera = false;
let cameraInMotion = false;
let renderResizePending = false;
let wheelInputMode: GalaxyLabWheelInputMode = "idle";
let presentationVisible = true;
viewport.dataset.cameraMotion = "false";
viewport.dataset.frameLoop = "idle";
viewport.dataset.renderResizePending = "false";
viewport.dataset.inertialPan = "false";
viewport.dataset.wheelInputMode = wheelInputMode;
viewport.dataset.presentationVisible = "true";
canvasHost.dataset.presentationVisible = "true";
const settleScheduler = new GalaxyLabSettleScheduler();
const inertialPan = new GalaxyLabInertialPan();
const frameSamples = new GalaxyLabSampleRing(240);
const submitSamples = new GalaxyLabSampleRing(240);
const nodeLabelById = new Map(fixture.atlas.nodes.map((node) => [node.id, node.label]));
let interaction: GalaxyLabInteraction = { selectedNodeId: null, hoveredNodeId: null };
let avatarAdmissionGeneration = 0;
const emptyAvatarImages = new Map<string, CanvasImageSource>();
const avatarAdmissionState = new GalaxyLabAvatarAdmissionState<GalaxyLabBackend>();
const avatarAdmissionViewProjection = new Float32Array(16);
const avatarAdmissionProjection = {
  viewProjection: avatarAdmissionViewProjection,
  width: 1,
  height: 1,
};
let avatarAdmissionApplyCount = 0;
let avatarAdmissionReuseCount = 0;
let avatarAdmissionResult: GalaxyLabAvatarImageAdmissionResult = {
  images: emptyAvatarImages,
  requestedNodeCount: 0,
  readyNodeCount: 0,
  failedSourceCount: 0,
  cachedSourceCount: 0,
};

function accessibleNodeLabel(nodeId: string | null): string | null {
  if (!nodeId) return null;
  const metadataLabel = nodeLabelById.get(nodeId);
  if (metadataLabel) return metadataLabel;
  const nodeIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    nodeId,
  );
  return nodeIndex === null
    ? "Galaxy item"
    : galaxyLabNodePresentation(fixture, nodeIndex).label;
}

function syncGraphDescription(): void {
  graphDescription.textContent = galaxyLabGraphDescription(
    accessibleNodeLabel(interaction.selectedNodeId),
    reducedMotionQuery.matches,
  );
}

function announceGraph(message: string): void {
  graphAnnouncer.textContent = message;
  graphAnnouncer.dataset.lastAnnouncement = message;
}

function announceGraphSelection(
  nodeId: string | null,
  kind: GalaxyLabSelectionAnnouncementKind,
): void {
  announceGraph(
    galaxyLabSelectionAnnouncement(accessibleNodeLabel(nodeId), kind),
  );
}

function canPresentGalaxy(): boolean {
  return presentationVisible && document.visibilityState === "visible";
}

function requestGalaxyFrame(): void {
  if (!canPresentGalaxy() || frameRequest !== 0) return;
  frameRequest = requestAnimationFrame(renderFrame);
  viewport.dataset.frameLoop = "active";
}

function markGalaxyDirty(): void {
  dirty = true;
  metricsDirty = true;
  requestGalaxyFrame();
}

function hashAvatarSource(sourceKey: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < sourceKey.length; index += 1) {
    hash ^= sourceKey.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

async function decodeLocalAvatarImage(sourceKey: string): Promise<CanvasImageSource> {
  const prefix = "lab-local-avatar-v1:";
  if (!sourceKey.startsWith(prefix)) throw new Error("Unknown local avatar image source.");
  const nodeId = sourceKey.slice(prefix.length);
  const nodeIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    nodeId,
  );
  const label = nodeLabelById.get(nodeId) ?? (
    nodeIndex === null ? nodeId : galaxyLabNodePresentation(fixture, nodeIndex).label
  );
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const hash = hashAvatarSource(sourceKey);
  const hue = hash % 360;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for local avatar decoding.");
  const background = context.createRadialGradient(42, 34, 8, 64, 64, 92);
  background.addColorStop(0, `hsl(${String((hue + 42) % 360)} 78% 72%)`);
  background.addColorStop(0.5, `hsl(${String(hue)} 66% 48%)`);
  background.addColorStop(1, `hsl(${String((hue + 292) % 360)} 72% 20%)`);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.34;
  context.strokeStyle = "white";
  context.lineWidth = 3;
  for (let ring = 0; ring < 3; ring += 1) {
    context.beginPath();
    context.ellipse(
      64,
      64,
      28 + ring * 15,
      12 + ring * 8,
      ((hash >>> (ring * 4)) % 18) / 10,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  context.globalAlpha = 0.92;
  context.fillStyle = "white";
  context.font = "700 40px Inter, ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(initials || "F", 64, 66);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("The local avatar fixture could not be encoded."));
    }, "image/png");
  });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const image = new Image();
  image.decoding = "async";
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The local avatar fixture could not be decoded."));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const avatarImageAdmission = new GalaxyLabAvatarImageAdmission(
  decodeLocalAvatarImage,
  18,
  3,
);

function paletteForTheme(): GalaxyLabPalette {
  return GALAXY_LAB_THEMES[activeTheme] ?? GALAXY_LAB_THEMES.scriptorium;
}

function applyDocumentPalette(palette: GalaxyLabPalette): void {
  const root = document.documentElement;
  root.style.setProperty("--lab-background", palette.background);
  root.style.setProperty("--lab-surface", palette.surface);
  root.style.setProperty("--lab-text", palette.text);
  root.style.setProperty("--lab-muted", palette.mutedText);
  root.style.setProperty("--lab-friend", palette.friend);
  root.style.setProperty("--lab-selection", palette.selection);
  root.style.setProperty("--lab-account", palette.account);
  root.style.setProperty("--lab-feed", palette.feed);
  const [red, green, blue] = hexToRgb(palette.background);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  root.style.colorScheme = luminance > 0.58 ? "light" : "dark";
  root.style.setProperty(
    "--lab-border",
    luminance > 0.58 ? "rgb(48 34 24 / 0.2)" : "rgb(255 255 255 / 0.16)",
  );
  root.style.setProperty(
    "--lab-shadow",
    luminance > 0.58 ? "rgb(48 34 24 / 0.18)" : "rgb(0 0 0 / 0.42)",
  );
}

function canvasSize(): { width: number; height: number } {
  return {
    width: viewportGeometry.canvasWidth,
    height: viewportGeometry.canvasHeight,
  };
}

function refreshCameraScaleLimits(viewportHeight: number): void {
  cameraScaleLimits = galaxyLabCameraScaleLimits(
    viewportHeight,
    fixture.scene.bounds.minZ,
    fixture.scene.bounds.maxZ,
  );
  viewport.dataset.minimumCameraScale = String(cameraScaleLimits.minimum);
  viewport.dataset.maximumCameraScale = String(cameraScaleLimits.maximum);
}

function refreshOutwardZoomEnvelope(fittedScale: number): void {
  outwardZoomEnvelope = galaxyLabOutwardZoomEnvelope(
    fittedScale,
    cameraScaleLimits,
  );
  viewport.dataset.outwardZoomTargetScale = String(outwardZoomEnvelope.target);
  viewport.dataset.zoomResistanceScale = String(outwardZoomEnvelope.resistance);
}

function recordCameraScaleDiagnostics(): void {
  viewport.dataset.cameraScale = String(transform.scale);
  viewport.dataset.zoomBoundary = transform.scale < outwardZoomEnvelope.resistance
    ? "resisted"
    : "free";
}

function effectiveDevicePixelRatio(): number {
  return pixelRatioOverride ?? window.devicePixelRatio ?? 1;
}

function recordActiveRenderDensity(): void {
  const renderPixelRatio = activeBackend?.metrics().renderPixelRatio;
  if (renderPixelRatio === undefined) {
    delete viewport.dataset.renderDensity;
    return;
  }
  const value = String(renderPixelRatio);
  viewport.dataset.renderDensity = value;
  if (cameraInMotion) viewport.dataset.lastMotionRenderDensity = value;
  else viewport.dataset.lastSettledRenderDensity = value;
}

function resizeActiveBackend(): void {
  const { width, height } = canvasSize();
  activeBackend?.resize(
    width,
    height,
    galaxyLabRenderPixelRatio(effectiveDevicePixelRatio(), width, cameraInMotion),
  );
  recordActiveRenderDensity();
  renderResizePending = false;
  viewport.dataset.renderResizePending = "false";
}

function setCameraInMotion(next: boolean): void {
  if (next === cameraInMotion) return;
  cameraInMotion = next;
  viewport.dataset.cameraMotion = String(next);
  activeBackend?.setCameraMotion?.(next);
  renderResizePending = true;
  viewport.dataset.renderResizePending = "true";
  markGalaxyDirty();
}

function cancelInertialPan(): boolean {
  const wasActive = inertialPan.isActive;
  inertialPan.cancel();
  viewport.dataset.inertialPan = "false";
  return wasActive;
}

function beginInertialPanSample(timeMs: number): boolean {
  const interrupted = inertialPan.isActive;
  inertialPan.begin(timeMs);
  viewport.dataset.inertialPan = "false";
  return interrupted;
}

function startInertialPan(releaseTimeMs: number): boolean {
  const started = inertialPan.start(
    releaseTimeMs,
    performance.now(),
    reducedMotionQuery.matches,
  );
  viewport.dataset.inertialPan = String(started);
  if (!started) return false;
  settleScheduler.cancel();
  setCameraInMotion(true);
  markGalaxyDirty();
  return true;
}

function viewDetailForScale(scale: number): GalaxyLabViewDetail {
  if (scale < 0.24) return "overview";
  if (scale < 0.9) return "middle";
  return "close";
}

async function admitSettledAvatarImages(
  backend: GalaxyLabBackend,
  detail: GalaxyLabViewDetail,
  generation: number,
): Promise<void> {
  if (!backend.setAvatarImages || !canPresentGalaxy()) return;
  const { width, height } = canvasSize();
  const compact = width < 720;
  writeGalaxyLabWebGpuViewProjection(
    avatarAdmissionViewProjection,
    transform,
    width,
    height,
  );
  avatarAdmissionProjection.width = width;
  avatarAdmissionProjection.height = height;
  const avatarCandidates = detail === "close"
    ? selectGalaxyLabAvatars(
      fixture,
      paletteForTheme(),
      interaction.selectedNodeId,
      compact,
      detail,
      avatarAdmissionProjection,
    )
    : [];
  const admissionKey = detail === "close"
    ? `close:${avatarCandidates.map((avatar) => avatar.nodeId).join(",")}`
    : "hidden";
  const admissionStart = avatarAdmissionState.begin(backend, admissionKey, generation);
  if (admissionStart !== "start") {
    avatarAdmissionReuseCount += 1;
    return;
  }
  const result = detail === "close"
    ? await avatarImageAdmission.admit(avatarCandidates.map((avatar) => ({
      nodeId: avatar.nodeId,
      sourceKey: `lab-local-avatar-v1:${avatar.nodeId}`,
    })))
    : {
      images: emptyAvatarImages,
      requestedNodeCount: 0,
      readyNodeCount: 0,
      failedSourceCount: 0,
      cachedSourceCount: avatarAdmissionResult.cachedSourceCount,
    };
  const currentGeneration = avatarAdmissionGeneration;
  if (
    !avatarAdmissionState.canCommit(backend, admissionKey, currentGeneration) ||
    backend !== activeBackend ||
    (detail === "close" && viewDetailForScale(transform.scale) !== "close") ||
    !canPresentGalaxy() ||
    cameraInMotion ||
    pointers.count > 0 ||
    safariGestureActive
  ) {
    avatarAdmissionState.discard(backend, admissionKey);
    return;
  }
  avatarAdmissionResult = result;
  backend.setAvatarImages(result.images);
  avatarAdmissionState.commit(backend, admissionKey, currentGeneration);
  avatarAdmissionApplyCount += 1;
  markGalaxyDirty();
}

function applyBackendSettledView(
  backend: GalaxyLabBackend,
  detail: GalaxyLabViewDetail,
): void {
  if (backend.setSettledView) backend.setSettledView(detail, transform);
  else backend.setViewDetail(detail);
}

function applySettledViewDetail(generation: number): void {
  if (!canPresentGalaxy()) return;
  setCameraInMotion(false);
  const backend = activeBackend;
  if (!backend) return;
  const detail = viewDetailForScale(transform.scale);
  applyBackendSettledView(backend, detail);
  void admitSettledAvatarImages(backend, detail, generation);
  markGalaxyDirty();
}

function scheduleSettledViewDetail(immediate = false): void {
  const generation = ++avatarAdmissionGeneration;
  if (!canPresentGalaxy()) {
    settleScheduler.cancel();
    return;
  }
  if (immediate) {
    settleScheduler.cancel();
    applySettledViewDetail(generation);
    return;
  }
  settleScheduler.schedule(generation, performance.now());
  requestGalaxyFrame();
}

function fittedGalaxyScale(width: number, height: number): number {
  const bounds = fixture.atlas.bounds;
  const worldWidth = Math.max(1, bounds.right - bounds.left);
  const worldHeight = Math.max(1, bounds.bottom - bounds.top);
  const insets = viewportGeometry.insets;
  const usableWidth = Math.max(1, width - insets.left - insets.right);
  const usableHeight = Math.max(1, height - insets.top - insets.bottom);
  const padding = usableWidth < 640 ? 42 : 96;
  return Math.max(
    cameraScaleLimits.fitMinimum,
    Math.min(
      cameraScaleLimits.maximum,
      Math.min(
        Math.max(1, usableWidth - padding * 2) / worldWidth,
        Math.max(1, usableHeight - padding * 2) / worldHeight,
      ),
    ),
  );
}

function frameGalaxy(markAsUserAction: boolean, useInitialScale: boolean): void {
  cancelInertialPan();
  const { width, height } = canvasSize();
  refreshCameraScaleLimits(height);
  const bounds = fixture.atlas.bounds;
  const fittedScale = fittedGalaxyScale(width, height);
  refreshOutwardZoomEnvelope(fittedScale);
  const usableWidth = Math.max(
    1,
    width - viewportGeometry.insets.left - viewportGeometry.insets.right,
  );
  const nextScale = useInitialScale
    ? Math.min(
        cameraScaleLimits.maximum,
        galaxyLabInitialCameraScale(fittedScale, usableWidth),
      )
    : fittedScale;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  writeGalaxyLabFocusedTransform(
    transform,
    centerX,
    centerY,
    0,
    nextScale,
    width,
    height,
    viewportGeometry.insets,
  );
  recordCameraScaleDiagnostics();
  userMovedCamera = markAsUserAction;
  markGalaxyDirty();
  scheduleSettledViewDetail(true);
}

function fitGalaxy(markAsUserAction = true): void {
  frameGalaxy(markAsUserAction, false);
}

function frameInitialGalaxy(): void {
  frameGalaxy(false, true);
}

function focusGalaxyNode(nodeId: string): boolean {
  const nodeIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    nodeId,
  );
  if (nodeIndex === null) return false;
  viewport.focus({ preventScroll: true });
  cancelInertialPan();
  settleScheduler.cancel();
  const { width, height } = canvasSize();
  const offset = nodeIndex * 3;
  const scale = Math.min(
    cameraScaleLimits.maximum,
    Math.max(transform.scale, PROGRAMMATIC_FOCUS_SCALE),
  );
  writeGalaxyLabFocusedTransform(
    transform,
    fixture.scene.positions[offset]!,
    -fixture.scene.positions[offset + 1]!,
    fixture.scene.positions[offset + 2]!,
    scale,
    width,
    height,
    viewportGeometry.insets,
  );
  recordCameraScaleDiagnostics();
  updateInteraction({ selectedNodeId: nodeId, hoveredNodeId: null });
  announceGraphSelection(nodeId, "focus");
  userMovedCamera = true;
  markGalaxyDirty();
  scheduleSettledViewDetail(true);
  return true;
}

function resetSamples(): void {
  frameSamples.clear();
  submitSamples.clear();
  lastFrameAt = 0;
}

async function createBackend(id: GalaxyLabBackendId): Promise<GalaxyLabBackend> {
  if (id === "current-webgl2") {
    const { CurrentWebGl2Backend } = await import("./current-webgl2-backend.js");
    return new CurrentWebGl2Backend();
  }
  if (id === "three-webgpu") {
    const { ThreeWebGpuBackend } = await import("./three-webgpu-backend.js");
    return new ThreeWebGpuBackend();
  }
  const { RawWebGpuBackend } = await import("./raw-webgpu-backend.js");
  return new RawWebGpuBackend();
}

async function activateBackend(
  id: GalaxyLabBackendId,
  inheritedFallbackReason: string | null = null,
): Promise<void> {
  if (cancelInertialPan()) setCameraInMotion(false);
  const generation = ++switchGeneration;
  avatarAdmissionGeneration += 1;
  avatarAdmissionState.reset();
  simulateLossButton.disabled = true;
  setStatus(`Loading ${backendSelect.selectedOptions[0]?.textContent ?? id}`);
  activeBackend?.dispose();
  activeBackend = null;
  activeCanvas?.remove();
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvasHost.prepend(canvas);
  activeCanvas = canvas;
  let backend: GalaxyLabBackend | null = null;
  try {
    backend = await createBackend(id);
    await backend.initialize(canvas, fixture, paletteForTheme());
    if (generation !== switchGeneration) {
      backend.dispose();
      canvas.remove();
      return;
    }
    activeBackend = backend;
    backend.setAnimationEnabled?.(animateControl.checked);
    backend.setCameraMotion?.(cameraInMotion);
    backend.setFieldStyle?.(activeFieldStyle);
    fieldStyleSelect.disabled = typeof backend.setFieldStyle !== "function";
    simulateLossButton.disabled = typeof backend.simulateDeviceLoss !== "function";
    resizeActiveBackend();
    const detail = viewDetailForScale(transform.scale);
    backend.setInteraction(interaction);
    applyBackendSettledView(backend, detail);
    backend.applyActivityPatches?.(activityProbeScenePatch);
    const avatarGeneration = ++avatarAdmissionGeneration;
    void admitSettledAvatarImages(backend, detail, avatarGeneration);
    resetSamples();
    markGalaxyDirty();
    const metrics = backend.metrics();
    const fallback = inheritedFallbackReason ?? metrics.fallbackReason;
    lastRecoveryReason = fallback;
    setStatus(
      fallback
        ? `${metrics.label} ready. Fallback reason: ${fallback}`
        : `${metrics.label} ready. Fixture ${numberFormat.format(fixture.buildMs)} ms`,
      Boolean(fallback),
    );
    if (fallback) {
      announceGraph(galaxyLabRecoveryAnnouncement(
        backendSelect.selectedOptions[0]?.textContent ?? metrics.label,
      ));
    }
    statusElement.dataset.backend = metrics.id;
  } catch (error) {
    backend?.dispose();
    canvas.remove();
    if (generation !== switchGeneration) return;
    const reason = error instanceof Error ? error.message : String(error);
    if (id !== "current-webgl2") {
      backendSelect.value = "current-webgl2";
      await activateBackend("current-webgl2", reason);
      return;
    }
    setStatus(`Renderer failed: ${reason}`, true);
    announceGraph(galaxyLabUnavailableAnnouncement());
  }
}

function addMetric(label: string, value: string): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  metricsElement.append(term, description);
}

function formatFrameStats(stats: GalaxyLabFrameStats): string {
  return stats.frameCount === 0 ? "Pending" : `${numberFormat.format(stats.p95Ms)} ms p95`;
}

function formatByteCount(bytes: number): string {
  const mebibyte = 1_024 * 1_024;
  const kibibyte = 1_024;
  if (bytes >= mebibyte) return `${numberFormat.format(bytes / mebibyte)} MiB`;
  if (bytes >= kibibyte) return `${numberFormat.format(bytes / kibibyte)} KiB`;
  return `${integerFormat.format(bytes)} bytes`;
}

function updateMetrics(): void {
  viewport.dataset.cameraX = String(transform.x);
  viewport.dataset.cameraY = String(transform.y);
  recordCameraScaleDiagnostics();
  metricsElement.replaceChildren();
  if (!activeBackend) {
    addMetric("Renderer", "Loading");
    return;
  }
  const metrics = activeBackend.metrics();
  addMetric("Renderer", metrics.label);
  addMetric("API", metrics.api);
  addMetric("Semantic stars", integerFormat.format(metrics.semanticStarCount));
  addMetric("Background stars", integerFormat.format(metrics.decorativeStarCount));
  addMetric(
    "Activity summaries",
    integerFormat.format(fixtureWorkerReceipt.activitySummaryCount),
  );
  addMetric(
    "Represented items",
    integerFormat.format(fixtureWorkerReceipt.representedActivityItemCount),
  );
  if (metrics.motionDecorativeStarCount !== undefined) {
    addMetric("Motion background stars", integerFormat.format(metrics.motionDecorativeStarCount));
  }
  addMetric(
    "Cosmic field",
    typeof activeBackend.setFieldStyle === "function"
      ? fieldStyleSelect.selectedOptions[0]?.textContent ?? activeFieldStyle
      : "Backend default",
  );
  addMetric("Draw calls", metrics.drawCalls === null ? "Not exposed" : integerFormat.format(metrics.drawCalls));
  addMetric("Submission", metrics.submissionMode ?? "Direct draws");
  if (metrics.renderBundleCount !== undefined) {
    addMetric("Render bundles", integerFormat.format(metrics.renderBundleCount));
  }
  addMetric("Billboard labels", integerFormat.format(metrics.labelCount));
  addMetric("Avatar atlas", integerFormat.format(metrics.avatarCount));
  if (metrics.labelAtlasBuildCount !== undefined) {
    addMetric("Label atlas builds", integerFormat.format(metrics.labelAtlasBuildCount));
  }
  if (metrics.avatarAtlasBuildCount !== undefined) {
    addMetric("Avatar atlas builds", integerFormat.format(metrics.avatarAtlasBuildCount));
  }
  if (activeBackend.setAvatarImages) {
    addMetric(
      "Decoded avatars",
      `${integerFormat.format(avatarAdmissionResult.readyNodeCount)} / ${integerFormat.format(avatarAdmissionResult.requestedNodeCount)}`,
    );
    addMetric("Avatar decode failures", integerFormat.format(avatarAdmissionResult.failedSourceCount));
    addMetric("Avatar image cache", integerFormat.format(avatarAdmissionResult.cachedSourceCount));
    addMetric("Avatar atlas applies", integerFormat.format(avatarAdmissionApplyCount));
    addMetric("Avatar admission reuse", integerFormat.format(avatarAdmissionReuseCount));
  }
  addMetric("Context edges", integerFormat.format(metrics.contextualEdgeCount));
  addMetric(
    "Selection",
    interaction.selectedNodeId ? nodeLabelById.get(interaction.selectedNodeId) ?? "Selected" : "None",
  );
  addMetric("Frame interval", formatFrameStats(frameStats(frameSamples.snapshot())));
  addMetric("CPU submit", formatFrameStats(frameStats(submitSamples.snapshot())));
  const longTasks = longTaskMonitor.snapshot();
  addMetric(
    "Long tasks",
    longTasks.supported ? integerFormat.format(longTasks.count ?? 0) : "Unavailable",
  );
  addMetric("Buffer uploads", integerFormat.format(metrics.bufferUploadCount));
  if (metrics.residentStarUploadCount !== undefined) {
    addMetric("Resident star uploads", integerFormat.format(metrics.residentStarUploadCount));
  }
  if (metrics.renderPixelRatio !== undefined) {
    addMetric("Render density", `${scaleFormat.format(metrics.renderPixelRatio)}x`);
  }
  if (
    metrics.pickCandidateCount !== undefined &&
    metrics.pickSourceNodeCount !== undefined
  ) {
    addMetric(
      "Pick candidates",
      `${integerFormat.format(metrics.pickCandidateCount)} / ${integerFormat.format(metrics.pickSourceNodeCount)}`,
    );
  }
  if (metrics.trackedGpuDataBytes !== undefined) {
    addMetric("Tracked GPU data", formatByteCount(metrics.trackedGpuDataBytes));
  }
  addMetric("Activity patch keys", integerFormat.format(activityProbeSummaryPatch.patches.length));
  addMetric("Activity patch nodes", integerFormat.format(activityProbeScenePatch.nodeIndices.length));
  addMetric("Unknown activity keys", integerFormat.format(activityProbeScenePatch.unknownSources.length));
  if (metrics.appliedActivityNodeCount !== undefined) {
    addMetric("GPU activity nodes", integerFormat.format(metrics.appliedActivityNodeCount));
  }
  if (lastRecoveryReason) addMetric("Recovery reason", lastRecoveryReason);
  addMetric("Camera scale", scaleFormat.format(transform.scale));
  addMetric(
    "Clip-safe range",
    `${scaleFormat.format(cameraScaleLimits.minimum)} to ${scaleFormat.format(cameraScaleLimits.maximum)}`,
  );
  addMetric(
    "Outward zoom",
    transform.scale < outwardZoomEnvelope.resistance ? "Soft resistance" : "Free",
  );
  addMetric("Outer glide target", scaleFormat.format(outwardZoomEnvelope.target));
  addMetric("Settled detail", viewDetailForScale(transform.scale));
  addMetric("Touch input", nativeTouchInput ? "Native Touch Events" : "Pointer Events");
  addMetric(
    "Trackpad input",
    wheelInputMode === "two-finger-pan"
      ? "Two-finger pan"
      : wheelInputMode === "pinch-zoom"
        ? "Pinch zoom"
        : "Ready",
  );
  addMetric("Inertial pan", inertialPan.isActive ? "Active" : "Idle");
  addMetric("Viewport geometry reads", integerFormat.format(viewportGeometryReadCount));
  if (metrics.adapterDescription) addMetric("Adapter", metrics.adapterDescription);
}

function scheduleBackendRecovery(backend: GalaxyLabBackend, reason: string): void {
  if (backend !== activeBackend || backendRecoveryPending) return;
  const normalizedReason = reason.trim() || `${backend.metrics().label} stopped responding.`;
  if (backend.id === "current-webgl2") {
    backendRecoveryPending = true;
    animateControl.checked = false;
    setStatus(`Compatibility renderer failed: ${normalizedReason}`, true);
    announceGraph(galaxyLabUnavailableAnnouncement());
    simulateLossButton.disabled = true;
    markGalaxyDirty();
    return;
  }
  backendRecoveryPending = true;
  lastRecoveryReason = normalizedReason;
  backendSelect.value = "current-webgl2";
  setStatus(`Recovering with WebGL2. ${normalizedReason}`, true);
  void activateBackend("current-webgl2", normalizedReason).finally(() => {
    backendRecoveryPending = false;
  });
}

function pollBackendHealth(): void {
  const healthBackend = activeBackend;
  const fatalError = healthBackend?.takeFatalError?.() ?? null;
  if (healthBackend && fatalError) scheduleBackendRecovery(healthBackend, fatalError);
}

function renderFrame(timeMs: number): void {
  frameRequest = -1;
  if (!canPresentGalaxy()) {
    frameRequest = 0;
    lastFrameAt = 0;
    viewport.dataset.frameLoop = "idle";
    return;
  }
  const inertialStep = inertialPan.step(timeMs);
  if (inertialStep.deltaX !== 0 || inertialStep.deltaY !== 0) {
    transform.x += inertialStep.deltaX;
    transform.y += inertialStep.deltaY;
    userMovedCamera = true;
    dirty = true;
    metricsDirty = true;
  }
  if (inertialStep.finished) {
    viewport.dataset.inertialPan = "false";
    scheduleSettledViewDetail();
  }
  const settledGeneration = settleScheduler.takeDue(timeMs);
  if (settledGeneration !== null) applySettledViewDetail(settledGeneration);
  if (renderResizePending) resizeActiveBackend();
  pollBackendHealth();
  const shouldRender = Boolean(
    canPresentGalaxy() && activeBackend && (animateControl.checked || dirty),
  );
  if (shouldRender && activeBackend) {
    if (lastFrameAt > 0 && animateControl.checked) {
      frameSamples.push(timeMs - lastFrameAt);
    }
    lastFrameAt = timeMs;
    const submitStartedAt = performance.now();
    const renderingBackend = activeBackend;
    try {
      renderingBackend.render(transform, timeMs);
      submitSamples.push(performance.now() - submitStartedAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      scheduleBackendRecovery(renderingBackend, reason);
    }
    dirty = false;
  } else {
    lastFrameAt = 0;
  }
  if (
    (metricsDirty || animateControl.checked) &&
    shouldRefreshGalaxyLabDiagnostics(cameraInMotion, timeMs - lastMetricsAt)
  ) {
    updateMetrics();
    metricsDirty = false;
    lastMetricsAt = timeMs;
  }
  frameRequest = 0;
  const backendReady = activeBackend !== null;
  if (shouldContinueGalaxyLabFrame(
    backendReady && animateControl.checked,
    backendReady && dirty,
    settleScheduler.isPending || inertialPan.isActive,
    canPresentGalaxy(),
  )) {
    requestGalaxyFrame();
  } else {
    viewport.dataset.frameLoop = "idle";
  }
}

function zoomAt(viewportX: number, viewportY: number, nextScale: number): void {
  cancelInertialPan();
  setCameraInMotion(true);
  applyGalaxyLabResistedZoomAt(
    transform,
    viewportX,
    viewportY,
    nextScale / transform.scale,
    outwardZoomEnvelope.target,
    outwardZoomEnvelope.resistance,
    cameraScaleLimits.maximum,
  );
  userMovedCamera = true;
  markGalaxyDirty();
  scheduleSettledViewDetail();
}

const pointers = new GalaxyLabPointerRoster(8);
let gestureMoved = false;
let gestureInterruptedInertia = false;
let hoverRequest = 0;
let pendingHoverX = 0;
let pendingHoverY = 0;
let pendingHover = false;
let viewportGeometry: GalaxyLabViewportGeometry = galaxyLabViewportGeometry(
  { left: 0, top: 0, width: 1, height: 1 },
  { left: 0, top: 0, width: 1, height: 1 },
);
const eventCanvasPoint: GalaxyLabCanvasPoint = { x: 0, y: 0 };
const contextProjectionMatrix = new Float32Array(16);
const contextProjectionPoint = new Float32Array(2);
const longPressTracker = new GalaxyLabLongPressTracker();
let longPressTimeout = 0;
let lastContextTarget: GalaxyLabContextTarget | null = null;
let lastDetailsRequest: { nodeId: string; source: "keyboard" } | null = null;
let viewportOriginValid = false;
let viewportGeometryReadCount = 0;

function refreshViewportOrigin(): void {
  viewportGeometry = galaxyLabViewportGeometry(
    canvasHost.getBoundingClientRect(),
    viewport.getBoundingClientRect(),
  );
  viewportOriginValid = true;
  viewportGeometryReadCount += 2;
  viewport.dataset.viewportGeometryReads = String(viewportGeometryReadCount);
  viewport.dataset.canvasOffsetX = String(viewportGeometry.interactionLeft);
  viewport.dataset.canvasOffsetY = String(viewportGeometry.interactionTop);
  viewport.dataset.interactionWidth = String(viewportGeometry.interactionWidth);
  viewport.dataset.interactionHeight = String(viewportGeometry.interactionHeight);
}

function ensureViewportOrigin(): void {
  if (!viewportOriginValid) refreshViewportOrigin();
}

function canvasPoint(clientX: number, clientY: number): GalaxyLabCanvasPoint {
  return writeGalaxyLabCanvasPoint(
    eventCanvasPoint,
    viewportGeometry,
    clientX,
    clientY,
  );
}

function clearLongPressTimeout(): void {
  if (longPressTimeout === 0) return;
  window.clearTimeout(longPressTimeout);
  longPressTimeout = 0;
}

function cancelLongPress(): void {
  clearLongPressTimeout();
  longPressTracker.cancel();
  viewport.dataset.longPress = "idle";
}

function requestContextAt(
  canvasX: number,
  canvasY: number,
  source: GalaxyLabContextRequestSource,
  nodeId = activeBackend?.pickNode(canvasX, canvasY) ?? null,
): boolean {
  if (!nodeId) return false;
  const target = galaxyLabContextTarget(
    nodeId,
    source,
    canvasX,
    canvasY,
    transform,
    viewportGeometry,
  );
  if (!target) return false;
  lastContextTarget = target;
  viewport.dataset.contextRequestSource = source;
  viewport.dispatchEvent(
    new CustomEvent<GalaxyLabContextTarget>("friends-galaxy-context-request", {
      bubbles: true,
      detail: target,
    }),
  );
  return true;
}

function requestSelectedContext(): boolean {
  const nodeId = interaction.selectedNodeId;
  if (!nodeId) return false;
  const nodeIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    nodeId,
  );
  if (nodeIndex === null) return false;
  const { width, height } = canvasSize();
  writeGalaxyLabWebGpuViewProjection(
    contextProjectionMatrix,
    transform,
    width,
    height,
  );
  const offset = nodeIndex * 3;
  contextProjectionPoint[0] = Number.NaN;
  contextProjectionPoint[1] = Number.NaN;
  projectGalaxyLabWorldPoint(
    contextProjectionPoint,
    {
      viewProjection: contextProjectionMatrix,
      width,
      height,
    },
    fixture.scene.positions[offset]!,
    fixture.scene.positions[offset + 1]!,
    fixture.scene.positions[offset + 2]!,
  );
  const canvasX = Number.isFinite(contextProjectionPoint[0])
    ? contextProjectionPoint[0]!
    : viewportGeometry.interactionCenterX;
  const canvasY = Number.isFinite(contextProjectionPoint[1])
    ? contextProjectionPoint[1]!
    : viewportGeometry.interactionCenterY;
  return requestContextAt(canvasX, canvasY, "keyboard", nodeId);
}

function requestSelectedDetails(): boolean {
  const nodeId = interaction.selectedNodeId;
  if (!nodeId) return false;
  lastDetailsRequest = { nodeId, source: "keyboard" };
  viewport.dispatchEvent(
    new CustomEvent("friends-galaxy-details-request", {
      bubbles: true,
      detail: lastDetailsRequest,
    }),
  );
  return true;
}

function beginLongPress(pointerId: number, x: number, y: number): void {
  cancelLongPress();
  longPressTracker.begin(pointerId, x, y, performance.now());
  viewport.dataset.longPress = "pending";
  longPressTimeout = window.setTimeout(() => {
    longPressTimeout = 0;
    const activation = longPressTracker.activate(performance.now());
    if (!activation) return;
    gestureMoved = true;
    viewport.dataset.longPress = "activated";
    requestContextAt(activation.x, activation.y, "long-press");
  }, longPressTracker.durationMs);
}

function moveLongPress(pointerId: number, x: number, y: number): boolean {
  if (!longPressTracker.isTracking(pointerId)) return false;
  if (longPressTracker.isActivated) return true;
  if (!longPressTracker.isPending) return false;
  if (longPressTracker.move(pointerId, x, y)) return true;
  clearLongPressTimeout();
  viewport.dataset.longPress = "idle";
  return false;
}

function releaseLongPress(pointerId: number): void {
  longPressTracker.release(pointerId);
  if (longPressTracker.isPending) return;
  clearLongPressTimeout();
  viewport.dataset.longPress = "idle";
}

function updateInteraction(next: GalaxyLabInteraction): boolean {
  if (
    next.selectedNodeId === interaction.selectedNodeId &&
    next.hoveredNodeId === interaction.hoveredNodeId
  ) return false;
  const selectionChanged = next.selectedNodeId !== interaction.selectedNodeId;
  interaction = next;
  activeBackend?.setInteraction(interaction);
  if (selectionChanged) syncGraphDescription();
  markGalaxyDirty();
  return selectionChanged;
}

function scheduleHoverPick(viewportX: number, viewportY: number): void {
  pendingHoverX = viewportX;
  pendingHoverY = viewportY;
  pendingHover = true;
  if (hoverRequest !== 0) return;
  hoverRequest = requestAnimationFrame(() => {
    hoverRequest = 0;
    if (!pendingHover) return;
    if (pointers.count > 0 || inertialPan.isActive) {
      pendingHover = false;
      return;
    }
    pendingHover = false;
    updateInteraction({
      selectedNodeId: interaction.selectedNodeId,
      hoveredNodeId: activeBackend?.pickNode(pendingHoverX, pendingHoverY) ?? null,
    });
  });
}

viewport.addEventListener("pointerdown", (event) => {
  if (nativeTouchInput && event.pointerType === "touch") return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  const interruptedInertia = beginInertialPanSample(event.timeStamp);
  viewport.focus({ preventScroll: true });
  if (pointers.count === 0) {
    refreshViewportOrigin();
    gestureMoved = false;
    gestureInterruptedInertia = interruptedInertia;
  } else {
    gestureInterruptedInertia ||= interruptedInertia;
  }
  const point = canvasPoint(event.clientX, event.clientY);
  const pointerIndex = pointers.begin(
    event.pointerId,
    point.x,
    point.y,
  );
  if (pointerIndex < 0) return;
  if (pointers.count > 1) {
    gestureMoved = true;
    cancelLongPress();
  } else if (event.pointerType === "touch") {
    beginLongPress(event.pointerId, point.x, point.y);
  }
  try {
    viewport.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic touch probes do not have an active browser pointer to capture.
  }
  viewport.dataset.dragging = "true";
});

viewport.addEventListener("pointermove", (event) => {
  if (nativeTouchInput && event.pointerType === "touch") return;
  const pointerIndex = pointers.indexOf(event.pointerId);
  if (pointerIndex < 0) {
    if (event.pointerType === "mouse") {
      ensureViewportOrigin();
      const point = canvasPoint(event.clientX, event.clientY);
      scheduleHoverPick(point.x, point.y);
    }
    return;
  }
  event.preventDefault();
  const point = canvasPoint(event.clientX, event.clientY);
  const nextX = point.x;
  const nextY = point.y;
  if (
    event.pointerType === "touch" &&
    moveLongPress(event.pointerId, nextX, nextY)
  ) {
    pointers.update(pointerIndex, nextX, nextY);
    return;
  }
  setCameraInMotion(true);
  if (pointers.movedBeyond(pointerIndex, nextX, nextY, 4) || pointers.count > 1) {
    gestureMoved = true;
  }
  if (pointers.count >= 2) {
    beginInertialPanSample(event.timeStamp);
    const previousFirstX = pointers.xAt(0);
    const previousFirstY = pointers.yAt(0);
    const previousSecondX = pointers.xAt(1);
    const previousSecondY = pointers.yAt(1);
    pointers.update(pointerIndex, nextX, nextY);
    applyGalaxyLabPinch(
      transform,
      previousFirstX,
      previousFirstY,
      previousSecondX,
      previousSecondY,
      pointers.xAt(0),
      pointers.yAt(0),
      pointers.xAt(1),
      pointers.yAt(1),
      outwardZoomEnvelope.target,
      outwardZoomEnvelope.resistance,
      cameraScaleLimits.maximum,
    );
    scheduleSettledViewDetail();
  } else {
    const deltaX = nextX - pointers.xAt(pointerIndex);
    const deltaY = nextY - pointers.yAt(pointerIndex);
    inertialPan.sample(deltaX, deltaY, event.timeStamp);
    transform.x += deltaX;
    transform.y += deltaY;
    pointers.update(pointerIndex, nextX, nextY);
  }
  userMovedCamera = true;
  markGalaxyDirty();
});

function releasePointer(event: PointerEvent): void {
  if (nativeTouchInput && event.pointerType === "touch") return;
  const pointerIndex = pointers.indexOf(event.pointerId);
  if (pointerIndex < 0) return;
  const activeCountBeforeRelease = pointers.count;
  const point = canvasPoint(event.clientX, event.clientY);
  const releasePointX = point.x;
  const releasePointY = point.y;
  const shouldSelect = event.type === "pointerup" && pointers.count === 1 && !gestureMoved;
  releaseLongPress(event.pointerId);
  pointers.remove(event.pointerId);
  if (viewport.hasPointerCapture(event.pointerId)) {
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may release capture before pointercancel is delivered.
    }
  }
  if (pointers.count === 0) {
    viewport.dataset.dragging = "false";
    if (shouldSelect) {
      const selectedNodeId = activeBackend?.pickNode(releasePointX, releasePointY) ?? null;
      const selectionChanged = updateInteraction({
        selectedNodeId,
        hoveredNodeId: null,
      });
      if (selectionChanged) {
        announceGraphSelection(selectedNodeId, "selection");
        scheduleSettledViewDetail(true);
      } else if (gestureInterruptedInertia) scheduleSettledViewDetail();
    } else if (gestureMoved || event.type === "pointercancel") {
      const inertiaStarted = event.type === "pointerup" &&
        activeCountBeforeRelease === 1 &&
        startInertialPan(event.timeStamp);
      if (!inertiaStarted) scheduleSettledViewDetail();
    }
    gestureMoved = false;
    gestureInterruptedInertia = false;
  } else if (pointers.count === 1) {
    beginInertialPanSample(event.timeStamp);
    settleScheduler.cancel();
  }
}

viewport.addEventListener("pointerup", releasePointer);
viewport.addEventListener("pointercancel", releasePointer);
viewport.addEventListener("pointerenter", () => {
  if (pointers.count === 0) refreshViewportOrigin();
});
viewport.addEventListener("pointerleave", () => {
  if (pointers.count > 0) return;
  pendingHover = false;
  updateInteraction({ selectedNodeId: interaction.selectedNodeId, hoveredNodeId: null });
});

function beginNativeTouches(event: TouchEvent): void {
  event.preventDefault();
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  const interruptedInertia = beginInertialPanSample(event.timeStamp);
  viewport.focus({ preventScroll: true });
  if (pointers.count === 0) {
    refreshViewportOrigin();
    gestureMoved = false;
    gestureInterruptedInertia = interruptedInertia;
  } else {
    gestureInterruptedInertia ||= interruptedInertia;
  }
  let longPressPointerId: number | null = null;
  let longPressX = 0;
  let longPressY = 0;
  for (let index = 0; index < event.changedTouches.length; index += 1) {
    const touch = event.changedTouches.item(index);
    if (!touch) continue;
    const point = canvasPoint(touch.clientX, touch.clientY);
    longPressPointerId = touch.identifier;
    longPressX = point.x;
    longPressY = point.y;
    pointers.begin(
      touch.identifier,
      point.x,
      point.y,
    );
  }
  if (pointers.count > 1) {
    gestureMoved = true;
    cancelLongPress();
  } else if (longPressPointerId !== null) {
    beginLongPress(longPressPointerId, longPressX, longPressY);
  }
  if (pointers.count > 0) viewport.dataset.dragging = "true";
}

function moveNativeTouches(event: TouchEvent): void {
  if (pointers.count === 0) return;
  event.preventDefault();
  const previousFirstX = pointers.xAt(0);
  const previousFirstY = pointers.yAt(0);
  const previousSecondX = pointers.xAt(1);
  const previousSecondY = pointers.yAt(1);
  let suppressLongPressPan = false;
  for (let index = 0; index < event.touches.length; index += 1) {
    const touch = event.touches.item(index);
    if (!touch) continue;
    const pointerIndex = pointers.indexOf(touch.identifier);
    if (pointerIndex < 0) continue;
    const point = canvasPoint(touch.clientX, touch.clientY);
    const nextX = point.x;
    const nextY = point.y;
    suppressLongPressPan ||= moveLongPress(touch.identifier, nextX, nextY);
    if (pointers.movedBeyond(pointerIndex, nextX, nextY, 4)) gestureMoved = true;
    pointers.update(pointerIndex, nextX, nextY);
  }
  if (suppressLongPressPan && pointers.count === 1) return;
  setCameraInMotion(true);
  if (pointers.count >= 2) {
    gestureMoved = true;
    beginInertialPanSample(event.timeStamp);
    applyGalaxyLabPinch(
      transform,
      previousFirstX,
      previousFirstY,
      previousSecondX,
      previousSecondY,
      pointers.xAt(0),
      pointers.yAt(0),
      pointers.xAt(1),
      pointers.yAt(1),
      outwardZoomEnvelope.target,
      outwardZoomEnvelope.resistance,
      cameraScaleLimits.maximum,
    );
    scheduleSettledViewDetail();
  } else {
    const deltaX = pointers.xAt(0) - previousFirstX;
    const deltaY = pointers.yAt(0) - previousFirstY;
    inertialPan.sample(deltaX, deltaY, event.timeStamp);
    transform.x += deltaX;
    transform.y += deltaY;
  }
  userMovedCamera = true;
  markGalaxyDirty();
}

function endNativeTouches(event: TouchEvent): void {
  event.preventDefault();
  const activeCountBeforeRelease = pointers.count;
  const releaseTouch = event.changedTouches.item(0);
  const shouldSelect = event.type === "touchend" &&
    activeCountBeforeRelease === 1 &&
    !gestureMoved &&
    releaseTouch !== null;
  for (let index = 0; index < event.changedTouches.length; index += 1) {
    const touch = event.changedTouches.item(index);
    if (touch) {
      releaseLongPress(touch.identifier);
      pointers.remove(touch.identifier);
    }
  }
  if (pointers.count > 0) {
    beginInertialPanSample(event.timeStamp);
    settleScheduler.cancel();
    return;
  }
  viewport.dataset.dragging = "false";
  if (shouldSelect && releaseTouch) {
    const point = canvasPoint(releaseTouch.clientX, releaseTouch.clientY);
    const selectedNodeId = activeBackend?.pickNode(point.x, point.y) ?? null;
    const selectionChanged = updateInteraction({
      selectedNodeId,
      hoveredNodeId: null,
    });
    if (selectionChanged) {
      announceGraphSelection(selectedNodeId, "selection");
      scheduleSettledViewDetail(true);
    } else if (gestureInterruptedInertia) scheduleSettledViewDetail();
  } else if (gestureMoved) {
    const inertiaStarted = event.type === "touchend" &&
      activeCountBeforeRelease === 1 &&
      startInertialPan(event.timeStamp);
    if (!inertiaStarted) scheduleSettledViewDetail();
  }
  gestureMoved = false;
  gestureInterruptedInertia = false;
}

function cancelNativeTouches(event: TouchEvent): void {
  event.preventDefault();
  cancelLongPress();
  pointers.clear();
  cancelInertialPan();
  viewport.dataset.dragging = "false";
  gestureMoved = false;
  gestureInterruptedInertia = false;
  scheduleSettledViewDetail();
}

viewport.addEventListener("touchstart", beginNativeTouches, { passive: false });
viewport.addEventListener("touchmove", moveNativeTouches, { passive: false });
viewport.addEventListener("touchend", endNativeTouches, { passive: false });
viewport.addEventListener("touchcancel", cancelNativeTouches, { passive: false });

viewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  cancelInertialPan();
  refreshViewportOrigin();
  const point = canvasPoint(event.clientX, event.clientY);
  requestContextAt(point.x, point.y, "pointer");
});

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (safariGestureActive) return;
  const interruptedInertia = cancelInertialPan();
  if (!cameraInMotion) refreshViewportOrigin();
  else ensureViewportOrigin();
  if (event.ctrlKey) {
    wheelInputMode = "pinch-zoom";
    viewport.dataset.wheelInputMode = wheelInputMode;
    const point = canvasPoint(event.clientX, event.clientY);
    zoomAt(
      point.x,
      point.y,
      transform.scale * Math.exp(-event.deltaY * 0.012),
    );
    return;
  }
  const deltaX = galaxyLabWheelDeltaPixels(
    event.deltaX,
    event.deltaMode,
    viewportGeometry.interactionWidth,
  );
  const deltaY = galaxyLabWheelDeltaPixels(
    event.deltaY,
    event.deltaMode,
    viewportGeometry.interactionHeight,
  );
  if (deltaX === 0 && deltaY === 0) {
    if (interruptedInertia) scheduleSettledViewDetail();
    return;
  }
  wheelInputMode = "two-finger-pan";
  viewport.dataset.wheelInputMode = wheelInputMode;
  setCameraInMotion(true);
  transform.x -= deltaX;
  transform.y -= deltaY;
  userMovedCamera = true;
  markGalaxyDirty();
  scheduleSettledViewDetail();
}, { passive: false });

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

let safariGestureStartScale = transform.scale;
let safariGestureActive = false;
let safariGestureWorldX = 0;
let safariGestureWorldY = 0;
let safariGestureCanvasLeft = 0;
let safariGestureCanvasTop = 0;

function stopGalaxyFrameLoop(): void {
  if (frameRequest > 0) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  lastFrameAt = 0;
  viewport.dataset.frameLoop = "idle";
}

function suspendGalaxyTransientWork(): void {
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  cancelLongPress();
  pointers.clear();
  cancelInertialPan();
  safariGestureActive = false;
  gestureMoved = false;
  gestureInterruptedInertia = false;
  pendingHover = false;
  if (hoverRequest > 0) cancelAnimationFrame(hoverRequest);
  hoverRequest = 0;
  viewport.dataset.dragging = "false";
  if (interaction.hoveredNodeId !== null) {
    updateInteraction({
      selectedNodeId: interaction.selectedNodeId,
      hoveredNodeId: null,
    });
  }
  setCameraInMotion(false);
  stopGalaxyFrameLoop();
}

function setGalaxyPresentationVisible(next: boolean): void {
  if (next === presentationVisible) return;
  presentationVisible = next;
  viewport.dataset.presentationVisible = String(next);
  canvasHost.dataset.presentationVisible = String(next);
  if (!next) {
    viewport.inert = true;
    viewport.setAttribute("aria-hidden", "true");
    if (document.activeElement === viewport) viewport.blur();
    suspendGalaxyTransientWork();
    return;
  }
  viewport.inert = false;
  viewport.removeAttribute("aria-hidden");
  refreshViewportOrigin();
  const { width, height } = canvasSize();
  refreshCameraScaleLimits(height);
  refreshOutwardZoomEnvelope(fittedGalaxyScale(width, height));
  renderResizePending = true;
  viewport.dataset.renderResizePending = "true";
  dirty = true;
  metricsDirty = true;
  scheduleSettledViewDetail();
  requestGalaxyFrame();
}

viewport.addEventListener("gesturestart", ((event: SafariGestureEvent) => {
  event.preventDefault();
  cancelInertialPan();
  wheelInputMode = "pinch-zoom";
  viewport.dataset.wheelInputMode = wheelInputMode;
  setCameraInMotion(true);
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  safariGestureStartScale = transform.scale;
  refreshViewportOrigin();
  safariGestureCanvasLeft = viewportGeometry.canvasClientLeft;
  safariGestureCanvasTop = viewportGeometry.canvasClientTop;
  const viewportX = event.clientX - safariGestureCanvasLeft;
  const viewportY = event.clientY - safariGestureCanvasTop;
  safariGestureWorldX = (viewportX - transform.x) / transform.scale;
  safariGestureWorldY = (viewportY - transform.y) / transform.scale;
  safariGestureActive = true;
}) as EventListener, { passive: false });

viewport.addEventListener("gesturechange", ((event: SafariGestureEvent) => {
  event.preventDefault();
  if (!safariGestureActive) return;
  const viewportX = event.clientX - safariGestureCanvasLeft;
  const viewportY = event.clientY - safariGestureCanvasTop;
  const nextScale = galaxyLabResistedScaleAtRatio(
    safariGestureStartScale,
    event.scale,
    outwardZoomEnvelope.target,
    outwardZoomEnvelope.resistance,
    cameraScaleLimits.maximum,
  );
  transform.scale = nextScale;
  transform.x = viewportX - safariGestureWorldX * nextScale;
  transform.y = viewportY - safariGestureWorldY * nextScale;
  userMovedCamera = true;
  markGalaxyDirty();
  scheduleSettledViewDetail();
}) as EventListener, { passive: false });

viewport.addEventListener("gestureend", ((event: SafariGestureEvent) => {
  event.preventDefault();
  safariGestureActive = false;
  scheduleSettledViewDetail();
}) as EventListener, { passive: false });

viewport.addEventListener("dblclick", () => fitGalaxy());
viewport.addEventListener("keydown", (event) => {
  const command = galaxyLabKeyboardCommand(event);
  if (!command) return;
  let available = true;
  let interactionSettled = false;
  switch (command.type) {
    case "pan":
      transform.x += command.deltaX;
      transform.y += command.deltaY;
      break;
    case "zoom":
      zoomAt(
        viewportGeometry.interactionCenterX,
        viewportGeometry.interactionCenterY,
        transform.scale * command.ratio,
      );
      break;
    case "fit":
      fitGalaxy();
      break;
    case "details":
      available = requestSelectedDetails();
      break;
    case "context-menu":
      available = requestSelectedContext();
      break;
    case "clear":
      if (updateInteraction({ selectedNodeId: null, hoveredNodeId: null })) {
        announceGraphSelection(null, "selection");
        scheduleSettledViewDetail(true);
        interactionSettled = true;
      }
      break;
  }
  if (!available) return;
  const interruptedInertia = cancelInertialPan();
  event.preventDefault();
  if (command.type === "pan") {
    userMovedCamera = true;
    setCameraInMotion(true);
    scheduleSettledViewDetail();
  } else if (
    interruptedInertia &&
    command.type === "clear" &&
    !interactionSettled
  ) {
    scheduleSettledViewDetail();
  }
  markGalaxyDirty();
});
fitButton.addEventListener("click", () => fitGalaxy());

function galaxyDiagnosticSnapshot() {
  const { width, height } = canvasSize();
  return createGalaxyLabDiagnosticSnapshot({
    capturedAt: new Date().toISOString(),
    receipt: fixtureWorkerReceipt,
    personCount: fixture.personCount,
    accountCount: fixture.accountCount,
    backgroundStarCount: fixture.backgroundStarCount,
    backend: activeBackend?.metrics() ?? null,
    theme: activeTheme,
    fieldStyle: activeFieldStyle,
    transform,
    cameraScaleLimits,
    outwardZoomEnvelope,
    viewportWidth: width,
    viewportHeight: height,
    cameraInMotion,
    selectionActive: interaction.selectedNodeId !== null,
    hoverActive: interaction.hoveredNodeId !== null,
    touchInputMode: nativeTouchInput ? "Native Touch Events" : "Pointer Events",
    wheelInputMode,
    inertialPanActive: inertialPan.isActive,
    presentationVisible,
    frameLoop: viewport.dataset.frameLoop ?? "unknown",
    settlePending: settleScheduler.isPending,
    renderResizePending,
    recoveryReason: lastRecoveryReason,
    longTasks: longTaskMonitor.snapshot(),
    frame: frameStats(frameSamples.snapshot()),
    submit: frameStats(submitSamples.snapshot()),
    activityPatchKeyCount: activityProbeSummaryPatch.patches.length,
    activityPatchNodeCount: activityProbeScenePatch.nodeIndices.length,
    unknownActivitySourceCount: activityProbeScenePatch.unknownSources.length,
    avatarRequestedCount: avatarAdmissionResult.requestedNodeCount,
    avatarReadyCount: avatarAdmissionResult.readyNodeCount,
    avatarFailureCount: avatarAdmissionResult.failedSourceCount,
  });
}

copyDiagnosticsButton.addEventListener("click", () => {
  const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  if (!writeText) {
    setStatus("Clipboard access is unavailable", true);
    announceGraph("Clipboard access is unavailable.");
    return;
  }
  copyDiagnosticsButton.disabled = true;
  void writeText(serializeGalaxyLabDiagnosticSnapshot(galaxyDiagnosticSnapshot()))
    .then(() => {
      setStatus("Diagnostics copied");
      announceGraph("Diagnostics copied.");
    })
    .catch(() => {
      setStatus("Diagnostics could not be copied", true);
      announceGraph("Diagnostics could not be copied.");
    })
    .finally(() => {
      copyDiagnosticsButton.disabled = false;
    });
});

simulateLossButton.addEventListener("click", () => {
  const backend = activeBackend;
  if (!backend?.simulateDeviceLoss) return;
  simulateLossButton.disabled = true;
  setStatus(`Testing recovery from ${backend.metrics().label}`);
  backend.simulateDeviceLoss();
});

backendSelect.addEventListener("change", () => {
  backendRecoveryPending = false;
  void activateBackend(backendSelect.value as GalaxyLabBackendId);
});

themeSelect.addEventListener("change", () => {
  activeTheme = themeSelect.value as GalaxyLabThemeId;
  const palette = paletteForTheme();
  applyDocumentPalette(palette);
  activeBackend?.setPalette(palette);
  markGalaxyDirty();
});

fieldStyleSelect.addEventListener("change", () => {
  activeFieldStyle = fieldStyleSelect.value as GalaxyLabFieldStyle;
  activeBackend?.setFieldStyle?.(activeFieldStyle);
  markGalaxyDirty();
});

animateControl.addEventListener("change", () => {
  animatePreferenceTouched = true;
  activeBackend?.setAnimationEnabled?.(animateControl.checked);
  resetSamples();
  markGalaxyDirty();
});

function syncReducedMotionPreference(): void {
  if (reducedMotionQuery.matches && inertialPan.isActive) {
    cancelInertialPan();
    scheduleSettledViewDetail();
  }
  syncGraphDescription();
  if (animatePreferenceTouched || animationProbeDisabled) return;
  animateControl.checked = !reducedMotionQuery.matches;
  activeBackend?.setAnimationEnabled?.(animateControl.checked);
  resetSamples();
  markGalaxyDirty();
}

reducedMotionQuery.addEventListener("change", syncReducedMotionPreference);

const resizeObserver = new ResizeObserver(() => {
  cancelInertialPan();
  const previousGeometry = viewportGeometry;
  refreshViewportOrigin();
  resizeActiveBackend();
  const { width, height } = canvasSize();
  refreshCameraScaleLimits(height);
  refreshOutwardZoomEnvelope(fittedGalaxyScale(width, height));
  if (!userMovedCamera) {
    frameInitialGalaxy();
  } else {
    reanchorGalaxyLabTransformToInteraction(
      transform,
      previousGeometry,
      viewportGeometry,
    );
    const safeResizeScale = Math.max(
      outwardZoomEnvelope.target,
      Math.min(cameraScaleLimits.maximum, transform.scale),
    );
    if (safeResizeScale !== transform.scale) {
      applyGalaxyLabZoomAt(
        transform,
        viewportGeometry.interactionCenterX,
        viewportGeometry.interactionCenterY,
        safeResizeScale,
        outwardZoomEnvelope.target,
        cameraScaleLimits.maximum,
      );
      recordCameraScaleDiagnostics();
    }
    scheduleSettledViewDetail(true);
  }
  markGalaxyDirty();
});
resizeObserver.observe(canvasHost);
resizeObserver.observe(viewport);

const backendHealthPoll = window.setInterval(() => {
  pollBackendHealth();
  if (
    canPresentGalaxy() && activeBackend &&
    (animateControl.checked || (metricsDirty && !cameraInMotion))
  ) requestGalaxyFrame();
}, 250);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    suspendGalaxyTransientWork();
    return;
  }
  if (!presentationVisible) return;
  scheduleSettledViewDetail(true);
  requestGalaxyFrame();
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameRequest);
  cancelAnimationFrame(hoverRequest);
  cancelLongPress();
  clearInterval(backendHealthPoll);
  settleScheduler.cancel();
  cancelInertialPan();
  reducedMotionQuery.removeEventListener("change", syncReducedMotionPreference);
  resizeObserver.disconnect();
  avatarImageAdmission.dispose();
  longTaskMonitor.dispose();
  activeBackend?.dispose();
});

Object.assign(window, {
  __FRIENDS_GALAXY_LAB__: {
    fixture,
    diagnostics: galaxyDiagnosticSnapshot,
    focusNode: focusGalaxyNode,
    setPresentationVisible: setGalaxyPresentationVisible,
    state: () => ({
      backend: activeBackend?.metrics() ?? null,
      transform: { ...transform },
      viewportGeometry: {
        ...viewportGeometry,
        insets: { ...viewportGeometry.insets },
      },
      cameraScaleLimits: { ...cameraScaleLimits },
      outwardZoomEnvelope: { ...outwardZoomEnvelope },
      zoomResistanceActive: transform.scale < outwardZoomEnvelope.resistance,
      interaction: { ...interaction },
      overlayRequests: {
        context: lastContextTarget ? { ...lastContextTarget } : null,
        details: lastDetailsRequest ? { ...lastDetailsRequest } : null,
        longPressPending: longPressTracker.isPending,
        longPressActivated: longPressTracker.isActivated,
      },
      fieldStyle: activeFieldStyle,
      activityProbe: {
        summaryRevision: activityProbeSummaryPatch.revision,
        summaryPatchCount: activityProbeSummaryPatch.patches.length,
        sceneNodeCount: activityProbeScenePatch.nodeIndices.length,
        unknownSourceCount: activityProbeScenePatch.unknownSources.length,
      },
      avatarAdmission: {
        requestedNodeCount: avatarAdmissionResult.requestedNodeCount,
        readyNodeCount: avatarAdmissionResult.readyNodeCount,
        failedSourceCount: avatarAdmissionResult.failedSourceCount,
        cachedSourceCount: avatarAdmissionResult.cachedSourceCount,
        applyCount: avatarAdmissionApplyCount,
        reuseCount: avatarAdmissionReuseCount,
      },
      recoveryReason: lastRecoveryReason,
      viewportGeometryReadCount,
      wheelInputMode,
      presentationVisible,
      inertialPan: {
        active: inertialPan.isActive,
        velocityX: inertialPan.currentVelocityX,
        velocityY: inertialPan.currentVelocityY,
      },
      frameLoop: viewport.dataset.frameLoop,
      longTasks: longTaskMonitor.snapshot(),
      renderResizePending,
      settlePending: settleScheduler.isPending,
      startup: {
        workerOnly: true,
        ...fixtureWorkerReceipt,
      },
      frame: frameStats(frameSamples.snapshot()),
      submit: frameStats(submitSamples.snapshot()),
    }),
  },
});

refreshViewportOrigin();
applyDocumentPalette(paletteForTheme());
syncGraphDescription();
frameInitialGalaxy();
void activateBackend(backendSelect.value as GalaxyLabBackendId);
requestGalaxyFrame();
