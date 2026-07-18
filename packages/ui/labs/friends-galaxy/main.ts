import "./styles.css";
import {
  frameStats,
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
import { selectGalaxyLabAvatars } from "./avatar-atlas.js";
import {
  GalaxyLabAvatarImageAdmission,
  type GalaxyLabAvatarImageAdmissionResult,
} from "./avatar-image-admission.js";

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
let userMovedCamera = false;
let settledDetailTimer = 0;
const frameSamples: number[] = [];
const submitSamples: number[] = [];
const nodeLabelById = new Map(fixture.atlas.nodes.map((node) => [node.id, node.label]));
let interaction: GalaxyLabInteraction = { selectedNodeId: null, hoveredNodeId: null };
let avatarAdmissionGeneration = 0;
let avatarAdmissionResult: GalaxyLabAvatarImageAdmissionResult = {
  images: new Map(),
  requestedNodeCount: 0,
  readyNodeCount: 0,
  failedSourceCount: 0,
  cachedSourceCount: 0,
};

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
  if (detail !== "close") {
    if (generation !== avatarAdmissionGeneration || backend !== activeBackend) return;
    avatarAdmissionResult = {
      images: new Map(),
      requestedNodeCount: 0,
      readyNodeCount: 0,
      failedSourceCount: 0,
      cachedSourceCount: avatarAdmissionResult.cachedSourceCount,
    };
    backend.setAvatarImages(avatarAdmissionResult.images);
    return;
  }
  const compact = viewportSize().width < 720;
  const requests = selectGalaxyLabAvatars(
    fixture,
    paletteForTheme(),
    interaction.selectedNodeId,
    compact,
    detail,
  ).map((avatar) => ({
    nodeId: avatar.nodeId,
    sourceKey: `lab-local-avatar-v1:${avatar.nodeId}`,
  }));
  const result = await avatarImageAdmission.admit(requests);
  if (
    generation !== avatarAdmissionGeneration ||
    backend !== activeBackend ||
    viewDetailForScale(transform.scale) !== "close" ||
    pointers.size > 0 ||
    safariGestureWorldPoint !== null
  ) return;
  avatarAdmissionResult = result;
  backend.setAvatarImages(result.images);
  dirty = true;
}

function scheduleSettledViewDetail(immediate = false): void {
  const generation = ++avatarAdmissionGeneration;
  window.clearTimeout(settledDetailTimer);
  const apply = () => {
    const backend = activeBackend;
    if (!backend) return;
    const detail = viewDetailForScale(transform.scale);
    backend.setViewDetail(detail);
    void admitSettledAvatarImages(backend, detail, generation);
    dirty = true;
  };
  if (immediate) {
    apply();
    return;
  }
  settledDetailTimer = window.setTimeout(apply, 140);
}

function fitGalaxy(markAsUserAction = true): void {
  const { width, height } = viewportSize();
  const bounds = fixture.atlas.bounds;
  const worldWidth = Math.max(1, bounds.right - bounds.left);
  const worldHeight = Math.max(1, bounds.bottom - bounds.top);
  const padding = width < 640 ? 42 : 96;
  const nextScale = Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, Math.min((width - padding * 2) / worldWidth, (height - padding * 2) / worldHeight)),
  );
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  transform.scale = nextScale;
  transform.x = width / 2 - centerX * nextScale;
  transform.y = height / 2 - centerY * nextScale;
  userMovedCamera = markAsUserAction;
  dirty = true;
  scheduleSettledViewDetail(true);
}

function resetSamples(): void {
  frameSamples.length = 0;
  submitSamples.length = 0;
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
    backend.setFieldStyle?.(activeFieldStyle);
    fieldStyleSelect.disabled = typeof backend.setFieldStyle !== "function";
    simulateLossButton.disabled = typeof backend.simulateDeviceLoss !== "function";
    const { width, height } = viewportSize();
    backend.resize(width, height, window.devicePixelRatio || 1);
    const detail = viewDetailForScale(transform.scale);
    backend.setViewDetail(detail);
    backend.setInteraction(interaction);
    backend.applyActivityPatches?.(activityProbeScenePatch);
    const avatarGeneration = ++avatarAdmissionGeneration;
    void admitSettledAvatarImages(backend, detail, avatarGeneration);
    resetSamples();
    dirty = true;
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
  }
  addMetric("Context edges", integerFormat.format(metrics.contextualEdgeCount));
  addMetric(
    "Selection",
    interaction.selectedNodeId ? nodeLabelById.get(interaction.selectedNodeId) ?? "Selected" : "None",
  );
  addMetric("Frame interval", formatFrameStats(frameStats(frameSamples)));
  addMetric("CPU submit", formatFrameStats(frameStats(submitSamples)));
  addMetric("Buffer uploads", integerFormat.format(metrics.bufferUploadCount));
  if (metrics.residentStarUploadCount !== undefined) {
    addMetric("Resident star uploads", integerFormat.format(metrics.residentStarUploadCount));
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
  if (metrics.adapterDescription) addMetric("Adapter", metrics.adapterDescription);
}

