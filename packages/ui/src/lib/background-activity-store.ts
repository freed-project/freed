import { create } from "zustand";

export type BackgroundActivityChannelId =
  | "rss"
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "googleContacts"
  | "gdrive"
  | "dropbox";

export type BackgroundActivityJobKind =
  | "cloud-sync"
  | "content-fetch"
  | "content-signal-backfill"
  | "outbox"
  | "rss-poll"
  | "semantic-classifier"
  | "social-scrape"
  | "snapshot"
  | "update"
  | "local-ai-model-download"
  | "runtime-gated";

export type BackgroundActivityRecordKind = "channel" | "job";
export type BackgroundActivityLogLevel = "info" | "success" | "warning" | "error";
export type BackgroundActivityOutcome = "success" | "error" | "canceled";

export interface BackgroundActivityRecord {
  id: string;
  kind: BackgroundActivityRecordKind;
  label: string;
  message: string;
  startedAt: number;
  updatedAt: number;
  channelId?: BackgroundActivityChannelId;
  jobKind?: BackgroundActivityJobKind;
  source?: string;
  progress?: number;
}

export interface BackgroundActivityLogEntry {
  id: string;
  ts: number;
  level: BackgroundActivityLogLevel;
  message: string;
  channelId?: BackgroundActivityChannelId;
  jobKind?: BackgroundActivityJobKind;
  progress?: number;
}

export interface StartBackgroundActivityInput {
  id?: string;
  kind: BackgroundActivityRecordKind;
  label: string;
  message?: string;
  channelId?: BackgroundActivityChannelId;
  jobKind?: BackgroundActivityJobKind;
  source?: string;
  progress?: number;
  log?: boolean;
}

export interface UpdateBackgroundActivityInput {
  label?: string;
  message?: string;
  progress?: number;
  log?: boolean;
  level?: BackgroundActivityLogLevel;
}

export interface BackgroundActivityLogInput {
  level?: BackgroundActivityLogLevel;
  message: string;
  channelId?: BackgroundActivityChannelId;
  jobKind?: BackgroundActivityJobKind;
  progress?: number;
  id?: string;
  ts?: number;
}

interface BackgroundActivityState {
  active: Record<string, BackgroundActivityRecord>;
  log: BackgroundActivityLogEntry[];
  startBackgroundActivity: (input: StartBackgroundActivityInput) => string;
  updateBackgroundActivity: (id: string, patch: UpdateBackgroundActivityInput) => void;
  finishBackgroundActivity: (
    id: string,
    outcome?: BackgroundActivityOutcome,
    message?: string,
  ) => void;
  recordBackgroundActivityLog: (input: BackgroundActivityLogInput) => void;
  clearBackgroundActivity: () => void;
}

const MAX_ACTIVITY_LOG = 200;

export const BACKGROUND_CHANNEL_LABELS: Record<BackgroundActivityChannelId, string> = {
  rss: "Feeds",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  googleContacts: "Google Contacts",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
};

export const BACKGROUND_JOB_LABELS: Record<BackgroundActivityJobKind, string> = {
  "cloud-sync": "Cloud sync",
  "content-fetch": "Article fetch",
  "content-signal-backfill": "Content indexing",
  outbox: "Outbox",
  "rss-poll": "Feed polling",
  "semantic-classifier": "Semantic indexing",
  "social-scrape": "Social sync",
  snapshot: "Snapshot",
  update: "Update",
  "local-ai-model-download": "Local AI download",
  "runtime-gated": "Background work",
};

const DEBUG_PREFIX_CHANNELS: Array<[RegExp, BackgroundActivityChannelId]> = [
  [/^\[RSS\]/, "rss"],
  [/^\[Sync\]/, "rss"],
  [/^\[X\]/, "x"],
  [/^\[FB\]/, "facebook"],
  [/^\[IG\]/, "instagram"],
  [/^\[LI\]/, "linkedin"],
  [/^\[YT\]/, "youtube"],
  [/^\[Contacts\]/, "googleContacts"],
  [/^\[Cloud\/gdrive\]/, "gdrive"],
  [/^\[Cloud\/dropbox\]/, "dropbox"],
];

const DEBUG_JOB_PATTERNS: Array<[RegExp, BackgroundActivityJobKind]> = [
  [/^\[Outbox\]/, "outbox"],
  [/^\[Fetcher\]/, "content-fetch"],
  [/^\[Semantic classifier\]/, "semantic-classifier"],
  [/^\[background-runtime\]/, "runtime-gated"],
  [/^\[automerge-worker\]/, "snapshot"],
];

