import { useEffect, useMemo, useState } from "react";
import type {
  CloudProviderDebugEvent,
  CloudProviderDebugState,
  CloudSyncStage,
} from "@freed/ui/lib/debug-store";

type ProviderName = "Google Drive" | "Dropbox";

type CloudSyncActivity = {
  stage: Exclude<CloudSyncStage, "idle">;
  startedAt: number;
  elapsedMs: number;
  elapsedLabel: string;
  shortLabel: string;
  detailLabel: string;
};

const ACTIVE_STAGES = new Set<CloudSyncStage>(["auth", "download", "merge", "poll", "upload"]);

function formatCloudSyncElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds.toLocaleString()}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes.toLocaleString()}m ${remainingSeconds.toLocaleString()}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours.toLocaleString()}h ${remainingMinutes.toLocaleString()}m`;
}

function stageShortLabel(stage: Exclude<CloudSyncStage, "idle">): string {
  switch (stage) {
    case "auth":
      return "Refreshing auth";
    case "download":
      return "Downloading";
    case "merge":
      return "Merging";
    case "poll":
      return "Watching";
    case "upload":
      return "Uploading";
  }
}

function stageDetailLabel(stage: Exclude<CloudSyncStage, "idle">, providerName: ProviderName): string {
  switch (stage) {
    case "auth":
      return `Refreshing ${providerName} access`;
    case "download":
      return `Checking ${providerName} for remote changes`;
    case "merge":
      return `Merging ${providerName} data into this library`;
    case "poll":
      return `Watching ${providerName} for changes`;
    case "upload":
      return `Uploading local changes to ${providerName}`;
  }
}

function latestStartedEventForStage(
  events: CloudProviderDebugEvent[] | undefined,
  stage: Exclude<CloudSyncStage, "idle">,
): CloudProviderDebugEvent | null {
  return events?.find((event) => event.kind === "started" && event.stage === stage) ?? null;
}

function getActivityStartedAt(
  state: CloudProviderDebugState,
  stage: Exclude<CloudSyncStage, "idle">,
): number | null {
  return latestStartedEventForStage(state.events, stage)?.ts
    ?? state.lastAttemptAt
    ?? state.lastActivityAt
    ?? null;
}

function getCloudSyncActivity(
  state: CloudProviderDebugState | null | undefined,
  providerName: ProviderName,
  now: number,
): CloudSyncActivity | null {
  if (!state?.stage || !ACTIVE_STAGES.has(state.stage) || state.stage === "idle" || state.status === "error") {
    return null;
  }

  const startedAt = getActivityStartedAt(state, state.stage);
  if (typeof startedAt !== "number") return null;

  const elapsedMs = Math.max(0, now - startedAt);
  return {
    stage: state.stage,
    startedAt,
    elapsedMs,
    elapsedLabel: formatCloudSyncElapsed(elapsedMs),
    shortLabel: stageShortLabel(state.stage),
    detailLabel: stageDetailLabel(state.stage, providerName),
  };
}

export function useCloudSyncActivity(
  state: CloudProviderDebugState | null | undefined,
  providerName: ProviderName,
): CloudSyncActivity | null {
  const [now, setNow] = useState(() => Date.now());
  const isActive = !!state?.stage && ACTIVE_STAGES.has(state.stage) && state.stage !== "idle" && state.status !== "error";

  useEffect(() => {
    if (!isActive) return undefined;
    const refresh = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(refresh);
      window.clearInterval(interval);
    };
  }, [isActive, state?.stage, state?.lastAttemptAt, state?.lastActivityAt]);

  return useMemo(() => getCloudSyncActivity(state, providerName, now), [now, providerName, state]);
}
