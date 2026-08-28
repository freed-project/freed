import { invoke, isTauri } from "@tauri-apps/api/core";
import { setRuntimeMemory, type RuntimeMemorySnapshot } from "@freed/ui/lib/debug-store";
import { getStatus as getContentFetcherStatus } from "./content-fetcher";
import { log } from "./logger";
import { recordRuntimeHealthEvent } from "./runtime-health-events";

const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
const MEMORY_LOG_INTERVAL = 4;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const MIN_CRITICAL_RESIDENT_BYTES = 3.5 * BYTES_PER_GIB;
const MAX_CRITICAL_RESIDENT_BYTES = 12 * BYTES_PER_GIB;
const WEBKIT_CACHE_TRIM_AT_BYTES = 768 * 1024 * 1024;
const WEBKIT_CACHE_TRIM_COOLDOWN_MS = 5 * 60_000;
const PRESSURE_SAMPLE_MAX_AGE_MS = 30_000;

interface NativeRuntimeMemoryStats {
  totalPhysicalMemoryBytes: number;
  processResidentBytes: number;
  processFootprintBytes?: number;
  processVirtualBytes: number;
  appResidentBytes: number;
  appMemoryPressureBytes?: number;
  webkitResidentBytes?: number;
  webkitFootprintBytes?: number;
  webkitVirtualBytes?: number;
  webkitProcessId?: number;
  webkitTotalResidentBytes?: number;
  webkitTotalFootprintBytes?: number;
  webkitProcessCount?: number;
  webkitLargestResidentBytes?: number;
  webkitLargestFootprintBytes?: number;
  webkitLargestProcessId?: number;
  webkitLargestCpuUsage?: number;
  webkitLargestAgeSeconds?: number;
  webkitLargestRole?: string;
  webkitProcesses?: Array<{
    processId: number;
    startedAtUnixSeconds?: number;
    startedAtUnixMicros?: number;
    residentBytes: number;
    footprintBytes?: number;
    virtualBytes: number;
    cpuUsage: number;
    ageSeconds: number;
    role: string;
  }>;
  webkitTelemetryAvailable?: boolean;
  webkitAttributionPrecise?: boolean;
  indexedDbBytes?: number;
  webkitCacheBytes?: number;
  storageSizesSampled?: boolean;
  sampleDurationMs?: number;
  memoryHighBytes?: number;
  memoryCriticalBytes?: number;
}

interface ScrapeMemoryPreparation {
  before: NativeRuntimeMemoryStats;
  after: NativeRuntimeMemoryStats;
  recycledScraperWindows: boolean;
  cacheTrimmed: boolean;
  scraperRecycleVerification?: {
    elapsedMs: number;
    beforeProcessIds: number[];
    afterProcessIds: number[];
    exitedProcessIds: number[];
    retainedProcessIds: number[];
    newProcessIds: number[];
    beforeWebkitResidentBytes: number;
    afterWebkitResidentBytes: number;
    webkitResidentDeltaBytes: number;
  } | null;
  scrapeStartBudgetBytes?: number;
  mayProceed: boolean;
  deferredReason?: string;
}

interface WebkitCacheTrimResult {
  beforeBytes: number;
  afterBytes: number;
  cacheTrimmed: boolean;
}

