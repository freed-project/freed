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
  createGalaxyLabFixture,
  GALAXY_LAB_THEMES,
  type GalaxyLabPalette,
  type GalaxyLabThemeId,
  type GalaxyLabTransform,
} from "./scene-fixture.js";

const DEFAULT_PERSON_COUNT = 5_000;
const DEFAULT_ACCOUNT_COUNT = 25_000;
const DEFAULT_BACKGROUND_COUNT = 100_000;
const MIN_SCALE = 0.035;
const MAX_SCALE = 6;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

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
const animateControl = requiredElement<HTMLInputElement>("animate");
const statusElement = requiredElement<HTMLElement>("status");
const metricsElement = requiredElement<HTMLElement>("metrics");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let animatePreferenceTouched = false;
animateControl.checked = !reducedMotionQuery.matches;

function setStatus(message: string, error = false): void {
  statusElement.textContent = message;
  statusElement.dataset.error = String(error);
}

const fixture = createGalaxyLabFixture({
  personCount: DEFAULT_PERSON_COUNT,
  accountCount: DEFAULT_ACCOUNT_COUNT,
  backgroundStarCount: DEFAULT_BACKGROUND_COUNT,
});

const transform: GalaxyLabTransform = { x: 0, y: 0, scale: 0.12 };
let activeBackend: GalaxyLabBackend | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let activeTheme = themeSelect.value as GalaxyLabThemeId;
let activeFieldStyle = fieldStyleSelect.value as GalaxyLabFieldStyle;
let switchGeneration = 0;
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

function scheduleSettledViewDetail(immediate = false): void {
  window.clearTimeout(settledDetailTimer);
  const apply = () => {
    activeBackend?.setViewDetail(viewDetailForScale(transform.scale));
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
    const { width, height } = viewportSize();
    backend.resize(width, height, window.devicePixelRatio || 1);
    backend.setViewDetail(viewDetailForScale(transform.scale));
    backend.setInteraction(interaction);
    resetSamples();
    dirty = true;
    const metrics = backend.metrics();
    const fallback = inheritedFallbackReason ?? metrics.fallbackReason;
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
  addMetric("Context edges", integerFormat.format(metrics.contextualEdgeCount));
  addMetric(
    "Selection",
    interaction.selectedNodeId ? nodeLabelById.get(interaction.selectedNodeId) ?? "Selected" : "None",
  );
  addMetric("Frame interval", formatFrameStats(frameStats(frameSamples)));
  addMetric("CPU submit", formatFrameStats(frameStats(submitSamples)));
  addMetric("Buffer uploads", integerFormat.format(metrics.bufferUploadCount));
  addMetric("Camera scale", numberFormat.format(transform.scale));
  addMetric("Settled detail", viewDetailForScale(transform.scale));
  if (metrics.adapterDescription) addMetric("Adapter", metrics.adapterDescription);
}

function trimSamples(samples: number[]): void {
  if (samples.length > 240) samples.splice(0, samples.length - 240);
}

function renderFrame(timeMs: number): void {
  const shouldRender = Boolean(activeBackend && (animateControl.checked || dirty));
  if (shouldRender && activeBackend) {
    if (lastFrameAt > 0 && animateControl.checked) {
      frameSamples.push(timeMs - lastFrameAt);
      trimSamples(frameSamples);
    }
    lastFrameAt = timeMs;
    const submitStartedAt = performance.now();
    activeBackend.render(transform, timeMs);
    submitSamples.push(performance.now() - submitStartedAt);
    trimSamples(submitSamples);
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
  const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
  const worldX = (viewportX - transform.x) / transform.scale;
  const worldY = (viewportY - transform.y) / transform.scale;
  transform.scale = clampedScale;
  transform.x = viewportX - worldX * clampedScale;
  transform.y = viewportY - worldY * clampedScale;
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
  interaction = next;
  activeBackend?.setInteraction(interaction);
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

function midpoint(left: PointerPosition, right: PointerPosition): PointerPosition {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function distance(left: PointerPosition, right: PointerPosition): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  viewport.focus({ preventScroll: true });
  const point = localPoint(event.clientX, event.clientY);
  if (pointers.size === 0) gestureMoved = false;
  pointers.set(event.pointerId, point);
  pointerStarts.set(event.pointerId, point);
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
  const before = [...pointers.values()];
  const nextPoint = localPoint(event.clientX, event.clientY);
  const startPoint = pointerStarts.get(event.pointerId) ?? previousPoint;
  if (distance(startPoint, nextPoint) > 4 || pointers.size > 1) gestureMoved = true;
  pointers.set(event.pointerId, nextPoint);
  const after = [...pointers.values()];
  if (after.length >= 2 && before.length >= 2) {
    const previousMidpoint = midpoint(before[0]!, before[1]!);
    const nextMidpoint = midpoint(after[0]!, after[1]!);
    const previousDistance = Math.max(1, distance(before[0]!, before[1]!));
    const nextDistance = Math.max(1, distance(after[0]!, after[1]!));
    const worldX = (previousMidpoint.x - transform.x) / transform.scale;
    const worldY = (previousMidpoint.y - transform.y) / transform.scale;
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.scale * nextDistance / previousDistance));
    transform.scale = nextScale;
    transform.x = nextMidpoint.x - worldX * nextScale;
    transform.y = nextMidpoint.y - worldY * nextScale;
    scheduleSettledViewDetail();
  } else {
    transform.x += nextPoint.x - previousPoint.x;
    transform.y += nextPoint.y - previousPoint.y;
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

backendSelect.addEventListener("change", () => {
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
  if (animatePreferenceTouched) return;
  animateControl.checked = !reducedMotionQuery.matches;
  resetSamples();
  dirty = true;
}

reducedMotionQuery.addEventListener("change", syncReducedMotionPreference);

const resizeObserver = new ResizeObserver(() => {
  const { width, height } = viewportSize();
  activeBackend?.resize(width, height, window.devicePixelRatio || 1);
  if (!userMovedCamera) fitGalaxy(false);
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
      frame: frameStats(frameSamples),
      submit: frameStats(submitSamples),
    }),
  },
});

applyDocumentPalette(paletteForTheme());
fitGalaxy(false);
void activateBackend(backendSelect.value as GalaxyLabBackendId);
frameRequest = requestAnimationFrame(renderFrame);
