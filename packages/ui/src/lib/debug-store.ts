/**
 * Debug store for Freed sync diagnostics
 *
 * Zustand store that tracks sync events, document state snapshots, and
 * panel visibility. Consumed by DebugPanel; written to by automerge.ts
 * and sync.ts in both the PWA and desktop packages.
 *
 * Also exposes window.__freed as a console escape hatch for inspecting
 * live document state without opening the panel.
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEventKind =
  | "init"
  | "change"
  | "merge_ok"
  | "merge_err"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "sent"
  | "received"
  | "error"
  | "mixed_content_warn"
  | "camera_started"
  | "camera_denied"
  | "qr_decoded"
  | "connect_attempt"
  | "connect_timeout";

export interface SyncEvent {
  id: string;
  ts: number;
  kind: SyncEventKind;
  detail?: string;
  bytes?: number;
}

export interface DocSnapshot {
  deviceId: string;
  itemCount: number;
  feedCount: number;
  binarySize: number;
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Performance snapshot (updated at ~4Hz by useFpsMonitor)
// ---------------------------------------------------------------------------

export interface FpsSnapshot {
  fps: number;
  frameTimeMs: number;
  droppedFrames: number;
  p95Ms: number;
  longTasks: number;
  worstLongTaskMs: number;
  /** Raw frame times for last ~120 frames (sparkline data) */
  frameTimes: number[];
}

// Cloud sync provider state surfaced in the diagnostics panel.
// Kept intentionally minimal - the panel only needs status + optional error.
export type CloudSyncStatus = "idle" | "connecting" | "connected" | "error";

export interface CloudProviderDebugState {
  status: CloudSyncStatus;
  error?: string;
  lastSyncAt?: number;
}

export interface CloudProvidersDebugState {
  gdrive: CloudProviderDebugState;
  dropbox: CloudProviderDebugState;
}

export type HealthProviderId =
  | "rss"
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "gdrive"
  | "dropbox";

export type HealthOutcome =
  | "success"
  | "empty"
  | "error"
  | "cooldown"
  | "provider_rate_limit";

export type HealthSignalType = "none" | "explicit" | "heuristic";

export type ProviderHealthStatus = "idle" | "healthy" | "degraded" | "paused";

export interface HealthDailyBucket {
  dateKey: string;
  attempts: number;
  successes: number;
  failures: number;
  itemsSeen: number;
  itemsAdded: number;
  bytesMoved: number;
}

export interface HealthHourlyBucket {
  hourKey: string;
  attempts: number;
  successes: number;
  failures: number;
  itemsSeen: number;
  itemsAdded: number;
  bytesMoved: number;
}

export interface ProviderPauseState {
  pausedUntil: number;
  pauseReason: string;
  pauseLevel: 1 | 2 | 3;
  detectedAt: number;
  detectedBy: "auto" | "manual";
}

export interface ProviderHealthAttempt {
  id: string;
  provider: HealthProviderId;
  scope: "provider" | "rss_feed";
  feedUrl?: string;
  feedTitle?: string;
  outcome: HealthOutcome;
  stage?: string;
  reason?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  itemsSeen: number;
  itemsAdded: number;
  bytesMoved: number;
  signalType: HealthSignalType;
}

export interface ProviderHealthSnapshot {
  provider: HealthProviderId;
  status: ProviderHealthStatus;
  lastAttemptAt?: number;
  lastSuccessfulAt?: number;
  lastOutcome?: HealthOutcome;
  lastError?: string;
  currentMessage?: string;
  pause: ProviderPauseState | null;
  dailyBuckets: HealthDailyBucket[];
  hourlyBuckets: HealthHourlyBucket[];
  latestAttempts: ProviderHealthAttempt[];
  totalSeen7d: number;
  totalAdded7d: number;
  totalBytes7d: number;
}

export interface RssFeedHealthSnapshot {
  feedUrl: string;
  feedTitle: string;
  status: "ok" | "failing";
  outageSince?: number;
  failedAttemptsSinceSuccess: number;
  lastAttemptAt?: number;
  lastSuccessfulAt?: number;
  lastError?: string;
  dailyBuckets: HealthDailyBucket[];
  hourlyBuckets: HealthHourlyBucket[];
  latestAttempts: ProviderHealthAttempt[];
}

export interface ProviderHealthDebugState {
  providers: Record<HealthProviderId, ProviderHealthSnapshot>;
  failingRssFeeds: RssFeedHealthSnapshot[];
  updatedAt: number;
}

