export type ReportPrivacyTier = "public-safe" | "private";

export type BugReportArtifactId =
  | "app-metadata"
  | "diagnostic-events"
  | "state-summary"
  | "crash-context"
  | "screenshot"
  | "expanded-logs"
  | "snapshot-metadata"
  | "raw-stack";

export type BugReportIssueType =
  | "crash"
  | "broken-feature"
  | "sync-problem"
  | "performance"
  | "other";

export type BugReportArtifactPrivacy = "public-safe" | "private" | "secret-never-export";

export interface BugReportArtifactDefinition {
  id: BugReportArtifactId;
  label: string;
  description: string;
  privacy: BugReportArtifactPrivacy;
  enabledByDefault: boolean;
}

export interface BugReportScreenshot {
  name: string;
  mimeType: string;
  dataUrl: string;
  safeForPublic: boolean;
  capturedAt: number;
}

export interface BugReportDraft {
  issueType: BugReportIssueType;
  title: string;
  description: string;
  reproSteps: string;
  expectedBehavior: string;
  actualBehavior: string;
  selectedArtifacts: BugReportArtifactId[];
  screenshot?: BugReportScreenshot | null;
}

export interface RuntimeErrorSnapshot {
  id: string;
  source: string;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  fatal: boolean;
  fingerprint: string;
  stackFingerprint: string;
  occurredAt: number;
}

export interface BugReportEvent {
  id: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
  privacy: BugReportArtifactPrivacy;
  occurredAt: number;
}

export interface BugReportStateSummary {
  totalItems: number;
  totalFeeds: number;
  totalFriends: number;
  totalUnread: number;
  totalArchived: number;
  activeView: "feed" | "friends";
  isInitialized: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  selectedItemId: string | null;
  searchQueryLength: number;
  platformAuth: Record<string, boolean>;
  cloudProviders?: Record<string, string>;
  pendingMatchCount?: number;
}

export interface BugReportBundleManifest {
  schemaVersion: 1;
  appName: string;
  privacyTier: ReportPrivacyTier;
  createdAt: number;
  filename: string;
  issueType: BugReportIssueType;
  includedArtifacts: BugReportArtifactId[];
  crashFingerprint?: string;
  stackFingerprint?: string;
}

export interface BugReportBundleData {
  manifest: BugReportBundleManifest;
  summaryMarkdown: string;
  diagnostics: Record<string, unknown>;
  logs?: string[];
  screenshot?: BugReportScreenshot | null;
}

export interface GeneratedBugReportBundle extends BugReportBundleData {
  blob: Blob;
}