interface BrowserMemoryStats {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * `performance.memory` is a Chrome extension to the Performance interface and
 * does not exist in WebKit, which is what Tauri uses on macOS. So on the actual
 * product this has always returned null, and every rendererHeap* field in the
 * telemetry has been silently absent.
 *
 * That absence read as zero in analysis and invited the conclusion that the JS
 * heap was negligible. It is not measured, which is a different claim. The
 * `rendererHeapAvailable` flag below makes the difference explicit so nobody
 * else draws a conclusion from a missing number.
 */
function getRendererMemoryStats(): BrowserMemoryStats | null {
  if (typeof performance === "undefined") return null;
  const perf = performance as Performance & { memory?: BrowserMemoryStats };
  return perf.memory ?? null;
}

/**
 * WebKit resident bytes captured before the Automerge document is loaded.
 *
 * This is the single largest unmeasured term in the storage roadmap's floor
 * estimates: the WebKit shell plus React baseline, which four independent
 * design passes estimated anywhere from 60 to 250 MB. Everything else in the
 * renderer budget is derived by subtracting from the observed total, so a 4x
 * uncertainty here makes every ratio in that document soft.
 *
 * Recorded once per app launch, at the first sample taken before hydration.
 */
let shellBaselineMainRendererResidentBytes: number | undefined;
let shellBaselineMainRendererProcessId: number | undefined;
let shellBaselineMainRendererStartedAtUnixSeconds: number | undefined;
let shellBaselineMainRendererStartedAtUnixMicros: number | undefined;
let shellBaselineCapturedAtMs: number | undefined;
let shellBaselineCapturePromise: Promise<boolean> | undefined;
let documentHydrationStartedAtMs: number | undefined;
let documentHydratedAtMs: number | undefined;

export function recordDocumentHydrationStarted(): void {
  documentHydrationStartedAtMs ??= Date.now();
}

export function recordDocumentHydrated(): void {
  if (documentHydratedAtMs !== undefined) return;
  recordDocumentHydrationStarted();
  documentHydratedAtMs = Date.now();
  recordRuntimeHealthEvent({
    event: "memory_document_hydrated",
    shellBaselineMainRendererResidentBytes,
    shellBaselineMainRendererProcessId,
    shellBaselineMainRendererStartedAtUnixSeconds,
    shellBaselineMainRendererStartedAtUnixMicros,
    shellBaselineCaptured: shellBaselineMainRendererResidentBytes !== undefined,
  });
}

export function getShellBaselineBytes(): number | undefined {
  return shellBaselineMainRendererResidentBytes;
}

function findMainRendererProcess(
  native: Pick<
    NativeRuntimeMemoryStats,
    "webkitAttributionPrecise" | "webkitProcesses"
  >,
): NonNullable<NativeRuntimeMemoryStats["webkitProcesses"]>[number] | undefined {
  if (!native.webkitAttributionPrecise) return undefined;
  const rootedCandidates =
    native.webkitProcesses?.filter(
      (process) =>
        process.role === "freed-webcontent" &&
        process.startedAtUnixSeconds !== undefined &&
        process.startedAtUnixSeconds > 0 &&
        process.startedAtUnixMicros !== undefined &&
        Number.isSafeInteger(process.startedAtUnixMicros) &&
        process.startedAtUnixMicros > 0,
    ) ?? [];
  return rootedCandidates.length === 1 ? rootedCandidates[0] : undefined;
}

function captureShellBaselineFromNative(
  native: Pick<
    NativeRuntimeMemoryStats,
    "webkitAttributionPrecise" | "webkitTelemetryAvailable" | "webkitProcesses"
  >,
): boolean {
  const mainRenderer = findMainRendererProcess(native);
  if (
    shellBaselineMainRendererResidentBytes !== undefined ||
    documentHydrationStartedAtMs !== undefined ||
    !native.webkitTelemetryAvailable ||
    !mainRenderer ||
    mainRenderer.residentBytes <= 0
  ) {
    return false;
  }
  shellBaselineMainRendererResidentBytes = mainRenderer.residentBytes;
  shellBaselineMainRendererProcessId = mainRenderer.processId;
  shellBaselineMainRendererStartedAtUnixSeconds =
    mainRenderer.startedAtUnixSeconds;
  shellBaselineMainRendererStartedAtUnixMicros =
    mainRenderer.startedAtUnixMicros;
  shellBaselineCapturedAtMs = Date.now();
  return true;
}

/**
 * Capture the WebKit shell before the Automerge document starts loading.
 *
 * `startMemoryMonitor()` runs only after the store reports initialized. Calling
 * it there is correct for pressure handling but too late for attribution. App
 * startup primes this probe before legal and document initialization. The store
 * also primes it as a fallback, then closes the baseline window before
 * SQLite runtime initialization begins.
 *
 * Measurement is never a startup dependency. Callers deliberately do not await
 * this promise. The sample disables storage scans but requires rooted WebKit
 * attribution and a process start time. If it does not finish before hydration
 * starts, or cannot prove one exact main renderer, it is discarded.
 */
export async function captureShellMemoryBaseline(): Promise<boolean> {
  if (
    shellBaselineMainRendererResidentBytes !== undefined ||
    documentHydrationStartedAtMs !== undefined ||
    !canSampleNativeMemoryStats()
  ) {
    return false;
  }
  if (shellBaselineCapturePromise) return shellBaselineCapturePromise;

  const capture = (async () => {
    try {
      const native = await invoke<NativeRuntimeMemoryStats>("get_runtime_memory_stats", {
        includeStorageSizes: false,
        preciseWebkitAttribution: true,
      });
      const captured = captureShellBaselineFromNative(native);
      if (captured) {
        recordRuntimeHealthEvent({
          event: "memory_shell_baseline",
          mainRendererProcessId: shellBaselineMainRendererProcessId,
          mainRendererStartedAtUnixSeconds:
            shellBaselineMainRendererStartedAtUnixSeconds,
          mainRendererStartedAtUnixMicros:
            shellBaselineMainRendererStartedAtUnixMicros,
          mainRendererResidentBytes: shellBaselineMainRendererResidentBytes,
          webkitProcessCount: native.webkitProcessCount,
          webkitAttributionPrecise: native.webkitAttributionPrecise,
        });
      }
      return captured;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[memory] shell baseline unavailable: ${message}`);
      return false;
    }
  })();
  shellBaselineCapturePromise = capture;
  void capture.then(() => {
    if (shellBaselineCapturePromise === capture) {
      shellBaselineCapturePromise = undefined;
    }
  });
  return capture;
}

/** Test seam: clears the once-per-launch baseline. */
export function resetMemoryAttributionForTests(): void {
  shellBaselineMainRendererResidentBytes = undefined;
  shellBaselineMainRendererProcessId = undefined;
  shellBaselineMainRendererStartedAtUnixSeconds = undefined;
  shellBaselineMainRendererStartedAtUnixMicros = undefined;
  shellBaselineCapturedAtMs = undefined;
  shellBaselineCapturePromise = undefined;
  documentHydrationStartedAtMs = undefined;
  documentHydratedAtMs = undefined;
}

function getDomNodeCount(): number | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementsByTagName("*").length;
}

function canSampleNativeMemoryStats(): boolean {
  return isTauri() || import.meta.env.VITE_TEST_TAURI === "1";
}

function scheduleWebkitCacheTrim(native: NativeRuntimeMemoryStats): void {
  if (!canSampleNativeMemoryStats()) return;
  const cacheBytes = native.webkitCacheBytes ?? 0;
  if (cacheBytes <= WEBKIT_CACHE_TRIM_AT_BYTES) return;
  if (webkitCacheTrimLease) return;

  const now = Date.now();
  if (now - lastWebkitCacheTrimAt < WEBKIT_CACHE_TRIM_COOLDOWN_MS) return;
  lastWebkitCacheTrimAt = now;

  webkitCacheTrimLease = invoke<WebkitCacheTrimResult>("trim_webkit_network_cache_now")
    .then((result) => {
      if (!result.cacheTrimmed) return;
      log.warn(
        `[memory] trimmed WebKit cache before=${formatBytesForMemoryLog(result.beforeBytes)} ` +
          `after=${formatBytesForMemoryLog(result.afterBytes)}`,
      );
    })
    .catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`[memory] WebKit cache trim failed: ${msg}`);
    })
    .finally(() => {
      webkitCacheTrimLease = null;
    });
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startupFollowupHandles: Array<ReturnType<typeof setTimeout>> = [];
let sampleCount = 0;
let peakResidentBytes = 0;
let peakWebkitResidentBytes = 0;
let lastCriticalToastAt = 0;
let currentPressureLevel: MemoryPressureLevel = "normal";
let currentPressureSampleAt = 0;
let socialPreflightLease: Promise<ScrapeMemoryPreparation> | null = null;
let socialPreflightDeferredUntil = 0;
let socialPreflightDeferredResult: ScrapeMemoryPreparation | null = null;
let socialPreflightDeferredReason = "";
let webkitCacheTrimLease: Promise<void> | null = null;
let lastWebkitCacheTrimAt = 0;

type MemoryPressureLevel = "normal" | "high" | "critical";

interface MemoryMonitorOptions {
  onCriticalPressure?: (snapshot: RuntimeMemorySnapshot) => void;
  onSample?: (snapshot: RuntimeMemorySnapshot) => void;
}

export function formatBytesForMemoryLog(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatScrapeMemoryPressureDetails(
  prep: ScrapeMemoryPreparation,
): string {
  const stats = prep.after;
  const limits = {
    highBytes:
      stats.memoryHighBytes ??
      getAdaptiveMemoryLimits(stats.totalPhysicalMemoryBytes).highBytes,
    criticalBytes:
      stats.memoryCriticalBytes ??
      getAdaptiveMemoryLimits(stats.totalPhysicalMemoryBytes).criticalBytes,
  };
  const pressureBytes = getEffectiveMemoryPressureBytes(stats);
  const webkitBytes = stats.webkitTotalResidentBytes ?? stats.webkitResidentBytes ?? 0;

  return (
    `Memory pressure is ${formatBytesForMemoryLog(pressureBytes)}, ` +
    `app RSS is ${formatBytesForMemoryLog(stats.appResidentBytes)}, ` +
    `WebKit RSS is ${formatBytesForMemoryLog(webkitBytes)}, ` +
    `high limit is ${formatBytesForMemoryLog(limits.highBytes)}, ` +
    `critical limit is ${formatBytesForMemoryLog(limits.criticalBytes)} after cleanup.`
  );
}

export function getAdaptiveMemoryLimits(totalPhysicalMemoryBytes: number): {
  highBytes: number;
  criticalBytes: number;
} {
  const proportional = Math.floor(totalPhysicalMemoryBytes * 0.12);
  const criticalBytes = Math.min(
    Math.max(proportional, MIN_CRITICAL_RESIDENT_BYTES),
    MAX_CRITICAL_RESIDENT_BYTES,
  );
  return {
    highBytes: Math.floor(criticalBytes * 0.7),
    criticalBytes,
  };
}

export function getMemoryPressureLevel(
  bytes: number,
  limits = getAdaptiveMemoryLimits(0),
): MemoryPressureLevel {
  if (bytes >= limits.criticalBytes) return "critical";
  if (bytes >= limits.highBytes) return "high";
  return "normal";
}

export function getEffectiveMemoryPressureBytes(native: {
  processResidentBytes: number;
  processFootprintBytes?: number;
  appResidentBytes?: number;
  appMemoryPressureBytes?: number;
}): number {
  return (
    native.appMemoryPressureBytes ??
    native.processFootprintBytes ??
    native.appResidentBytes ??
    native.processResidentBytes
  );
}

function emptyNativeRuntimeMemoryStats(): NativeRuntimeMemoryStats {
  const limits = getAdaptiveMemoryLimits(0);
  return {
    totalPhysicalMemoryBytes: 0,
    processResidentBytes: 0,
    processFootprintBytes: undefined,
    processVirtualBytes: 0,
    appResidentBytes: 0,
    appMemoryPressureBytes: 0,
    webkitResidentBytes: undefined,
    webkitFootprintBytes: undefined,
    webkitVirtualBytes: undefined,
    webkitProcessId: undefined,
    webkitTotalResidentBytes: undefined,
    webkitTotalFootprintBytes: undefined,
    webkitProcessCount: 0,
    webkitLargestResidentBytes: undefined,
    webkitLargestFootprintBytes: undefined,
    webkitLargestProcessId: undefined,
    webkitLargestCpuUsage: undefined,
    webkitLargestAgeSeconds: undefined,
    webkitLargestRole: undefined,
    webkitProcesses: [],
    webkitTelemetryAvailable: false,
    webkitAttributionPrecise: false,
    indexedDbBytes: undefined,
    webkitCacheBytes: undefined,
    storageSizesSampled: false,
    sampleDurationMs: 0,
    memoryHighBytes: limits.highBytes,
    memoryCriticalBytes: limits.criticalBytes,
  };
}

function memorySampleOptions(reason: "startup" | "interval"): {
  includeStorageSizes: boolean;
  preciseWebkitAttribution: boolean;
} {
  const diagnosticSample =
    reason === "startup" ||
    sampleCount % MEMORY_LOG_INTERVAL === 0 ||
    currentPressureLevel !== "normal";
  return {
    includeStorageSizes: diagnosticSample,
    preciseWebkitAttribution: diagnosticSample,
  };
}

async function sampleRuntimeMemory(
  reason: "startup" | "interval",
  options: MemoryMonitorOptions,
): Promise<void> {
  const sampleStartedAt = performance.now();
  const fetcher = getContentFetcherStatus();
  const renderer = getRendererMemoryStats();
  const domNodeCount = getDomNodeCount();
  const nativeOptions = memorySampleOptions(reason);
  const nativeStartedAt = performance.now();
  const native = canSampleNativeMemoryStats()
    ? await invoke<NativeRuntimeMemoryStats>("get_runtime_memory_stats", nativeOptions)
    : emptyNativeRuntimeMemoryStats();
  const nativeSampleDurationMs = Math.round(performance.now() - nativeStartedAt);

  // Capture the shell baseline exactly once, and only from a sample taken
  // before the document is hydrated. Taking it later would fold the Automerge
  // document into the "baseline" and make the delta meaningless, which is the
  // specific way this measurement is easy to get wrong.
  captureShellBaselineFromNative(native);
  const limits = {
    highBytes:
      native.memoryHighBytes ??
      getAdaptiveMemoryLimits(native.totalPhysicalMemoryBytes).highBytes,
    criticalBytes:
      native.memoryCriticalBytes ??
      getAdaptiveMemoryLimits(native.totalPhysicalMemoryBytes).criticalBytes,
  };
  const pressureBytes = getEffectiveMemoryPressureBytes(native);
  const pressureLevel = getMemoryPressureLevel(pressureBytes, limits);
  currentPressureLevel = pressureLevel;
  currentPressureSampleAt = Date.now();
  if (typeof document !== "undefined") {
    document.documentElement.dataset.memoryPressure = pressureLevel;
  }

  peakResidentBytes = Math.max(peakResidentBytes, pressureBytes);
  peakWebkitResidentBytes = Math.max(
    peakWebkitResidentBytes,
    native.webkitTotalResidentBytes ?? native.webkitResidentBytes ?? 0,
  );
  const baselineMainRenderer =
    shellBaselineMainRendererProcessId === undefined ||
    shellBaselineMainRendererStartedAtUnixMicros === undefined
      ? undefined
      : native.webkitProcesses?.find(
          (process) =>
            process.processId === shellBaselineMainRendererProcessId &&
            process.startedAtUnixMicros ===
              shellBaselineMainRendererStartedAtUnixMicros,
        );
  const shellBaselineComparisonStatus =
    shellBaselineMainRendererResidentBytes === undefined
      ? "not_captured"
      : baselineMainRenderer
        ? "same_process"
        : "process_unavailable";

  const snapshot: RuntimeMemorySnapshot = {
    totalPhysicalMemoryBytes: native.totalPhysicalMemoryBytes,
    processResidentBytes: native.processResidentBytes,
    processFootprintBytes: native.processFootprintBytes,
    processVirtualBytes: native.processVirtualBytes,
    appResidentBytes: native.appResidentBytes,
    appMemoryPressureBytes: native.appMemoryPressureBytes,
    webkitResidentBytes: native.webkitResidentBytes,
    webkitFootprintBytes: native.webkitFootprintBytes,
    webkitVirtualBytes: native.webkitVirtualBytes,
    webkitProcessId: native.webkitProcessId,
    webkitTotalResidentBytes: native.webkitTotalResidentBytes,
    webkitTotalFootprintBytes: native.webkitTotalFootprintBytes,
    webkitProcessCount: native.webkitProcessCount,
    webkitLargestResidentBytes: native.webkitLargestResidentBytes,
    webkitLargestFootprintBytes: native.webkitLargestFootprintBytes,
    webkitLargestProcessId: native.webkitLargestProcessId,
    webkitLargestCpuUsage: native.webkitLargestCpuUsage,
    webkitLargestAgeSeconds: native.webkitLargestAgeSeconds,
    webkitLargestRole: native.webkitLargestRole,
    webkitProcesses: native.webkitProcesses,
    webkitTelemetryAvailable: native.webkitTelemetryAvailable,
    webkitAttributionPrecise: native.webkitAttributionPrecise,
    indexedDbBytes: native.indexedDbBytes,
    webkitCacheBytes: native.webkitCacheBytes,
    storageSizesSampled: native.storageSizesSampled,
    sampleDurationMs: Math.round(performance.now() - sampleStartedAt),
    nativeSampleDurationMs,
    memoryHighBytes: limits.highBytes,
    memoryCriticalBytes: limits.criticalBytes,
    pressureLevel,
    contentQueuePending: fetcher.pending,
    contentCompleted: fetcher.completed,
    contentFailed: fetcher.failedCount,
    contentActive: fetcher.active,
    contentActiveAgeMs: fetcher.activeAgeMs,
    contentNextDelayMs: fetcher.nextDelayMs,
    contentBackoffLevel: fetcher.backoffLevel,
    rendererHeapUsedBytes: renderer?.usedJSHeapSize,
    rendererHeapTotalBytes: renderer?.totalJSHeapSize,
    rendererHeapLimitBytes: renderer?.jsHeapSizeLimit,
    // Absent is not zero. WebKit has no performance.memory, so on the shipping
    // desktop app the three fields above are always undefined; without this
    // flag that reads as "the JS heap is negligible" rather than "unmeasured".
    rendererHeapAvailable: renderer !== null,
    // Attribution terms. The baseline is one main renderer process captured
    // before document hydration. A delta is valid only while that exact PID is
    // still present. Provider WebViews and renderer replacements must never be
    // folded into a number that looks like corpus cost.
    shellBaselineMainRendererResidentBytes,
    shellBaselineMainRendererProcessId,
    shellBaselineMainRendererStartedAtUnixSeconds,
    shellBaselineMainRendererStartedAtUnixMicros,
    mainRendererResidentOverShellBaselineBytes:
      shellBaselineMainRendererResidentBytes === undefined ||
      baselineMainRenderer === undefined
        ? undefined
        : Math.max(
            0,
            baselineMainRenderer.residentBytes -
              shellBaselineMainRendererResidentBytes,
          ),
    shellBaselineComparisonStatus,
    shellBaselineAgeMs:
      shellBaselineCapturedAtMs === undefined
        ? undefined
        : Date.now() - shellBaselineCapturedAtMs,
    documentHydrated: documentHydratedAtMs !== undefined,
    domNodeCount,
    sampleTs: Date.now(),
  };
  setRuntimeMemory(snapshot);
  options.onSample?.(snapshot);
  scheduleWebkitCacheTrim(native);

  sampleCount += 1;
  const shouldLog =
    reason === "startup" ||
    sampleCount % MEMORY_LOG_INTERVAL === 0 ||
    pressureLevel !== "normal";

  if (!shouldLog) return;

  recordRuntimeHealthEvent({
    event: "renderer_memory_attribution",
    reason,
    documentHydrated: snapshot.documentHydrated,
    shellBaselineMainRendererResidentBytes:
      snapshot.shellBaselineMainRendererResidentBytes,
    shellBaselineMainRendererProcessId:
      snapshot.shellBaselineMainRendererProcessId,
    shellBaselineMainRendererStartedAtUnixSeconds:
      snapshot.shellBaselineMainRendererStartedAtUnixSeconds,
    shellBaselineMainRendererStartedAtUnixMicros:
      snapshot.shellBaselineMainRendererStartedAtUnixMicros,
    mainRendererResidentOverShellBaselineBytes:
      snapshot.mainRendererResidentOverShellBaselineBytes,
    shellBaselineComparisonStatus: snapshot.shellBaselineComparisonStatus,
    appResidentBytes: snapshot.appResidentBytes,
    appMemoryPressureBytes: snapshot.appMemoryPressureBytes,
    webkitTotalResidentBytes: snapshot.webkitTotalResidentBytes,
    webkitLargestProcessId: snapshot.webkitLargestProcessId,
    webkitLargestResidentBytes: snapshot.webkitLargestResidentBytes,
    webkitProcessCount: snapshot.webkitProcessCount,
    indexedDbBytes: snapshot.indexedDbBytes,
    webkitCacheBytes: snapshot.webkitCacheBytes,
    rendererHeapAvailable: snapshot.rendererHeapAvailable,
  });

  const level = pressureLevel !== "normal" ? "warn" : "info";

  log[level](
    `[memory] pressure=${pressureLevel} ` +
      `app_pressure=${formatBytesForMemoryLog(pressureBytes)} ` +
      `app_rss=${formatBytesForMemoryLog(native.appResidentBytes ?? native.processResidentBytes)} ` +
      `high_at=${formatBytesForMemoryLog(limits.highBytes)} ` +
      `critical_at=${formatBytesForMemoryLog(limits.criticalBytes)} ` +
      `native_rss=${formatBytesForMemoryLog(native.processResidentBytes)} ` +
      `native_footprint=${formatBytesForMemoryLog(native.processFootprintBytes ?? native.processResidentBytes)} ` +
      `peak_pressure=${formatBytesForMemoryLog(peakResidentBytes)} ` +
      `native_virtual=${formatBytesForMemoryLog(native.processVirtualBytes)} ` +
      (native.webkitTelemetryAvailable
        ? `webkit_pid=${(native.webkitProcessId ?? 0).toLocaleString()} ` +
          `webkit_pressure=${formatBytesForMemoryLog(native.webkitTotalFootprintBytes ?? native.webkitTotalResidentBytes ?? native.webkitResidentBytes ?? 0)} ` +
          `webkit_rss=${formatBytesForMemoryLog(native.webkitTotalResidentBytes ?? native.webkitResidentBytes ?? 0)} ` +
          `webkit_processes=${(native.webkitProcessCount ?? 0).toLocaleString()} ` +
          `peak_webkit_rss=${formatBytesForMemoryLog(peakWebkitResidentBytes)} ` +
          `webkit_virtual=${formatBytesForMemoryLog(native.webkitVirtualBytes ?? 0)} `
        : "webkit_rss=unavailable ") +
      (native.indexedDbBytes !== undefined
        ? `indexeddb=${formatBytesForMemoryLog(native.indexedDbBytes)} `
        : "") +
      (native.webkitCacheBytes !== undefined
        ? `webkit_cache=${formatBytesForMemoryLog(native.webkitCacheBytes)} `
        : "") +
      `storage_sampled=${String(native.storageSizesSampled === true)} ` +
      `webkit_precise=${String(native.webkitAttributionPrecise === true)} ` +
      `sample_ms=${(native.sampleDurationMs ?? 0).toLocaleString()} ` +
      `native_sample_ms=${nativeSampleDurationMs.toLocaleString()} ` +
      `fetch_pending=${fetcher.pending.toLocaleString()} ` +
      `fetch_completed=${fetcher.completed.toLocaleString()} ` +
      `fetch_failed=${fetcher.failedCount.toLocaleString()} ` +
      `fetch_active=${String(fetcher.active)} ` +
      `fetch_active_age_ms=${(fetcher.activeAgeMs ?? 0).toLocaleString()} ` +
      `fetch_next_delay_ms=${(fetcher.nextDelayMs ?? 0).toLocaleString()} ` +
      `fetch_backoff_level=${fetcher.backoffLevel.toLocaleString()}` +
      (renderer
        ? ` renderer_heap=${formatBytesForMemoryLog(renderer.usedJSHeapSize)} ` +
          `renderer_total=${formatBytesForMemoryLog(renderer.totalJSHeapSize)}`
        : "") +
      (domNodeCount !== undefined ? ` dom_nodes=${domNodeCount.toLocaleString()}` : ""),
  );

  if (pressureLevel === "critical" && Date.now() - lastCriticalToastAt > 60_000) {
    lastCriticalToastAt = Date.now();
    options.onCriticalPressure?.(snapshot);
  }
}

export function startMemoryMonitor(options: MemoryMonitorOptions = {}): void {
  if (intervalHandle) return;

  void sampleRuntimeMemory("startup", options).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`[memory] startup sample failed: ${msg}`);
  });

  startupFollowupHandles = [30_000].map((delayMs) =>
    setTimeout(() => {
      void sampleRuntimeMemory("interval", options).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn(`[memory] followup sample failed: ${msg}`);
      });
    }, delayMs),
  );

  intervalHandle = setInterval(() => {
    void sampleRuntimeMemory("interval", options).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`[memory] interval sample failed: ${msg}`);
    });
  }, MEMORY_SAMPLE_INTERVAL_MS);
}

export function isMemoryPressureCritical(): boolean {
  return (
    currentPressureLevel === "critical" &&
    Date.now() - currentPressureSampleAt <= PRESSURE_SAMPLE_MAX_AGE_MS
  );
}

export async function prepareSocialScrapeMemory(
  provider: "facebook" | "instagram" | "linkedin" | "substack" | "medium",
  operation: string,
): Promise<ScrapeMemoryPreparation> {
  if (!canSampleNativeMemoryStats()) {
    return {
      before: emptyNativeRuntimeMemoryStats(),
      after: emptyNativeRuntimeMemoryStats(),
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    };
  }

  const now = Date.now();
  if (socialPreflightDeferredResult && now < socialPreflightDeferredUntil) {
    return {
      ...socialPreflightDeferredResult,
      deferredReason: socialPreflightDeferredReason,
      mayProceed: false,
    };
  }

  if (socialPreflightLease) {
    return socialPreflightLease;
  }

  socialPreflightLease = invoke<ScrapeMemoryPreparation>("prepare_social_scrape_memory", {
    provider,
    operation,
  })
    .then((result) => {
      if (!result.mayProceed) {
        socialPreflightDeferredUntil = Date.now() + 60_000;
        socialPreflightDeferredResult = result;
        socialPreflightDeferredReason = `${provider}:${operation}`;
      } else {
        socialPreflightDeferredUntil = 0;
        socialPreflightDeferredResult = null;
        socialPreflightDeferredReason = "";
      }
      return result;
    })
    .finally(() => {
      socialPreflightLease = null;
    });

  return socialPreflightLease;
}

export function stopMemoryMonitor(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  for (const handle of startupFollowupHandles) clearTimeout(handle);
  startupFollowupHandles = [];
}
