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
  applyGalaxyLabZoomAt,
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
import {
  galaxyLabSelectedPersonNodeId,
  selectGalaxyLabAvatars,
} from "./avatar-atlas.js";
import {
  GalaxyLabAvatarImageAdmission,
  type GalaxyLabAvatarImageAdmissionResult,
} from "./avatar-image-admission.js";
import { galaxyLabInitialCameraScale } from "./camera-math.js";
import { shouldContinueGalaxyLabFrame } from "./frame-loop.js";
import { GalaxyLabPointerRoster } from "./pointer-roster.js";
import {
  GalaxyLabSampleRing,
  shouldRefreshGalaxyLabDiagnostics,
} from "./sample-ring.js";
import { GalaxyLabSettleScheduler } from "./settle-scheduler.js";

const DEFAULT_PERSON_COUNT = 5_000;
const DEFAULT_ACCOUNT_COUNT = 25_000;
const DEFAULT_BACKGROUND_COUNT = 100_000;
const MIN_SCALE = 0.035;
const MAX_SCALE = 6;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const scaleFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });
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
const backendSelect = requiredElement<HTMLSelectElement>("backend");
const themeSelect = requiredElement<HTMLSelectElement>("theme");
const fieldStyleSelect = requiredElement<HTMLSelectElement>("field-style");
const fitButton = requiredElement<HTMLButtonElement>("fit");
const simulateLossButton = requiredElement<HTMLButtonElement>("simulate-loss");
const animateControl = requiredElement<HTMLInputElement>("animate");
const statusElement = requiredElement<HTMLElement>("status");
const metricsElement = requiredElement<HTMLElement>("metrics");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
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
viewport.dataset.cameraMotion = "false";
viewport.dataset.frameLoop = "idle";
const settleScheduler = new GalaxyLabSettleScheduler();
const frameSamples = new GalaxyLabSampleRing(240);
const submitSamples = new GalaxyLabSampleRing(240);
const nodeLabelById = new Map(fixture.atlas.nodes.map((node) => [node.id, node.label]));
let interaction: GalaxyLabInteraction = { selectedNodeId: null, hoveredNodeId: null };
let avatarAdmissionGeneration = 0;
const emptyAvatarImages = new Map<string, CanvasImageSource>();
const avatarAdmissionState = new GalaxyLabAvatarAdmissionState<GalaxyLabBackend>();
let avatarAdmissionApplyCount = 0;
let avatarAdmissionReuseCount = 0;
let avatarAdmissionResult: GalaxyLabAvatarImageAdmissionResult = {
  images: emptyAvatarImages,
  requestedNodeCount: 0,
  readyNodeCount: 0,
  failedSourceCount: 0,
  cachedSourceCount: 0,
};

function requestGalaxyFrame(): void {
  if (frameRequest !== 0) return;
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

function viewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, viewport.clientWidth),
    height: Math.max(1, viewport.clientHeight),
  };
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
  const { width, height } = viewportSize();
  activeBackend?.resize(
    width,
    height,
    galaxyLabRenderPixelRatio(effectiveDevicePixelRatio(), width, cameraInMotion),
  );
  recordActiveRenderDensity();
}

