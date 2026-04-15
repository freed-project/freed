import { useSyncExternalStore } from "react";
import type {
  BugReportArtifactId,
  BugReportDraft,
  BugReportEvent,
  BugReportIssueType,
  BugReportStateSummary,
  BugReportArtifactDefinition,
  BugReportBundleManifest,
  GeneratedBugReportBundle,
  ReportPrivacyTier,
  RuntimeErrorSnapshot,
} from "@freed/shared";

const MAX_REPORT_EVENTS = 250;

export const PUBLIC_SAFE_ARTIFACTS: readonly BugReportArtifactDefinition[] = [
  {
    id: "app-metadata",
    label: "App metadata",
    description: "Version, platform, runtime, and coarse environment details.",
    privacy: "public-safe",
    enabledByDefault: true,
  },
  {
    id: "diagnostic-events",
    label: "Recent diagnostic events",
    description: "Recent redacted errors and diagnostic events from this session.",
    privacy: "public-safe",
    enabledByDefault: true,
  },
  {
    id: "state-summary",
    label: "State summary",
    description: "Counts, sync status, and feature state without personal content.",
    privacy: "public-safe",
    enabledByDefault: true,
  },
  {
    id: "crash-context",
    label: "Crash context",
    description: "Crash fingerprint and sanitized stack details when available.",
    privacy: "public-safe",
    enabledByDefault: true,
  },
];

export const PRIVATE_ARTIFACTS: readonly BugReportArtifactDefinition[] = [
  {
    id: "expanded-logs",
    label: "Expanded logs",
    description: "Longer log excerpts with more technical detail.",
    privacy: "private",
    enabledByDefault: false,
  },
  {
    id: "snapshot-metadata",
    label: "Snapshot metadata",
    description: "Snapshot inventory and diagnostic metadata from this device.",
    privacy: "private",
    enabledByDefault: false,
  },
  {
    id: "raw-stack",
    label: "Expanded stack traces",
    description: "Near-raw stack traces that may include extra environment detail.",
    privacy: "private",
    enabledByDefault: false,
  },
];

const DEFAULT_ARTIFACTS = PUBLIC_SAFE_ARTIFACTS.filter((artifact) => artifact.enabledByDefault).map(
  (artifact) => artifact.id,
);

const PRIVATE_IDS = new Set(PRIVATE_ARTIFACTS.map((artifact) => artifact.id));

type ReportStore = {
  events: BugReportEvent[];
  lastFatalError: RuntimeErrorSnapshot | null;
};

const store: ReportStore = {
  events: [],
  lastFatalError: null,
};

declare global {
  interface Window {
    __FREED_TRIGGER_FATAL__?: (message: string) => void;
  }
}

const listeners = new Set<() => void>();
let captureInstalled = false;
let consoleCaptureInstalled = false;

const BENIGN_WINDOW_ERROR_PATTERNS = [
  /^ResizeObserver loop completed with undelivered notifications\.?$/i,
  /^ResizeObserver loop limit exceeded\.?$/i,
];

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReportStore {
  return store;
}

function isBenignWindowErrorMessage(message: string | undefined): boolean {
  if (!message) return false;
  return BENIGN_WINDOW_ERROR_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, "0");
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/(auth[_-]?token|access[_-]?token|refresh[_-]?token|cookie|authorization)["'=:\s]+([^,\s]+)/gi, "$1=[REDACTED]")
    .replace(/([?&](?:token|code|state|auth|key|sig|signature|session)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]")
    .replace(/C:\\Users\\[^\\\s]+/g, "C:\\Users\\[REDACTED]")
    .replace(/\b[A-Za-z0-9_\-.]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");
}

function createErrorSnapshot(input: {
  source: string;
  name?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  fatal: boolean;
}): RuntimeErrorSnapshot {
  const safeMessage = redactSensitiveText(input.message);
  const safeStack = input.stack ? redactSensitiveText(input.stack) : undefined;
  const safeComponentStack = input.componentStack
    ? redactSensitiveText(input.componentStack)
    : undefined;
  const fingerprint = stableHash(`${input.source}:${input.name ?? "Error"}:${safeMessage}`);
  const stackFingerprint = stableHash(safeStack ?? safeMessage);
  return {
    id: `${Date.now()}-${fingerprint}`,
    source: input.source,
    name: input.name ?? "Error",
    message: safeMessage,
    stack: safeStack,
    componentStack: safeComponentStack,
    fatal: input.fatal,
    fingerprint,
    stackFingerprint,
    occurredAt: Date.now(),
  };
}

export function recordBugReportEvent(
  source: string,
  level: "info" | "warn" | "error",
  message: string,
  detail?: string,
  privacy: "public-safe" | "private" = "public-safe",
): void {
  const event: BugReportEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    level,
    message: redactSensitiveText(message),
    detail: detail ? redactSensitiveText(detail) : undefined,
    privacy,
    occurredAt: Date.now(),
  };
  store.events = [event, ...store.events].slice(0, MAX_REPORT_EVENTS);
  emitChange();
}

export function recordRuntimeError(input: {
  source: string;
  error: unknown;
  fatal: boolean;
  componentStack?: string;
}): RuntimeErrorSnapshot {
  const normalized =
    input.error instanceof Error
      ? input.error
      : new Error(typeof input.error === "string" ? input.error : JSON.stringify(input.error));
  const snapshot = createErrorSnapshot({
    source: input.source,
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    componentStack: input.componentStack,
    fatal: input.fatal,
  });
  const event: BugReportEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: input.source,
    level: "error",
    message: snapshot.message,
    detail: snapshot.stack,
    privacy: input.fatal ? "private" : "public-safe",
    occurredAt: snapshot.occurredAt,
  };
  store.events = [event, ...store.events].slice(0, MAX_REPORT_EVENTS);
  if (snapshot.fatal) {
    store.lastFatalError = snapshot;
  }
  emitChange();
  return snapshot;
}

