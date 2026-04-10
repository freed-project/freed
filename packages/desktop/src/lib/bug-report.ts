import JSZip from "jszip";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type {
  BugReportDraft,
  BugReportEvent,
  GeneratedBugReportBundle,
  ReportPrivacyTier,
} from "@freed/shared";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import {
  buildBugReportManifest,
  buildBugReportSummaryMarkdown,
  captureReportScreenshot,
  dataUrlToUint8Array,
  getLastFatalRuntimeError,
  getRecentBugReportEvents,
  redactSensitiveText,
  resolveArtifactsForTier,
  summarizeStateForReport,
} from "@freed/ui/lib/bug-report";
import type { BugReportingConfig } from "@freed/ui/context";
import { useAppStore } from "./store";

const GITHUB_REPO = "freed-project/freed";
const SUPPORT_EMAIL = "support@freed.wtf";
const APP_NAME = "Freed Desktop";

interface DesktopRuntimeInfo {
  version: string;
  platform: string;
  userAgent: string;
  appMode: "test" | "development" | "production";
}

async function getRecentLogs(limit: number): Promise<string[]> {
  try {
    return await invoke<string[]>("get_recent_logs", { limit });
  } catch {
    return [];
  }
}

async function getSnapshotNames(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_snapshots");
  } catch {
    return [];
  }
}

async function getPlatformName(): Promise<string> {
  try {
    return await invoke<string>("get_platform");
  } catch {
    return navigator.platform || "unknown";
  }
}

function getRuntimeInfo(platform: string): DesktopRuntimeInfo {
  return {
    version: __APP_VERSION__,
    platform,
    userAgent: navigator.userAgent,
    appMode:
      import.meta.env.VITE_TEST_TAURI === "1"
        ? "test"
        : import.meta.env.DEV
          ? "development"
          : "production",
  };
}

function collectPublicEvents(events: BugReportEvent[], tier: ReportPrivacyTier): BugReportEvent[] {
  return events
    .filter((event) => tier === "private" || event.privacy !== "private")
    .slice(0, tier === "private" ? 120 : 60);
}

function sanitizeLogLines(lines: string[], tier: ReportPrivacyTier): string[] {
  const filtered = lines.slice(-(tier === "private" ? 200 : 80));
  return filtered.map((line) => redactSensitiveText(line));
}

function createStateSummary() {
  const state = useAppStore.getState();
  const cloudProviders = useDebugStore.getState().cloudProviders;
  return summarizeStateForReport({
    state,
    platformAuth: {
      x: state.xAuth.isAuthenticated,
      facebook: state.fbAuth.isAuthenticated,
      instagram: state.igAuth.isAuthenticated,
      linkedin: state.liAuth.isAuthenticated,
    },
    cloudProviders: cloudProviders
      ? {
          gdrive: cloudProviders.gdrive.status,
          dropbox: cloudProviders.dropbox.status,
        }
      : undefined,
  });
}

function addJson(zip: JSZip, path: string, data: unknown) {
  zip.file(path, JSON.stringify(data, null, 2));
}