interface DebugState {
  visible: boolean;
  events: SyncEvent[];
  docSnapshot: DocSnapshot | null;
  cloudProviders: CloudProvidersDebugState | null;
  health: ProviderHealthDebugState | null;
  perfSnapshot: FpsSnapshot | null;
  /** Incremented by resetPerfSnapshot so useFpsMonitor can clear its refs */
  perfResetGeneration: number;

  toggle: () => void;
  show: () => void;
  setVisible: (visible: boolean) => void;
  addEvent: (kind: SyncEventKind, detail?: string, bytes?: number) => void;
  clearEvents: () => void;
  setDocSnapshot: (snap: DocSnapshot) => void;
  setCloudProviders: (state: CloudProvidersDebugState) => void;
  setHealth: (state: ProviderHealthDebugState) => void;
  setPerfSnapshot: (snap: FpsSnapshot) => void;
  resetPerfSnapshot: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;

export const useDebugStore = create<DebugState>()((set) => ({
  visible: false,
  events: [],
  docSnapshot: null,
  cloudProviders: null,
  health: null,
  perfSnapshot: null,
  perfResetGeneration: 0,

  toggle: () => set((s) => ({ visible: !s.visible })),
  show: () => set({ visible: true }),
  setVisible: (visible) => set({ visible }),

  addEvent: (kind, detail, bytes) =>
    set((s) => {
      const event: SyncEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        kind,
        detail,
        bytes,
      };
      return { events: [event, ...s.events].slice(0, MAX_EVENTS) };
    }),

  clearEvents: () => set({ events: [] }),

  setDocSnapshot: (docSnapshot) => set({ docSnapshot }),

  setCloudProviders: (cloudProviders) => set({ cloudProviders }),

  setHealth: (health) => set({ health }),

  setPerfSnapshot: (perfSnapshot) => set({ perfSnapshot }),

  resetPerfSnapshot: () => set((s) => ({ perfSnapshot: null, perfResetGeneration: s.perfResetGeneration + 1 })),
}));

// ---------------------------------------------------------------------------
// Log transport
//
// Desktop registers a transport callback via setLogTransport() so that every
// addDebugEvent call is also written to the platform log file. The ui package
// cannot import Tauri APIs directly (platform-agnostic constraint), so the
// transport is injected from the outside.
// ---------------------------------------------------------------------------

type LogTransport = (level: "debug" | "info" | "warn" | "error", msg: string) => void;
let _logTransport: LogTransport | null = null;

/** Register a platform-specific log transport. Call once at app startup. */
export function setLogTransport(transport: LogTransport): void {
  _logTransport = transport;
}

// ---------------------------------------------------------------------------
// Convenience functions (usable outside React render context)
// ---------------------------------------------------------------------------

export function addDebugEvent(
  kind: SyncEventKind,
  detail?: string,
  bytes?: number,
): void {
  useDebugStore.getState().addEvent(kind, detail, bytes);

  if (_logTransport) {
    const level =
      kind === "error" || kind === "merge_err"
        ? "error"
        : kind === "disconnected" || kind === "reconnecting" || kind === "connect_timeout"
          ? "warn"
          : "info";
    const parts = [`[debug-event] kind=${kind}`];
    if (detail) parts.push(`detail=${detail}`);
    if (bytes !== undefined) parts.push(`bytes=${bytes}`);
    _logTransport(level, parts.join(" "));
  }
}

export function setDocSnapshot(snap: DocSnapshot): void {
  useDebugStore.getState().setDocSnapshot(snap);
}

export function setCloudProviders(state: CloudProvidersDebugState): void {
  useDebugStore.getState().setCloudProviders(state);
}

export function setProviderHealth(state: ProviderHealthDebugState): void {
  useDebugStore.getState().setHealth(state);
}

// ---------------------------------------------------------------------------
// window.__freed escape hatch
//
// Call registerDocAccessors(getDoc, getDocBinary) from automerge.ts after
// initDoc() so the console can reach live document state without the panel.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __freed: {
      getDoc?: () => unknown;
      getDocJson?: () => string;
      getDocBinary?: () => Uint8Array;
      debug?: () => DebugState;
    };
  }
}

export function registerDocAccessors(
  getDoc: () => unknown,
  getDocJson: () => string,
  getDocBinary: () => Uint8Array,
): void {
  window.__freed = {
    ...window.__freed,
    getDoc,
    getDocJson,
    getDocBinary,
    debug: () => useDebugStore.getState(),
  };
}

// Initialise the base object immediately so it's always safe to spread into.
if (typeof window !== "undefined") {
  window.__freed = window.__freed ?? {};
}