function trimSamples(samples: number[]): void {
  if (samples.length > 240) samples.splice(0, samples.length - 240);
}

function scheduleBackendRecovery(backend: GalaxyLabBackend, reason: string): void {
  if (backend !== activeBackend || backendRecoveryPending) return;
  const normalizedReason = reason.trim() || `${backend.metrics().label} stopped responding.`;
  if (backend.id === "current-webgl2") {
    backendRecoveryPending = true;
    animateControl.checked = false;
    setStatus(`Compatibility renderer failed: ${normalizedReason}`, true);
    simulateLossButton.disabled = true;
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

function renderFrame(timeMs: number): void {
  const healthBackend = activeBackend;
  const fatalError = healthBackend?.takeFatalError?.() ?? null;
  if (healthBackend && fatalError) scheduleBackendRecovery(healthBackend, fatalError);
  const shouldRender = Boolean(activeBackend && (animateControl.checked || dirty));
  if (shouldRender && activeBackend) {
    if (lastFrameAt > 0 && animateControl.checked) {
      frameSamples.push(timeMs - lastFrameAt);
      trimSamples(frameSamples);
    }
    lastFrameAt = timeMs;
    const submitStartedAt = performance.now();
    const renderingBackend = activeBackend;
    try {
      renderingBackend.render(transform, timeMs);
      submitSamples.push(performance.now() - submitStartedAt);
      trimSamples(submitSamples);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      scheduleBackendRecovery(renderingBackend, reason);
    }
    dirty = false;
  } else {
    lastFrameAt = 0;
  }
  if (timeMs - lastMetricsAt >= 500) {
    updateMetrics();
    lastMetricsAt = timeMs;
  }
  frameRequest = requestAnimationFrame(renderFrame);
}

function zoomAt(viewportX: number, viewportY: number, nextScale: number): void {
  applyGalaxyLabZoomAt(
    transform,
    viewportX,
    viewportY,
    nextScale,
    MIN_SCALE,
    MAX_SCALE,
  );
  userMovedCamera = true;
  dirty = true;
  scheduleSettledViewDetail();
}

interface PointerPosition {
  x: number;
  y: number;
}

const pointers = new Map<number, PointerPosition>();
const pointerStarts = new Map<number, PointerPosition>();
let gestureMoved = false;
let hoverRequest = 0;
let pendingHoverPoint: PointerPosition | null = null;

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
  dirty = true;
}

function pickNodeAt(point: PointerPosition): string | null {
  return activeBackend?.pickNode(point.x, point.y) ?? null;
}

function scheduleHoverPick(point: PointerPosition): void {
  pendingHoverPoint = point;
  if (hoverRequest !== 0) return;
  hoverRequest = requestAnimationFrame(() => {
    hoverRequest = 0;
    const pending = pendingHoverPoint;
    pendingHoverPoint = null;
    if (!pending || pointers.size > 0) return;
    updateInteraction({
      selectedNodeId: interaction.selectedNodeId,
      hoveredNodeId: pickNodeAt(pending),
    });
  });
}

function localPoint(clientX: number, clientY: number): PointerPosition {
  const bounds = viewport.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  avatarAdmissionGeneration += 1;
  window.clearTimeout(settledDetailTimer);
  viewport.focus({ preventScroll: true });
  const point = localPoint(event.clientX, event.clientY);
  if (pointers.size === 0) gestureMoved = false;
  pointers.set(event.pointerId, point);
  pointerStarts.set(event.pointerId, { x: point.x, y: point.y });
  if (pointers.size > 1) gestureMoved = true;
  try {
    viewport.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic touch probes do not have an active browser pointer to capture.
  }
  viewport.dataset.dragging = "true";
});

viewport.addEventListener("pointermove", (event) => {
  const previousPoint = pointers.get(event.pointerId);
  if (!previousPoint) {
    if (event.pointerType === "mouse") {
      scheduleHoverPick(localPoint(event.clientX, event.clientY));
    }
    return;
  }
  event.preventDefault();
  const bounds = viewport.getBoundingClientRect();
  const nextX = event.clientX - bounds.left;
  const nextY = event.clientY - bounds.top;
  const startPoint = pointerStarts.get(event.pointerId) ?? previousPoint;
  if (Math.hypot(nextX - startPoint.x, nextY - startPoint.y) > 4 || pointers.size > 1) {
    gestureMoved = true;
  }
  if (pointers.size >= 2) {
    const iterator = pointers.values();
    const first = iterator.next().value as PointerPosition | undefined;
    const second = iterator.next().value as PointerPosition | undefined;
    if (first && second) {
      const previousFirstX = first.x;
      const previousFirstY = first.y;
      const previousSecondX = second.x;
      const previousSecondY = second.y;
      previousPoint.x = nextX;
      previousPoint.y = nextY;
      applyGalaxyLabPinch(
        transform,
        previousFirstX,
        previousFirstY,
        previousSecondX,
        previousSecondY,
        first.x,
        first.y,
        second.x,
        second.y,
        MIN_SCALE,
        MAX_SCALE,
      );
    }
    scheduleSettledViewDetail();
  } else {
    transform.x += nextX - previousPoint.x;
    transform.y += nextY - previousPoint.y;
    previousPoint.x = nextX;
    previousPoint.y = nextY;
  }
  userMovedCamera = true;
  dirty = true;
});