function setCameraInMotion(next: boolean): void {
  if (next === cameraInMotion) return;
  cameraInMotion = next;
  viewport.dataset.cameraMotion = String(next);
  activeBackend?.setCameraMotion?.(next);
  resizeActiveBackend();
  markGalaxyDirty();
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
  if (!backend.setAvatarImages) return;
  const compact = viewportSize().width < 720;
  const selectedPersonNodeId = galaxyLabSelectedPersonNodeId(
    fixture,
    interaction.selectedNodeId,
  );
  const admissionKey = detail === "close"
    ? `close:${compact ? "compact" : "wide"}:${selectedPersonNodeId ?? "none"}`
    : "hidden";
  const admissionStart = avatarAdmissionState.begin(backend, admissionKey, generation);
  if (admissionStart !== "start") {
    avatarAdmissionReuseCount += 1;
    return;
  }
  const result = detail === "close"
    ? await avatarImageAdmission.admit(selectGalaxyLabAvatars(
      fixture,
      paletteForTheme(),
      interaction.selectedNodeId,
      compact,
      detail,
    ).map((avatar) => ({
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

function applySettledViewDetail(generation: number): void {
  setCameraInMotion(false);
  const backend = activeBackend;
  if (!backend) return;
  const detail = viewDetailForScale(transform.scale);
  backend.setViewDetail(detail);
  void admitSettledAvatarImages(backend, detail, generation);
  markGalaxyDirty();
}

function scheduleSettledViewDetail(immediate = false): void {
  const generation = ++avatarAdmissionGeneration;
  if (immediate) {
    settleScheduler.cancel();
    applySettledViewDetail(generation);
    return;
  }
  settleScheduler.schedule(generation, performance.now());
  requestGalaxyFrame();
}

function frameGalaxy(markAsUserAction: boolean, useInitialScale: boolean): void {
  const { width, height } = viewportSize();
  const bounds = fixture.atlas.bounds;
  const worldWidth = Math.max(1, bounds.right - bounds.left);
  const worldHeight = Math.max(1, bounds.bottom - bounds.top);
  const padding = width < 640 ? 42 : 96;
  const fittedScale = Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, Math.min((width - padding * 2) / worldWidth, (height - padding * 2) / worldHeight)),
  );
  const nextScale = useInitialScale
    ? Math.min(MAX_SCALE, galaxyLabInitialCameraScale(fittedScale, width))
    : fittedScale;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  transform.scale = nextScale;
  transform.x = width / 2 - centerX * nextScale;
  transform.y = height / 2 - centerY * nextScale;
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
  viewport.prepend(canvas);
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
    backend.setViewDetail(detail);
    backend.setInteraction(interaction);
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
    "Cosmic field",
    typeof activeBackend.setFieldStyle === "function"
      ? fieldStyleSelect.selectedOptions[0]?.textContent ?? activeFieldStyle
      : "Backend default",
  );
  addMetric("Draw calls", metrics.drawCalls === null ? "Not exposed" : integerFormat.format(metrics.drawCalls));
  addMetric("Submission", metrics.submissionMode ?? "Direct draws");
  addMetric("Billboard labels", integerFormat.format(metrics.labelCount));
  addMetric("Avatar atlas", integerFormat.format(metrics.avatarCount));
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
  addMetric("Settled detail", viewDetailForScale(transform.scale));
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
  const settledGeneration = settleScheduler.takeDue(timeMs);
  if (settledGeneration !== null) applySettledViewDetail(settledGeneration);
  pollBackendHealth();
  const shouldRender = Boolean(activeBackend && (animateControl.checked || dirty));
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
    settleScheduler.isPending,
  )) {
    requestGalaxyFrame();
  } else {
    viewport.dataset.frameLoop = "idle";
  }
}

function zoomAt(viewportX: number, viewportY: number, nextScale: number): void {
  setCameraInMotion(true);
  applyGalaxyLabZoomAt(
    transform,
    viewportX,
    viewportY,
    nextScale,
    MIN_SCALE,
    MAX_SCALE,
  );
  userMovedCamera = true;
  markGalaxyDirty();
  scheduleSettledViewDetail();
}

const pointers = new GalaxyLabPointerRoster(8);
let gestureMoved = false;
let hoverRequest = 0;
let pendingHoverX = 0;
let pendingHoverY = 0;
let pendingHover = false;
let viewportClientLeft = 0;
let viewportClientTop = 0;
let viewportOriginValid = false;
let viewportGeometryReadCount = 0;

function refreshViewportOrigin(): void {
  const bounds = viewport.getBoundingClientRect();
  viewportClientLeft = bounds.left;
  viewportClientTop = bounds.top;
  viewportOriginValid = true;
  viewportGeometryReadCount += 1;
  viewport.dataset.viewportGeometryReads = String(viewportGeometryReadCount);
}