export function clearFatalRuntimeError(): void {
  store.lastFatalError = null;
  emitChange();
}

export function getLastFatalRuntimeError(): RuntimeErrorSnapshot | null {
  return store.lastFatalError;
}

export function getRecentBugReportEvents(): BugReportEvent[] {
  return store.events;
}

export function resetBugReportState(): void {
  store.events = [];
  store.lastFatalError = null;
  emitChange();
}

export function useBugReportRuntimeState(): ReportStore {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFatalRuntimeError(): RuntimeErrorSnapshot | null {
  return useBugReportRuntimeState().lastFatalError;
}

export function installGlobalBugReportCapture(source: string): void {
  if (typeof window === "undefined") return;

  window.__FREED_TRIGGER_FATAL__ = (message: string) => {
    recordRuntimeError({
      source: `${source}:manual`,
      error: new Error(message),
      fatal: true,
    });
  };

  if (captureInstalled) return;
  captureInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message);
    const message = error instanceof Error ? error.message : event.message;
    if (isBenignWindowErrorMessage(message)) {
      recordBugReportEvent(
        `${source}:window.error`,
        "warn",
        message,
      );
      return;
    }
    recordRuntimeError({ source: `${source}:window.error`, error, fatal: true });
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordRuntimeError({
      source: `${source}:unhandledrejection`,
      error: event.reason ?? new Error("Unhandled promise rejection"),
      fatal: true,
    });
  });
}

export function installConsoleBugReportCapture(source: string): void {
  if (consoleCaptureInstalled || typeof window === "undefined") return;
  consoleCaptureInstalled = true;

  const methods: Array<"error" | "warn"> = ["error", "warn"];
  for (const method of methods) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      const detail = args
        .map((value) => {
          if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
          return typeof value === "string" ? value : JSON.stringify(value);
        })
        .join(" ");
      recordBugReportEvent(`${source}:console`, method, detail, undefined, method === "error" ? "private" : "public-safe");
      original(...args);
    };
  }
}

export function createDefaultBugReportDraft(
  issueType: BugReportIssueType = "other",
): BugReportDraft {
  return {
    issueType,
    title: "",
    description: "",
    reproSteps: "",
    expectedBehavior: "",
    actualBehavior: "",
    selectedArtifacts: [...DEFAULT_ARTIFACTS],
  };
}

export function getReportPrivacyTier(
  selectedArtifacts: BugReportArtifactId[],
): ReportPrivacyTier {
  const hasPrivateArtifact = selectedArtifacts.some((artifact) =>
    PRIVATE_ARTIFACTS.some((candidate) => candidate.id === artifact),
  );
  if (hasPrivateArtifact) return "private";
  return "public-safe";
}

export function resolveArtifactsForTier(
  selectedArtifacts: BugReportArtifactId[],
  tier: ReportPrivacyTier,
): BugReportArtifactId[] {
  const filtered = selectedArtifacts.filter((artifact) => {
    if (tier === "private") return true;
    return !PRIVATE_IDS.has(artifact);
  });
  return Array.from(new Set(filtered));
}

export function buildBugReportFilename(
  appSlug: "freed-desktop" | "freed-pwa",
  tier: ReportPrivacyTier,
): string {
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  return `${appSlug}-bug-report-${tier}-${stamp}.zip`;
}

