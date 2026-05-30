import { invoke, isTauri } from "@tauri-apps/api/core";
import { setRuntimeMemory, type RuntimeMemorySnapshot } from "@freed/ui/lib/debug-store";
import { getStatus as getContentFetcherStatus } from "./content-fetcher";
import { log } from "./logger";

const MEMORY_SAMPLE_INTERVAL_MS = 15_000;
const MEMORY_LOG_INTERVAL = 4;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const MIN_CRITICAL_RESIDENT_BYTES = 3.5 * BYTES_PER_GIB;
const MAX_CRITICAL_RESIDENT_BYTES = 4 * BYTES_PER_GIB;
const WEBKIT_CACHE_TRIM_AT_BYTES = 768 * 1024 * 1024;
const WEBKIT_CACHE_TRIM_COOLDOWN_MS = 5 * 60_000;
const HIGH_RELAY_DOC_BYTES = 64 * 1024 * 1024;
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
    residentBytes: number;
    footprintBytes?: number;
    virtualBytes: number;
    cpuUsage: number;
    ageSeconds: number;
    role: string;
  }>;
  webkitTelemetryAvailable?: boolean;
  indexedDbBytes?: number;
  webkitCacheBytes?: number;
  memoryHighBytes?: number;
  memoryCriticalBytes?: number;
  relayDocBytes: number;
  relayClientCount: number;
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

function getRendererMemoryStats(): BrowserMemoryStats | null {
  if (typeof performance === "undefined") return null;
  const perf = performance as Performance & { memory?: BrowserMemoryStats };
  return perf.memory ?? null;
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
let peakRelayDocBytes = 0;
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
  getAutomergeStats?: () => { binaryBytes?: number; itemCount?: number } | null;
  onCriticalPressure?: (snapshot: RuntimeMemorySnapshot) => void;
  onSample?: (snapshot: RuntimeMemorySnapshot) => void;
}

export function formatBytesForMemoryLog(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  const pressureBytes =
    native.appMemoryPressureBytes ??
    native.processFootprintBytes ??
    native.processResidentBytes;
  const residentBytes = native.appResidentBytes ?? native.processResidentBytes;
  return Math.max(pressureBytes, residentBytes);
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
    indexedDbBytes: undefined,
    webkitCacheBytes: undefined,
    memoryHighBytes: limits.highBytes,
    memoryCriticalBytes: limits.criticalBytes,
    relayDocBytes: 0,
    relayClientCount: 0,
  };
}

async function sampleRuntimeMemory(
  reason: "startup" | "interval",
  options: MemoryMonitorOptions,
): Promise<void> {
  const fetcher = getContentFetcherStatus();
  const renderer = getRendererMemoryStats();
  const domNodeCount = getDomNodeCount();
  const automerge = options.getAutomergeStats?.() ?? null;
  const native = canSampleNativeMemoryStats()
    ? await invoke<NativeRuntimeMemoryStats>("get_runtime_memory_stats")
    : emptyNativeRuntimeMemoryStats();
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
  peakRelayDocBytes = Math.max(peakRelayDocBytes, native.relayDocBytes);

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
    automergeBinaryBytes: automerge?.binaryBytes,
    automergeItemCount: automerge?.itemCount,
    indexedDbBytes: native.indexedDbBytes,
    webkitCacheBytes: native.webkitCacheBytes,
    memoryHighBytes: limits.highBytes,
    memoryCriticalBytes: limits.criticalBytes,
    pressureLevel,
    relayDocBytes: native.relayDocBytes,
    relayClientCount: native.relayClientCount,
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
    pressureLevel !== "normal" ||
    native.relayDocBytes >= HIGH_RELAY_DOC_BYTES;

  if (!shouldLog) return;

  const level =
    pressureLevel !== "normal" ||
    native.relayDocBytes >= HIGH_RELAY_DOC_BYTES
      ? "warn"
      : "info";

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
      (automerge?.binaryBytes !== undefined
        ? `automerge_binary=${formatBytesForMemoryLog(automerge.binaryBytes)} `
        : "") +
      (automerge?.itemCount !== undefined
        ? `automerge_items=${automerge.itemCount.toLocaleString()} `
        : "") +
      (native.indexedDbBytes !== undefined
        ? `indexeddb=${formatBytesForMemoryLog(native.indexedDbBytes)} `
        : "") +
      (native.webkitCacheBytes !== undefined
        ? `webkit_cache=${formatBytesForMemoryLog(native.webkitCacheBytes)} `
        : "") +
      `relay_doc=${formatBytesForMemoryLog(native.relayDocBytes)} ` +
      `peak_relay_doc=${formatBytesForMemoryLog(peakRelayDocBytes)} ` +
      `relay_clients=${native.relayClientCount.toLocaleString()} ` +
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

  startupFollowupHandles = [2_000, 8_000, 16_000].map((delayMs) =>
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
  provider: "facebook" | "instagram" | "linkedin",
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