function ensureViewportOrigin(): void {
  if (!viewportOriginValid) refreshViewportOrigin();
}

function updateInteraction(next: GalaxyLabInteraction): void {
  if (
    next.selectedNodeId === interaction.selectedNodeId &&
    next.hoveredNodeId === interaction.hoveredNodeId
  ) return;
  const selectionChanged = next.selectedNodeId !== interaction.selectedNodeId;
  interaction = next;
  activeBackend?.setInteraction(interaction);
  if (selectionChanged && viewDetailForScale(transform.scale) === "close") {
    scheduleSettledViewDetail(true);
  }
  markGalaxyDirty();
}

function scheduleHoverPick(viewportX: number, viewportY: number): void {
  pendingHoverX = viewportX;
  pendingHoverY = viewportY;
  pendingHover = true;
  if (hoverRequest !== 0) return;
  hoverRequest = requestAnimationFrame(() => {
    hoverRequest = 0;
    if (!pendingHover) return;
    if (pointers.count > 0) {
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
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  viewport.focus({ preventScroll: true });
  if (pointers.count === 0) {
    refreshViewportOrigin();
    gestureMoved = false;
  }
  const pointerIndex = pointers.begin(
    event.pointerId,
    event.clientX - viewportClientLeft,
    event.clientY - viewportClientTop,
  );
  if (pointerIndex < 0) return;
  if (pointers.count > 1) gestureMoved = true;
  try {
    viewport.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic touch probes do not have an active browser pointer to capture.
  }
  viewport.dataset.dragging = "true";
});

viewport.addEventListener("pointermove", (event) => {
  const pointerIndex = pointers.indexOf(event.pointerId);
  if (pointerIndex < 0) {
    if (event.pointerType === "mouse") {
      ensureViewportOrigin();
      scheduleHoverPick(
        event.clientX - viewportClientLeft,
        event.clientY - viewportClientTop,
      );
    }
    return;
  }
  event.preventDefault();
  setCameraInMotion(true);
  const nextX = event.clientX - viewportClientLeft;
  const nextY = event.clientY - viewportClientTop;
  if (pointers.movedBeyond(pointerIndex, nextX, nextY, 4) || pointers.count > 1) {
    gestureMoved = true;
  }
  if (pointers.count >= 2) {
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
      MIN_SCALE,
      MAX_SCALE,
    );
    scheduleSettledViewDetail();
  } else {
    transform.x += nextX - pointers.xAt(pointerIndex);
    transform.y += nextY - pointers.yAt(pointerIndex);
    pointers.update(pointerIndex, nextX, nextY);
  }
  userMovedCamera = true;
  markGalaxyDirty();
});

function releasePointer(event: PointerEvent): void {
  const pointerIndex = pointers.indexOf(event.pointerId);
  if (pointerIndex < 0) return;
  const releasePointX = event.clientX - viewportClientLeft;
  const releasePointY = event.clientY - viewportClientTop;
  const shouldSelect = event.type === "pointerup" && pointers.count === 1 && !gestureMoved;
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
      updateInteraction({
        selectedNodeId: activeBackend?.pickNode(releasePointX, releasePointY) ?? null,
        hoveredNodeId: null,
      });
      scheduleSettledViewDetail();
    } else if (gestureMoved || event.type === "pointercancel") {
      scheduleSettledViewDetail();
    }
    gestureMoved = false;
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

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!cameraInMotion) refreshViewportOrigin();
  else ensureViewportOrigin();
  const sensitivity = event.ctrlKey ? 0.012 : 0.0024;
  zoomAt(
    event.clientX - viewportClientLeft,
    event.clientY - viewportClientTop,
    transform.scale * Math.exp(-event.deltaY * sensitivity),
  );
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
let safariGestureViewportLeft = 0;
let safariGestureViewportTop = 0;