function activityId(input: StartBackgroundActivityInput): string {
  if (input.id) return input.id;
  if (input.kind === "channel" && input.channelId) return `channel:${input.channelId}`;
  if (input.kind === "job" && input.jobKind) return `job:${input.jobKind}:${input.source ?? "default"}`;
  return `activity:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function makeLogId(prefix = "activity-log"): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function levelForOutcome(outcome: BackgroundActivityOutcome): BackgroundActivityLogLevel {
  if (outcome === "success") return "success";
  if (outcome === "canceled") return "warning";
  return "error";
}

export function inferBackgroundActivityFromDebugEvent(
  kind: string,
  detail?: string,
): Pick<BackgroundActivityLogEntry, "level" | "channelId" | "jobKind"> | null {
  if (!detail) return null;
  const level: BackgroundActivityLogLevel =
    kind === "error" || kind === "merge_err"
      ? "error"
      : kind === "connected" || kind === "merge_ok" || kind === "sent" || kind === "received"
        ? "success"
        : kind === "disconnected" || kind === "reconnecting" || kind === "connect_timeout"
          ? "warning"
          : "info";
  const channel = DEBUG_PREFIX_CHANNELS.find(([pattern]) => pattern.test(detail))?.[1];
  if (channel) return { level, channelId: channel };
  const jobKind = DEBUG_JOB_PATTERNS.find(([pattern]) => pattern.test(detail))?.[1];
  if (jobKind) return { level, jobKind };
  return null;
}

export const useBackgroundActivityStore = create<BackgroundActivityState>()((set) => ({
  active: {},
  log: [],

  startBackgroundActivity: (input) => {
    const id = activityId(input);
    const now = Date.now();
    const message = input.message ?? "Running.";
    set((state) => {
      const current = state.active[id];
      const nextRecord: BackgroundActivityRecord = {
        ...current,
        id,
        kind: input.kind,
        label: input.label,
        message,
        startedAt: current?.startedAt ?? now,
        updatedAt: now,
        channelId: input.channelId,
        jobKind: input.jobKind,
        source: input.source,
        progress: input.progress,
      };
      const nextLog = input.log === false
        ? state.log
        : [
            {
              id: makeLogId(id),
              ts: now,
              level: "info" as BackgroundActivityLogLevel,
              message,
              channelId: input.channelId,
              jobKind: input.jobKind,
              progress: input.progress,
            },
            ...state.log,
          ].slice(0, MAX_ACTIVITY_LOG);
      return {
        active: {
          ...state.active,
          [id]: nextRecord,
        },
        log: nextLog,
      };
    });
    return id;
  },

  updateBackgroundActivity: (id, patch) =>
    set((state) => {
      const current = state.active[id];
      if (!current) return state;
      const now = Date.now();
      const nextRecord: BackgroundActivityRecord = {
        ...current,
        label: patch.label ?? current.label,
        message: patch.message ?? current.message,
        progress: patch.progress ?? current.progress,
        updatedAt: now,
      };
      const shouldLog = patch.log === true && patch.message;
      return {
        active: {
          ...state.active,
          [id]: nextRecord,
        },
        log: shouldLog
          ? [
              {
                id: makeLogId(id),
                ts: now,
                level: patch.level ?? "info",
                message: patch.message!,
                channelId: current.channelId,
                jobKind: current.jobKind,
                progress: patch.progress,
              },
              ...state.log,
            ].slice(0, MAX_ACTIVITY_LOG)
          : state.log,
      };
    }),

  finishBackgroundActivity: (id, outcome = "success", message) =>
    set((state) => {
      const current = state.active[id];
      if (!current) return state;
      const { [id]: _finished, ...active } = state.active;
      const finalMessage =
        message ??
        (outcome === "success"
          ? `${current.label} finished.`
          : outcome === "canceled"
            ? `${current.label} canceled.`
            : `${current.label} failed.`);
      return {
        active,
        log: [
          {
            id: makeLogId(id),
            ts: Date.now(),
            level: levelForOutcome(outcome),
            message: finalMessage,
            channelId: current.channelId,
            jobKind: current.jobKind,
            progress: current.progress,
          },
          ...state.log,
        ].slice(0, MAX_ACTIVITY_LOG),
      };
    }),

  recordBackgroundActivityLog: (input) =>
    set((state) => ({
      log: [
        {
          id: input.id ?? makeLogId(),
          ts: input.ts ?? Date.now(),
          level: input.level ?? "info",
          message: input.message,
          channelId: input.channelId,
          jobKind: input.jobKind,
          progress: input.progress,
        },
        ...state.log,
      ].slice(0, MAX_ACTIVITY_LOG),
    })),

  clearBackgroundActivity: () => set({ active: {}, log: [] }),
}));

export function startBackgroundActivity(input: StartBackgroundActivityInput): string {
  return useBackgroundActivityStore.getState().startBackgroundActivity(input);
}

export function updateBackgroundActivity(id: string, patch: UpdateBackgroundActivityInput): void {
  useBackgroundActivityStore.getState().updateBackgroundActivity(id, patch);
}

export function finishBackgroundActivity(
  id: string,
  outcome?: BackgroundActivityOutcome,
  message?: string,
): void {
  useBackgroundActivityStore.getState().finishBackgroundActivity(id, outcome, message);
}

export function recordBackgroundActivityLog(input: BackgroundActivityLogInput): void {
  useBackgroundActivityStore.getState().recordBackgroundActivityLog(input);
}
