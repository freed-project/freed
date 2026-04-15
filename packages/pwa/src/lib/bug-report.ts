import JSZip from "jszip";
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
  getLastFatalRuntimeError,
  getRecentBugReportEvents,
  redactSensitiveText,
  resolveArtifactsForTier,
  summarizeStateForReport,
} from "@freed/ui/lib/bug-report";
import type { BugReportingConfig } from "@freed/ui/context";
import { getCloudProvider } from "./sync";
import { useAppStore } from "./store";

const GITHUB_REPO = "freed-project/freed";
const SUPPORT_EMAIL = "support@freed.wtf";
const APP_NAME = "Freed";

function collectEvents(events: BugReportEvent[], tier: ReportPrivacyTier): BugReportEvent[] {
  return events
    .filter((event) => tier === "private" || event.privacy !== "private")
    .slice(0, tier === "private" ? 120 : 60);
}

function getPwaRuntimeInfo() {
  return {
    version: __APP_VERSION__,
    userAgent: navigator.userAgent,
    platform: navigator.platform || "web",
    serviceWorker: "serviceWorker" in navigator,
    online: navigator.onLine,
    cloudProvider: getCloudProvider(),
    appMode: import.meta.env.DEV ? "development" : "production",
  };
}

function createStateSummary() {
  const state = useAppStore.getState();
  return summarizeStateForReport({
    state,
    platformAuth: {},
    cloudProviders: getCloudProvider() ? { current: getCloudProvider() as string } : undefined,
  });
}

function addJson(zip: JSZip, path: string, data: unknown) {
  zip.file(path, JSON.stringify(data, null, 2));
}

async function buildPwaBundle(input: {
  draft: BugReportDraft;
  privacyTier: ReportPrivacyTier;
}): Promise<GeneratedBugReportBundle> {
  const includedArtifacts = resolveArtifactsForTier(
    input.draft.selectedArtifacts,
    input.privacyTier,
  );
  const fatalError = getLastFatalRuntimeError();
  const runtimeInfo = getPwaRuntimeInfo();
  const reportEvents = collectEvents(getRecentBugReportEvents(), input.privacyTier);
  const debugEvents = useDebugStore.getState().events
    .slice(0, input.privacyTier === "private" ? 80 : 40)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      detail: event.detail ? redactSensitiveText(event.detail) : undefined,
      bytes: event.bytes,
      ts: event.ts,
    }));
  const stateSummary = createStateSummary();
  const manifest = buildBugReportManifest({
    appName: APP_NAME,
    appSlug: "freed-pwa",
    issueType: input.draft.issueType,
    privacyTier: input.privacyTier,
    includedArtifacts,
    fatalError,
  });
  const summaryMarkdown = buildBugReportSummaryMarkdown({
    appName: APP_NAME,
    draft: input.draft,
    manifest,
    metadataLines: includedArtifacts.includes("app-metadata")
      ? [
          `Version: ${runtimeInfo.version}`,
          `Platform: ${runtimeInfo.platform}`,
          `Online: ${runtimeInfo.online ? "yes" : "no"}`,
          `Service worker: ${runtimeInfo.serviceWorker ? "available" : "missing"}`,
        ]
      : [],
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
  if (includedArtifacts.includes("raw-stack") && fatalError) {
    diagnostics.rawStack = fatalError.stack;
    diagnostics.componentStack = fatalError.componentStack;
  }

  const zip = new JSZip();
  zip.file("summary.md", summaryMarkdown);
  addJson(zip, "report.json", {
    manifest,
    draft: input.draft,
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
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    manifest,
    summaryMarkdown,
    diagnostics,
  };
}

export const pwaBugReporting: BugReportingConfig = {
  githubRepo: GITHUB_REPO,
  privateShareEmail: SUPPORT_EMAIL,
  generateBundle: buildPwaBundle,
  openUrl: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
};
