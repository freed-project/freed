import type { RssFeed } from "@freed/shared";
import type { SidebarSourceStatusSummary } from "@freed/ui/context";
import type { ProviderHealthDebugState } from "@freed/ui/lib/debug-store";
import {
  getProviderStatusDetail,
  getProviderStatusLabel,
  getProviderStatusTone,
} from "@freed/ui/lib/provider-status";

type ProviderSyncCountsShape = Partial<Record<
  "rss" | "x" | "facebook" | "instagram" | "linkedin" | "substack" | "medium" | "youtube",
  number
>>;

type ProviderAuthState = {
  isAuthenticated?: boolean;
  lastCaptureError?: string;
} | null | undefined;

type SocialProviderSourceId = Exclude<keyof ProviderSyncCountsShape, "rss">;

export interface SourceStatusInput {
  feeds: Record<string, RssFeed>;
  providerSyncCounts: ProviderSyncCountsShape;
  itemCountByPlatform: Record<string, number>;
  xAuth?: ProviderAuthState;
  fbAuth?: ProviderAuthState;
  igAuth?: ProviderAuthState;
  liAuth?: ProviderAuthState;
  substackAuth?: ProviderAuthState;
  mediumAuth?: ProviderAuthState;
  ytAuth?: ProviderAuthState;
}

function formatFeedHealthDetail(
  enabledCount: number,
  failingCount: number,
): string {
  if (enabledCount === 0) {
    return "No feeds are being followed yet.";
  }
  if (failingCount === 0) {
    return "Feed sync looks healthy right now.";
  }
  if (failingCount >= enabledCount) {
    return "All followed feeds are currently failing.";
  }
  return `${failingCount.toLocaleString()} followed feed${failingCount === 1 ? "" : "s"} need review, but at least one feed is syncing successfully.`;
}

function isSocialProviderSourceId(
  sourceId: string | undefined,
): sourceId is SocialProviderSourceId {
  return (
    sourceId === "x" ||
    sourceId === "facebook" ||
    sourceId === "instagram" ||
    sourceId === "linkedin" ||
    sourceId === "substack" ||
    sourceId === "medium" ||
    sourceId === "youtube"
  );
}

function getProviderAuthState(
  sourceId: string | undefined,
  desktopState: SourceStatusInput,
): ProviderAuthState {
  switch (sourceId) {
    case "x":
      return desktopState.xAuth;
    case "facebook":
      return desktopState.fbAuth;
    case "instagram":
      return desktopState.igAuth;
    case "linkedin":
      return desktopState.liAuth;
    case "substack":
      return desktopState.substackAuth;
    case "medium":
      return desktopState.mediumAuth;
    case "youtube":
      return desktopState.ytAuth;
    default:
      return null;
  }
}

export function getDesktopSourceStatus(
  sourceId: string | undefined,
  desktopState: SourceStatusInput,
  health: ProviderHealthDebugState | null,
): SidebarSourceStatusSummary | null {
  if (sourceId === "rss") {
    const enabledFeeds = Object.values(desktopState.feeds).filter((feed) => feed.enabled);
    const enabledCount = enabledFeeds.length;
    const failingFeedUrls = new Set((health?.failingRssFeeds ?? []).map((feed) => feed.feedUrl));
    const failingCount = enabledFeeds.filter((feed) => failingFeedUrls.has(feed.url)).length;
    const syncing = (desktopState.providerSyncCounts.rss ?? 0) > 0;

    if (enabledCount === 0 && !syncing) {
      return null;
    }

    const tone = enabledCount > 0 && failingCount >= enabledCount ? "warning" : "healthy";
    return {
      tone,
      label: tone === "warning" ? "Sync issue" : "Healthy",
      detail: formatFeedHealthDetail(enabledCount, failingCount),
      syncing,
      paused: false,
    };
  }

  const authState = getProviderAuthState(sourceId, desktopState);
  const snapshot = isSocialProviderSourceId(sourceId)
    ? health?.providers[sourceId]
    : undefined;
  const authError =
    typeof authState?.lastCaptureError === "string" ? authState.lastCaptureError : undefined;
  const isConnected = authState?.isAuthenticated === true;
  const tone = getProviderStatusTone({
    isConnected,
    authError,
    snapshot,
  });

  if (tone === "idle") {
    return null;
  }

  return {
    tone,
    label: getProviderStatusLabel({
      isConnected,
      authError,
      snapshot,
    }),
    detail: getProviderStatusDetail({
      isConnected,
      authError,
      snapshot,
    }),
    paused: snapshot?.status === "paused",
    syncing: isSocialProviderSourceId(sourceId)
      ? (desktopState.providerSyncCounts[sourceId] ?? 0) > 0
      : false,
  };
}