async function buildDesktopBundle(input: {
  draft: BugReportDraft;
  privacyTier: ReportPrivacyTier;
}): Promise<GeneratedBugReportBundle> {
  const includedArtifacts = resolveArtifactsForTier(
    input.draft.selectedArtifacts,
    input.privacyTier,
    input.draft.screenshot,
  );
  const fatalError = getLastFatalRuntimeError();
  const platform = await getPlatformName();
  const runtimeInfo = getRuntimeInfo(platform);
  const logLines = includedArtifacts.some((artifact) => artifact === "expanded-logs")
    ? sanitizeLogLines(await getRecentLogs(240), "private")
    : sanitizeLogLines(await getRecentLogs(100), "public-safe");
  const snapshotNames =
    input.privacyTier === "private" && includedArtifacts.includes("snapshot-metadata")
      ? (await getSnapshotNames()).map((name) => redactSensitiveText(name))
      : [];
  const debugState = useDebugStore.getState();
  const reportEvents = collectPublicEvents(getRecentBugReportEvents(), input.privacyTier);
  const debugEvents = debugState.events.slice(0, input.privacyTier === "private" ? 80 : 40).map((event) => ({
    id: event.id,
    kind: event.kind,
    detail: event.detail ? redactSensitiveText(event.detail) : undefined,
    bytes: event.bytes,
    ts: event.ts,
  }));
  const stateSummary = createStateSummary();
  const manifest = buildBugReportManifest({
    appName: APP_NAME,
    appSlug: "freed-desktop",
    issueType: input.draft.issueType,
    privacyTier: input.privacyTier,
    includedArtifacts,
    fatalError,
  });
  const metadataLines = includedArtifacts.includes("app-metadata")
    ? [
        `Version: ${runtimeInfo.version}`,
        `Platform: ${runtimeInfo.platform}`,
        `Mode: ${runtimeInfo.appMode}`,
      ]
    : [];
  const summaryMarkdown = buildBugReportSummaryMarkdown({
    appName: APP_NAME,
    draft: input.draft,
    manifest,
    metadataLines,
  });

  const diagnostics: Record<string, unknown> = {};
  if (includedArtifacts.includes("app-metadata")) {
    diagnostics.runtime = runtimeInfo;
  }
  if (includedArtifacts.includes("state-summary")) {
    diagnostics.stateSummary = stateSummary;
  }
  if (includedArtifacts.includes("diagnostic-events")) {
    diagnostics.reportEvents = reportEvents;
    diagnostics.debugEvents = debugEvents;
  }
  if (includedArtifacts.includes("crash-context")) {
    diagnostics.fatalError = fatalError;
  }
  if (includedArtifacts.includes("snapshot-metadata")) {
    diagnostics.snapshotNames = snapshotNames;
  }
  if (includedArtifacts.includes("raw-stack") && fatalError) {
    diagnostics.rawStack = fatalError.stack;
    diagnostics.componentStack = fatalError.componentStack;
  }
  if (includedArtifacts.includes("expanded-logs")) {
    diagnostics.logLineCount = logLines.length;
  }

  const zip = new JSZip();
  zip.file("summary.md", summaryMarkdown);
  addJson(zip, "report.json", {
    manifest,
    draft: {
      ...input.draft,
      screenshot: input.draft.screenshot
        ? {
            name: input.draft.screenshot.name,
            safeForPublic: input.draft.screenshot.safeForPublic,
            capturedAt: input.draft.screenshot.capturedAt,
          }
        : null,
    },
  });
  if (includedArtifacts.includes("diagnostic-events")) {
    addJson(zip, "diagnostics/report-events.json", reportEvents);
    addJson(zip, "diagnostics/debug-events.json", debugEvents);
  }
  if (includedArtifacts.includes("state-summary")) {
    addJson(zip, "diagnostics/state-summary.json", stateSummary);
  }
  if (includedArtifacts.includes("app-metadata")) {
    addJson(zip, "diagnostics/runtime.json", runtimeInfo);
  }
  if (includedArtifacts.includes("crash-context") && fatalError) {
    addJson(zip, "diagnostics/fatal-error.json", fatalError);
  }
  if (includedArtifacts.includes("snapshot-metadata")) {
    addJson(zip, "diagnostics/snapshots.json", snapshotNames);
  }
  if (includedArtifacts.includes("expanded-logs")) {
    zip.file("logs/recent.log", logLines.join("\n"));
  }
  if (
    includedArtifacts.includes("screenshot") &&
    input.draft.screenshot &&
    (input.privacyTier === "private" || input.draft.screenshot.safeForPublic)
  ) {
    zip.file(
      `screenshots/${input.draft.screenshot.name}`,
      dataUrlToUint8Array(input.draft.screenshot.dataUrl),
    );
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    manifest,
    summaryMarkdown,
    diagnostics,
    logs: includedArtifacts.includes("expanded-logs") ? logLines : undefined,
    screenshot:
      includedArtifacts.includes("screenshot") &&
      input.draft.screenshot &&
      (input.privacyTier === "private" || input.draft.screenshot.safeForPublic)
        ? input.draft.screenshot
        : null,
  };
}

export const desktopBugReporting: BugReportingConfig = {
  githubRepo: GITHUB_REPO,
  privateShareEmail: SUPPORT_EMAIL,
  generateBundle: buildDesktopBundle,
  captureScreenshot: captureReportScreenshot,
  openUrl: (url) => {
    void shellOpen(url);
  },
};