export function buildBugReportManifest(input: {
  appName: string;
  appSlug: "freed-desktop" | "freed-pwa";
  issueType: BugReportIssueType;
  privacyTier: ReportPrivacyTier;
  includedArtifacts: BugReportArtifactId[];
  fatalError?: RuntimeErrorSnapshot | null;
}): BugReportBundleManifest {
  return {
    schemaVersion: 1,
    appName: input.appName,
    privacyTier: input.privacyTier,
    createdAt: Date.now(),
    filename: buildBugReportFilename(input.appSlug, input.privacyTier),
    issueType: input.issueType,
    includedArtifacts: input.includedArtifacts,
    crashFingerprint: input.fatalError?.fingerprint,
    stackFingerprint: input.fatalError?.stackFingerprint,
  };
}

export function buildBugReportSummaryMarkdown(input: {
  appName: string;
  draft: BugReportDraft;
  manifest: BugReportBundleManifest;
  metadataLines: string[];
}): string {
  return [
    `# ${input.appName} bug report`,
    ``,
    `- Issue type: ${input.draft.issueType}`,
    `- Privacy tier: ${input.manifest.privacyTier}`,
    ...input.metadataLines.map((line) => `- ${line}`),
    input.manifest.crashFingerprint
      ? `- Crash fingerprint: \`${input.manifest.crashFingerprint}\``
      : null,
    input.manifest.stackFingerprint
      ? `- Stack fingerprint: \`${input.manifest.stackFingerprint}\``
      : null,
    ``,
    ``,
    `## Summary`,
    input.draft.description.trim() || "_No summary provided._",
    ``,
    `## Reproduction`,
    input.draft.reproSteps.trim() || "_Not provided._",
    ``,
    `## Expected`,
    input.draft.expectedBehavior.trim() || "_Not provided._",
    ``,
    `## Actual`,
    input.draft.actualBehavior.trim() || "_Not provided._",
  ]
    .filter(Boolean)
    .join("\n");
}

export function summarizeStateForReport(input: {
  state: {
    items: Array<{ userState: { archived: boolean } }>;
    feeds: Record<string, unknown>;
    friends: Record<string, unknown>;
    totalUnreadCount: number;
    activeView: "feed" | "friends" | "map";
    isInitialized: boolean;
    isLoading: boolean;
    isSyncing: boolean;
    selectedItemId: string | null;
    searchQuery: string;
    pendingMatchCount?: number;
  };
  platformAuth?: Record<string, boolean>;
  cloudProviders?: Record<string, string>;
}): BugReportStateSummary {
  const archivedCount = input.state.items.filter((item) => item.userState.archived).length;
  return {
    totalItems: input.state.items.length,
    totalFeeds: Object.keys(input.state.feeds).length,
    totalFriends: Object.keys(input.state.friends).length,
    totalUnread: input.state.totalUnreadCount,
    totalArchived: archivedCount,
    activeView: input.state.activeView,
    isInitialized: input.state.isInitialized,
    isLoading: input.state.isLoading,
    isSyncing: input.state.isSyncing,
    selectedItemId: input.state.selectedItemId,
    searchQueryLength: input.state.searchQuery.length,
    platformAuth: input.platformAuth ?? {},
    cloudProviders: input.cloudProviders,
    pendingMatchCount: input.state.pendingMatchCount,
  };
}

export function createGithubIssueUrl(input: {
  repo: string;
  draft: BugReportDraft;
  bundle: GeneratedBugReportBundle;
}): string {
  const { draft, bundle, repo } = input;
  const title = draft.title.trim() || `${draft.issueType}: ${draft.description.split("\n")[0] || "Bug report"}`;
  const body = [
    `## Summary`,
    draft.description.trim() || "_No summary provided._",
    ``,
    ``,
    `## Reproduction`,
    draft.reproSteps.trim() || "_Not provided._",
    ``,
    ``,
    `## Expected`,
    draft.expectedBehavior.trim() || "_Not provided._",
    ``,
    ``,
    `## Actual`,
    draft.actualBehavior.trim() || "_Not provided._",
    ``,
    ``,
    `## Environment`,
    `- App: ${bundle.manifest.appName}`,
    `- Privacy tier: ${bundle.manifest.privacyTier}`,
    bundle.manifest.crashFingerprint ? `- Crash fingerprint: \`${bundle.manifest.crashFingerprint}\`` : null,
    bundle.manifest.stackFingerprint ? `- Stack fingerprint: \`${bundle.manifest.stackFingerprint}\`` : null,
    ``,
    ``,
    `## Attachment guidance`,
    `- The default public-safe bundle is designed for public issue attachment.`,
    `- Do not attach a private diagnostics bundle to a public issue.`,
  ]
    .filter(Boolean)
    .join("\n");

  const url = new URL(`https://github.com/${repo}/issues/new`);
  url.searchParams.set("title", title.slice(0, 120));
  url.searchParams.set("body", body);
  return url.toString();
}