function releasePointer(event: PointerEvent): void {
  const releasePoint = localPoint(event.clientX, event.clientY);
  const shouldSelect = event.type === "pointerup" && pointers.size === 1 && !gestureMoved;
  pointers.delete(event.pointerId);
  pointerStarts.delete(event.pointerId);
  if (viewport.hasPointerCapture(event.pointerId)) {
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may release capture before pointercancel is delivered.
    }
  }
  if (pointers.size === 0) {
    viewport.dataset.dragging = "false";
    if (shouldSelect) {
      updateInteraction({
        selectedNodeId: pickNodeAt(releasePoint),
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
viewport.addEventListener("pointerleave", () => {
  if (pointers.size > 0) return;
  pendingHoverPoint = null;
  updateInteraction({ selectedNodeId: interaction.selectedNodeId, hoveredNodeId: null });
});

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const point = localPoint(event.clientX, event.clientY);
  const sensitivity = event.ctrlKey ? 0.012 : 0.0024;
  zoomAt(point.x, point.y, transform.scale * Math.exp(-event.deltaY * sensitivity));
}, { passive: false });

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

let safariGestureStartScale = transform.scale;
let safariGestureWorldPoint: PointerPosition | null = null;

viewport.addEventListener("gesturestart", ((event: SafariGestureEvent) => {
  event.preventDefault();
  avatarAdmissionGeneration += 1;
  window.clearTimeout(settledDetailTimer);
  safariGestureStartScale = transform.scale;
  const point = localPoint(event.clientX, event.clientY);
  safariGestureWorldPoint = {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}) as EventListener, { passive: false });

viewport.addEventListener("gesturechange", ((event: SafariGestureEvent) => {
  event.preventDefault();
  if (!safariGestureWorldPoint) return;
  const point = localPoint(event.clientX, event.clientY);
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, safariGestureStartScale * event.scale));
  transform.scale = nextScale;
  transform.x = point.x - safariGestureWorldPoint.x * nextScale;
  transform.y = point.y - safariGestureWorldPoint.y * nextScale;
  userMovedCamera = true;
  dirty = true;
  scheduleSettledViewDetail();
}) as EventListener, { passive: false });

viewport.addEventListener("gestureend", ((event: SafariGestureEvent) => {
  event.preventDefault();
  safariGestureWorldPoint = null;
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
  dirty = true;
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
  dirty = true;
});

fieldStyleSelect.addEventListener("change", () => {
  activeFieldStyle = fieldStyleSelect.value as GalaxyLabFieldStyle;
  activeBackend?.setFieldStyle?.(activeFieldStyle);
  dirty = true;
});

animateControl.addEventListener("change", () => {
  animatePreferenceTouched = true;
  resetSamples();
  dirty = true;
});

function syncReducedMotionPreference(): void {
  if (animatePreferenceTouched || animationProbeDisabled) return;
  animateControl.checked = !reducedMotionQuery.matches;
  resetSamples();
  dirty = true;
}

reducedMotionQuery.addEventListener("change", syncReducedMotionPreference);

const resizeObserver = new ResizeObserver(() => {
  const { width, height } = viewportSize();
  activeBackend?.resize(width, height, window.devicePixelRatio || 1);
  if (!userMovedCamera) fitGalaxy(false);
  else scheduleSettledViewDetail(true);
  dirty = true;
});
resizeObserver.observe(viewport);

document.addEventListener("visibilitychange", () => {
  lastFrameAt = 0;
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameRequest);
  cancelAnimationFrame(hoverRequest);
  window.clearTimeout(settledDetailTimer);
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
      },
      recoveryReason: lastRecoveryReason,
      startup: {
        workerOnly: true,
        ...fixtureWorkerReceipt,
      },
      frame: frameStats(frameSamples),
      submit: frameStats(submitSamples),
    }),
  },
});

applyDocumentPalette(paletteForTheme());
fitGalaxy(false);
void activateBackend(backendSelect.value as GalaxyLabBackendId);
frameRequest = requestAnimationFrame(renderFrame);
