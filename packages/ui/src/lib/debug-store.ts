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

interface DebugState {
  visible: boolean;
  events: SyncEvent[];
  docSnapshot: DocSnapshot | null;
  cloudProviders: CloudProvidersDebugState | null;
  perfSnapshot: FpsSnapshot | null;
  /** Incremented by resetPerfSnapshot so useFpsMonitor can clear its refs */
  perfResetGeneration: number;

  toggle: () => void;
  addEvent: (kind: SyncEventKind, detail?: string, bytes?: number) => void;
  clearEvents: () => void;
  setDocSnapshot: (snap: DocSnapshot) => void;
  setCloudProviders: (state: CloudProvidersDebugState) => void;
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
  perfSnapshot: null,
  perfResetGeneration: 0,

  toggle: () => set((s) => ({ visible: !s.visible })),

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

  setPerfSnapshot: (perfSnapshot) => set({ perfSnapshot }),

  resetPerfSnapshot: () => set((s) => ({ perfSnapshot: null, perfResetGeneration: s.perfResetGeneration + 1 })),
}));

// ---------------------------------------------------------------------------
// Convenience functions (usable outside React render context)
// ---------------------------------------------------------------------------

export function addDebugEvent(
  kind: SyncEventKind,
  detail?: string,
  bytes?: number,
): void {
  useDebugStore.getState().addEvent(kind, detail, bytes);
}

export function setDocSnapshot(snap: DocSnapshot): void {
  useDebugStore.getState().setDocSnapshot(snap);
}

export function setCloudProviders(state: CloudProvidersDebugState): void {
  useDebugStore.getState().setCloudProviders(state);
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