viewport.addEventListener("gesturestart", ((event: SafariGestureEvent) => {
  event.preventDefault();
  setCameraInMotion(true);
  avatarAdmissionGeneration += 1;
  settleScheduler.cancel();
  safariGestureStartScale = transform.scale;
  refreshViewportOrigin();
  safariGestureViewportLeft = viewportClientLeft;
  safariGestureViewportTop = viewportClientTop;
  const viewportX = event.clientX - safariGestureViewportLeft;
  const viewportY = event.clientY - safariGestureViewportTop;
  safariGestureWorldX = (viewportX - transform.x) / transform.scale;
  safariGestureWorldY = (viewportY - transform.y) / transform.scale;
  safariGestureActive = true;
}) as EventListener, { passive: false });

viewport.addEventListener("gesturechange", ((event: SafariGestureEvent) => {
  event.preventDefault();
  if (!safariGestureActive) return;
  const viewportX = event.clientX - safariGestureViewportLeft;
  const viewportY = event.clientY - safariGestureViewportTop;
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, safariGestureStartScale * event.scale));
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
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const panStep = event.shiftKey ? 120 : 56;
  let handled = true;
  switch (event.key) {
    case "ArrowLeft":
      transform.x += panStep;
      break;
    case "ArrowRight":
      transform.x -= panStep;
      break;
    case "ArrowUp":
      transform.y += panStep;
      break;
    case "ArrowDown":
      transform.y -= panStep;
      break;
    case "+":
    case "=": {
      const { width, height } = viewportSize();
      zoomAt(width * 0.5, height * 0.5, transform.scale * 1.18);
      break;
    }
    case "-":
    case "_": {
      const { width, height } = viewportSize();
      zoomAt(width * 0.5, height * 0.5, transform.scale / 1.18);
      break;
    }
    case "Home":
    case "0":
      fitGalaxy();
      break;
    case "Escape":
      updateInteraction({ selectedNodeId: null, hoveredNodeId: null });
      break;
    default:
      handled = false;
  }
  if (!handled) return;
  event.preventDefault();
  if (event.key.startsWith("Arrow")) userMovedCamera = true;
  markGalaxyDirty();
});
fitButton.addEventListener("click", () => fitGalaxy());

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
  if (animatePreferenceTouched || animationProbeDisabled) return;
  animateControl.checked = !reducedMotionQuery.matches;
  activeBackend?.setAnimationEnabled?.(animateControl.checked);
  resetSamples();
  markGalaxyDirty();
}

reducedMotionQuery.addEventListener("change", syncReducedMotionPreference);

const resizeObserver = new ResizeObserver(() => {
  refreshViewportOrigin();
  resizeActiveBackend();
  if (!userMovedCamera) frameInitialGalaxy();
  else scheduleSettledViewDetail(true);
  markGalaxyDirty();
});
resizeObserver.observe(viewport);

const backendHealthPoll = window.setInterval(() => {
  pollBackendHealth();
  if (
    document.visibilityState === "visible" && activeBackend &&
    (animateControl.checked || (metricsDirty && !cameraInMotion))
  ) requestGalaxyFrame();
}, 250);

document.addEventListener("visibilitychange", () => {
  lastFrameAt = 0;
  if (document.visibilityState === "visible") markGalaxyDirty();
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameRequest);
  cancelAnimationFrame(hoverRequest);
  clearInterval(backendHealthPoll);
  settleScheduler.cancel();
  reducedMotionQuery.removeEventListener("change", syncReducedMotionPreference);
  resizeObserver.disconnect();
  avatarImageAdmission.dispose();
  activeBackend?.dispose();
});

Object.assign(window, {
  __FRIENDS_GALAXY_LAB__: {
    fixture,
    state: () => ({
      backend: activeBackend?.metrics() ?? null,
      transform: { ...transform },
      interaction: { ...interaction },
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
      frameLoop: viewport.dataset.frameLoop,
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

applyDocumentPalette(paletteForTheme());
frameInitialGalaxy();
void activateBackend(backendSelect.value as GalaxyLabBackendId);
requestGalaxyFrame();
