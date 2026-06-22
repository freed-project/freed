/**
 * Facebook capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a Tauri WebView to
 * facebook.com, wait for the page to render, then inject an extraction
 * script that reads posts from the DOM. The extracted data is sent back
 * via Tauri event IPC ('fb-feed-data').
 *
 * This approach is indistinguishable from a real user browsing Facebook
 * because the WebView IS a real browser (WebKit on macOS) executing all
 * of Facebook's JavaScript, telemetry, and headers natively.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawFbPost } from "@freed/capture-facebook/browser";
import {
  fbPostsToFeedItems,
  deduplicateFeedItems,
} from "@freed/capture-facebook/browser";
import type { FbGroupInfo, FeedItem } from "@freed/shared";
import { isValidFacebookAuthorIdentity } from "@freed/shared";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getFbScraperWindowMode } from "./scraper-prefs";
import { storeFbAuthState } from "./fb-auth";
import { attachScraperMediaDiagListener } from "./scraper-media-diag";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import {
  formatBytesForMemoryLog,
  formatScrapeMemoryPressureDetails,
  prepareSocialScrapeMemory,
} from "./memory-monitor";
import { archiveRecentProviderMedia, upsertMediaVaultRosterFromItems } from "./media-vault";
import { socialProviderCopy } from "./social-provider-copy";
import { runBackgroundJob } from "./background-runtime-coordinator";
import { log } from "./logger";
import { safeUnlisten } from "./safe-unlisten";
import {
  applyRuntimeDeferredDiag,
  applyLockedSessionDeferredDiag,
  applyNativeMemoryPressureDiag,
  isRuntimeDeferredStage,
  formatSocialCaptureDuration,
  socialCaptureDurationMs,
  SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
  SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
  waitForSocialScrapeEvents,
} from "./social-capture-runtime";
import {
  facebookGroupsFromFeedItems,
  isMissingFacebookGroupName,
  mergeFacebookGroupRecords,
} from "./facebook-groups";
import {
  loadSocialProviderCookieState,
  socialProviderMissingAuthCookieMessage,
} from "./social-auth-cookie-state";

// =============================================================================
// Rate Limiting
// =============================================================================

let lastScrapeAt = 0;
// 20 min base interval + up to 4 min of jitter so scrapes don't land at
// perfectly regular clock-tick intervals (machine-like regularity is a signal).
const MIN_INTERVAL_MS = 20 * 60 * 1000;
const INTERVAL_JITTER_MS = 4 * 60 * 1000;

function isRateLimited(): boolean {
  if (lastScrapeAt === 0) return false;
  const jitter = Math.random() * INTERVAL_JITTER_MS;
  return Date.now() - lastScrapeAt < MIN_INTERVAL_MS + jitter;
}

function recordScrape(): void {
  lastScrapeAt = Date.now();
}

// =============================================================================
// Diagnostic Types
// =============================================================================

export interface FbSyncDiag {
  postsExtracted: number;
  itemsNormalized: number;
  itemsDeduplicated: number;
  itemsAdded: number;
  candidateItems: number;
  existingItems: number;
  excludedItems: number;
  extractionPasses: number;
  totalCandidateCount: number;
  totalRejected: {
    suggestedOrSponsored: number;
    missingAuthor: number;
    missingContent: number;
  };
  lastExtractionStrategy: string | null;
  lastCandidateCount: number | null;
  lastRejected:
    | {
        suggestedOrSponsored?: number;
        missingAuthor?: number;
        missingContent?: number;
      }
    | null;
  lastScrollY: number | null;
  maxScrollY: number | null;
  feedContainerFound: boolean | null;
  scrapeRunId: string | null;
  lastPageState:
    | {
        state?: string;
        loggedInCookie?: boolean;
        feedLike?: boolean;
        feedUnitCount?: number;
        loginChrome?: boolean;
        scrollHeight?: number;
        url?: string;
        title?: string;
      }
    | null;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface FbSyncResult {
  items: ReturnType<typeof fbPostsToFeedItems>;
  diag: FbSyncDiag;
}

export interface FbGroupMembershipCheck {
  id: string;
  url: string;
  name?: string | null;
  stillJoined: boolean | null;
  reason: string;
  checkedAt: number;
}

export interface FbGroupLeaveVerification {
  check: FbGroupMembershipCheck;
  removed: boolean;
  repairedNameCount: number;
}

function createEmptyFbSyncDiag(
  overrides: Partial<FbSyncDiag> = {},
): FbSyncDiag {
  const { totalRejected: rejectedOverrides, ...rest } = overrides;
  const totalRejected = {
    suggestedOrSponsored: 0,
    missingAuthor: 0,
    missingContent: 0,
    ...rejectedOverrides,
  };
  return {
    postsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    candidateItems: 0,
    existingItems: 0,
    excludedItems: 0,
    extractionPasses: 0,
    totalCandidateCount: 0,
    lastExtractionStrategy: null,
    lastCandidateCount: null,
    lastRejected: null,
    lastScrollY: null,
    maxScrollY: null,
    feedContainerFound: null,
    scrapeRunId: null,
    lastPageState: null,
    errorStage: null,
    errorMessage: null,
    ...rest,
    totalRejected,
  };
}

interface FbNormalizationRejectionSummary {
  accepted: number;
  missingId: number;
  invalidAuthor: number;
  unexpected: number;
  firstRejectedSample: string | null;
}

function rawFacebookPostSample(post: RawFbPost): string {
  return [
    `id:${post.id ? "y" : "n"}`,
    `url:${post.url ? "y" : "n"}`,
    `author:${post.authorName ? "y" : "n"}`,
    `profile:${post.authorProfileUrl ? "y" : "n"}`,
    `text:${(post.text?.length ?? 0).toLocaleString()}`,
    `media:${(post.mediaUrls?.length ?? 0).toLocaleString()}`,
  ].join(",");
}

function summarizeFacebookNormalizationRejections(
  posts: readonly RawFbPost[],
): FbNormalizationRejectionSummary {
  const summary: FbNormalizationRejectionSummary = {
    accepted: 0,
    missingId: 0,
    invalidAuthor: 0,
    unexpected: 0,
    firstRejectedSample: null,
  };

  for (const post of posts) {
    let reason: "missingId" | "invalidAuthor" | null = null;
    if (!post.id && !post.url) {
      reason = "missingId";
    } else if (!isValidFacebookAuthorIdentity({
      displayName: post.authorName,
      profileUrl: post.authorProfileUrl,
    })) {
      reason = "invalidAuthor";
    }

    if (!reason) {
      summary.accepted++;
      continue;
    }

    summary[reason]++;
    if (!summary.firstRejectedSample) {
      summary.firstRejectedSample = `${reason}(${rawFacebookPostSample(post)})`;
    }
  }

  return summary;
}

function formatFacebookNormalizationSummary(
  summary: FbNormalizationRejectionSummary,
): string {
  return (
    `accepted=${summary.accepted.toLocaleString()}, ` +
    `missingId=${summary.missingId.toLocaleString()}, ` +
    `invalidAuthor=${summary.invalidAuthor.toLocaleString()}, ` +
    `unexpected=${summary.unexpected.toLocaleString()}` +
    (summary.firstRejectedSample ? `, firstRejected=${summary.firstRejectedSample}` : "")
  );
}

function formatFacebookEmptySyncMessage(diag: FbSyncDiag): string {
  const details: string[] = [];
  const scrollAppearsStuck =
    diag.extractionPasses >= 3 &&
    diag.lastCandidateCount === 0 &&
    typeof diag.lastScrollY === "number" &&
    diag.lastScrollY < 250;

  if (diag.extractionPasses > 0) {
    details.push(
      `${diag.extractionPasses.toLocaleString()} extraction pass${diag.extractionPasses === 1 ? "" : "es"}`,
    );
  }
  if (diag.lastExtractionStrategy) {
    details.push(`last strategy ${diag.lastExtractionStrategy}`);
  }
  if (typeof diag.lastCandidateCount === "number") {
    details.push(
      `${diag.lastCandidateCount.toLocaleString()} candidate${diag.lastCandidateCount === 1 ? "" : "s"} on the last pass`,
    );
  }
  if (typeof diag.lastScrollY === "number") {
    details.push(`scrollY ${diag.lastScrollY.toLocaleString()}`);
  }
  if (typeof diag.feedContainerFound === "boolean") {
    details.push(`feed container ${diag.feedContainerFound ? "found" : "not found"}`);
  }
  if (scrollAppearsStuck) {
    details.push("scroll appears stuck near the top");
  }

  return details.length > 0
    ? `${socialProviderCopy("facebook").feedReturnedEmpty} ${details.join(", ")}.`
    : socialProviderCopy("facebook").feedReturnedEmpty;
}

function formatFacebookParseFailureMessage(diag: FbSyncDiag): string {
  const rejected = diag.totalRejected;
  const details = [
    `${diag.totalCandidateCount.toLocaleString()} candidate${diag.totalCandidateCount === 1 ? "" : "s"}`,
    `${rejected.missingAuthor.toLocaleString()} missing author`,
    `${rejected.missingContent.toLocaleString()} missing content`,
  ];

  if (rejected.suggestedOrSponsored > 0) {
    details.push(`${rejected.suggestedOrSponsored.toLocaleString()} suggested or sponsored`);
  }
  if (diag.extractionPasses > 0) {
    details.push(`${diag.extractionPasses.toLocaleString()} extraction pass${diag.extractionPasses === 1 ? "" : "es"}`);
  }
  if (typeof diag.maxScrollY === "number") {
    details.push(`max scrollY ${diag.maxScrollY.toLocaleString()}`);
  }
  if (diag.lastPageState?.state) {
    details.push(`page state ${diag.lastPageState.state}`);
  }

  return `Facebook rendered post-like blocks, but Freed Desktop could not parse any posts. ${details.join(", ")}.`;
}

function formatFacebookNoNewItemsMessage(diag: FbSyncDiag): string {
  const details: string[] = [];
  if (diag.existingItems > 0) {
    details.push(`${diag.existingItems.toLocaleString()} already present`);
  }
  if (diag.excludedItems > 0) {
    details.push(`${diag.excludedItems.toLocaleString()} excluded`);
  }
  if (diag.candidateItems > 0) {
    details.push(`${diag.candidateItems.toLocaleString()} write candidate${diag.candidateItems === 1 ? "" : "s"}`);
  }

  return details.length > 0
    ? `No new Facebook items: ${details.join(", ")}.`
    : "No new Facebook items.";
}

function filterExcludedGroups(
  items: FeedItem[],
  excludedGroupIds: Record<string, true>,
): FeedItem[] {
  return items.filter((item) => {
    const groupId = item.fbGroup?.id;
    return !groupId || !excludedGroupIds[groupId];
  });
}

async function updateKnownFacebookGroups(
  groups: readonly FbGroupInfo[],
): Promise<ReturnType<typeof mergeFacebookGroupRecords>> {
  const store = useAppStore.getState();
  const merge = mergeFacebookGroupRecords(
    store.preferences.fbCapture?.knownGroups ?? {},
    groups,
  );

  if (merge.changedCount > 0) {
    await store.updatePreferences({
      fbCapture: {
        knownGroups: merge.knownGroups,
        excludedGroupIds: store.preferences.fbCapture?.excludedGroupIds ?? {},
      },
    });
  }

  return merge;
}

export async function repairStoredFacebookGroupNamesFromItems(
  items: readonly FeedItem[] = useAppStore.getState().items,
): Promise<number> {
  const groups = facebookGroupsFromFeedItems(items);
  if (groups.length === 0) return 0;

  const merge = await updateKnownFacebookGroups(groups);
  if (merge.repairedNameCount > 0) {
    addDebugEvent(
      "change",
      `[FB] repaired ${merge.repairedNameCount.toLocaleString()} stored group name${merge.repairedNameCount === 1 ? "" : "s"} from captured posts`,
    );
  }

  return merge.repairedNameCount;
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the configured scraper window mode and wait for results.
 *
 * Flow:
 * 1. Register a listener for 'fb-feed-data' events
 * 2. Invoke 'fb_scrape_feed' (Rust navigates WebView + injects script)
 * 3. Wait for the extraction script to emit results via the event
 * 4. Normalize raw posts to FeedItem[]
 */
export async function fetchFbFeed(): Promise<FbSyncResult> {
  const diag = createEmptyFbSyncDiag();

  const cookieState = await loadSocialProviderCookieState("facebook");
  if (cookieState && cookieState.available && !cookieState.hasAuthCookie) {
    diag.errorStage = "auth";
    diag.errorMessage = socialProviderMissingAuthCookieMessage("facebook");
    return { items: [], diag };
  }

  if (await applyLockedSessionDeferredDiag(diag)) {
    return { items: [], diag };
  }

  const memoryPrep = await prepareSocialScrapeMemory("facebook", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("facebook").memoryPressure} ` +
      formatScrapeMemoryPressureDetails(memoryPrep);
    return { items: [], diag };
  }

  const allRawPosts: RawFbPost[] = [];
  const seenIds = new Set<string>();
  let unlisten: UnlistenFn | null = null;
  let unlistenDiag: UnlistenFn | null = null;

  try {
    attachScraperMediaDiagListener("FB", "facebook");

    // Listen for diagnostics (fires before extraction)
    unlistenDiag = await listen("fb-diag", (diagEvent) => {
      const payload = diagEvent.payload as Record<string, unknown>;
      const url = typeof payload.url === "string" ? payload.url : "?";
      const title = typeof payload.title === "string" ? payload.title : "?";
      const scrollHeight =
        typeof payload.scrollHeight === "number"
          ? payload.scrollHeight.toLocaleString()
          : "?";
      addDebugEvent(
        "change",
        `[FB] DOM diag: title="${title}", scrollHeight=${scrollHeight}, url=${url}`,
      );
      console.log("[FB] DOM diagnostics:", payload);
    });

    // Listen for every extraction pass. The native scraper emits multiple
    // batches while it scrolls through the virtualized feed.
    unlisten = await listen<{
      posts: RawFbPost[];
      error?: string;
      extractedAt: number;
      url: string;
      strategy?: string;
      candidateCount?: number;
      rejected?: {
        suggestedOrSponsored?: number;
        missingAuthor?: number;
        missingContent?: number;
      };
      scrollY?: number;
      feedContainerFound?: boolean;
      scrapeRunId?: string | null;
      pageState?: FbSyncDiag["lastPageState"];
    }>(
      "fb-feed-data",
      (event) => {
        const {
          posts,
          error,
          strategy,
          candidateCount,
          rejected,
          scrollY,
          feedContainerFound,
          scrapeRunId,
          pageState,
        } = event.payload;
        diag.extractionPasses++;
        diag.lastExtractionStrategy = strategy ?? null;
        diag.lastCandidateCount = typeof candidateCount === "number" ? candidateCount : null;
        diag.lastRejected = rejected ?? null;
        diag.lastScrollY = typeof scrollY === "number" ? scrollY : null;
        diag.maxScrollY =
          typeof scrollY === "number"
            ? Math.max(diag.maxScrollY ?? scrollY, scrollY)
            : diag.maxScrollY;
        diag.feedContainerFound = typeof feedContainerFound === "boolean" ? feedContainerFound : null;
        diag.scrapeRunId = typeof scrapeRunId === "string" ? scrapeRunId : diag.scrapeRunId;
        diag.lastPageState = pageState ?? diag.lastPageState;
        diag.totalCandidateCount += typeof candidateCount === "number" ? candidateCount : 0;
        if (rejected) {
          diag.totalRejected.suggestedOrSponsored += rejected.suggestedOrSponsored ?? 0;
          diag.totalRejected.missingAuthor += rejected.missingAuthor ?? 0;
          diag.totalRejected.missingContent += rejected.missingContent ?? 0;
        }

        const rejectionSummary = rejected
          ? `, rejected={sponsored:${(rejected.suggestedOrSponsored ?? 0).toLocaleString()}, author:${(rejected.missingAuthor ?? 0).toLocaleString()}, content:${(rejected.missingContent ?? 0).toLocaleString()}}`
          : "";
        const scrollSummary =
          typeof scrollY === "number" ? `, scrollY=${scrollY.toLocaleString()}` : "";
        const feedSummary =
          typeof feedContainerFound === "boolean"
            ? `, feedContainer=${feedContainerFound ? "y" : "n"}`
            : "";
        addDebugEvent(
          "change",
          `[FB] extraction: strategy=${strategy ?? "?"}, candidates=${candidateCount?.toLocaleString() ?? "?"}, posts=${posts.length.toLocaleString()}${rejectionSummary}${scrollSummary}${feedSummary}`,
        );

        if (error) {
          addDebugEvent("error", `[FB] extraction error: ${error}`);
          diag.errorStage =
            strategy === "not_authenticated"
              ? "auth"
              : strategy === "short_non_feed"
                ? "provider_page"
                : "extract";
          diag.errorMessage = error;
          return;
        }

        for (const post of posts) {
          const key = post.id ?? post.url ?? `${post.authorName}:${(post.text ?? "").slice(0, 80)}`;
          if (key && !seenIds.has(key)) {
            seenIds.add(key);
            allRawPosts.push(post);
          }
        }
      },
    );

    await runBackgroundJob({
      kind: "social-scrape",
      source: "facebook:feed",
      timeoutMs: 600_000,
      waitForActiveJobMs: SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
      waitForActiveJobKinds: SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
      run: () => invoke("fb_scrape_feed", { windowMode: getFbScraperWindowMode() }),
    });
    await waitForSocialScrapeEvents();
  } catch (err) {
    if (!diag.errorStage) {
      if (applyRuntimeDeferredDiag(diag, err)) {
        return { items: [], diag };
      }
      if (applyNativeMemoryPressureDiag(diag, err, "facebook")) {
        return { items: [], diag };
      }
      diag.errorStage = "invoke";
      diag.errorMessage = err instanceof Error ? err.message : String(err);
    }
    return { items: [], diag };
  } finally {
    safeUnlisten(unlisten, "fb-feed-data");
    safeUnlisten(unlistenDiag, "fb-diag");
  }

  if (diag.errorStage) {
    return { items: [], diag };
  }

  diag.postsExtracted = allRawPosts.length;

  if (allRawPosts.length === 0) {
    const parseRejectCount =
      diag.totalRejected.missingAuthor + diag.totalRejected.missingContent;
    if (diag.totalCandidateCount > 0 && parseRejectCount > 0) {
      diag.errorStage = "extract";
      diag.errorMessage = formatFacebookParseFailureMessage(diag);
    } else {
      diag.errorStage = "extract_empty";
      diag.errorMessage = formatFacebookEmptySyncMessage(diag);
    }
    return { items: [], diag };
  }

  try {
    const normalized = fbPostsToFeedItems(allRawPosts);
    diag.itemsNormalized = normalized.length;
    const normalizationSummary = summarizeFacebookNormalizationRejections(allRawPosts);
    normalizationSummary.unexpected = Math.max(0, normalizationSummary.accepted - normalized.length);
    if (normalized.length === 0) {
      const summaryText = formatFacebookNormalizationSummary(normalizationSummary);
      diag.errorStage = "normalize";
      diag.errorMessage =
        `Extracted ${allRawPosts.length.toLocaleString()} Facebook post` +
        `${allRawPosts.length === 1 ? "" : "s"}, but none passed normalization. ${summaryText}`;
      addDebugEvent("error", `[FB] normalization rejected all raw posts: ${summaryText}`);
      return { items: [], diag };
    }

    const items = deduplicateFeedItems(normalized);
    diag.itemsDeduplicated = items.length;
    addDebugEvent(
      "change",
      `[FB] normalization: raw=${allRawPosts.length.toLocaleString()}, normalized=${normalized.length.toLocaleString()}, deduplicated=${items.length.toLocaleString()}, ${formatFacebookNormalizationSummary(normalizationSummary)}`,
    );

    return { items, diag };
  } catch (err) {
    diag.errorStage = "normalize";
    diag.errorMessage = err instanceof Error ? err.message : String(err);
    return { items: [], diag };
  }
}

interface CaptureFbGroupsOptions {
  onCheckingGroup?: (groupId: string | null) => void;
}

export async function captureFbGroups(
  options: CaptureFbGroupsOptions = {},
): Promise<FbGroupInfo[]> {
  addDebugEvent("change", "[FB] group refresh started");
  const memoryPrep = await prepareSocialScrapeMemory("facebook", "groups scrape");
  if (!memoryPrep.mayProceed) {
    addDebugEvent(
      "change",
      `[FB] group refresh deferred for memory pressure: ${formatBytesForMemoryLog(memoryPrep.after.appResidentBytes)} after cleanup`,
    );
    return [];
  }

  const groups = await invoke<FbGroupInfo[]>("fb_scrape_groups", {
    windowMode: getFbScraperWindowMode(),
  });

  const merge = await updateKnownFacebookGroups(groups);
  const hydrated = await hydrateMissingFacebookGroupNames(options);

  addDebugEvent(
    "change",
    `[FB] groups refreshed: ${groups.length.toLocaleString()} group${groups.length === 1 ? "" : "s"}${merge.repairedNameCount + hydrated.repairedNameCount > 0 ? `, repaired ${(merge.repairedNameCount + hydrated.repairedNameCount).toLocaleString()} stored name${merge.repairedNameCount + hydrated.repairedNameCount === 1 ? "" : "s"}` : ""}${hydrated.removedCount > 0 ? `, removed ${hydrated.removedCount.toLocaleString()} stale group${hydrated.removedCount === 1 ? "" : "s"}` : ""}`,
  );

  return groups;
}

async function checkFacebookGroupMembership(group: FbGroupInfo): Promise<FbGroupMembershipCheck> {
  const groupUrl =
    group.url.trim() || `https://www.facebook.com/groups/${encodeURIComponent(group.id)}`;
  return invoke<FbGroupMembershipCheck>("fb_check_group_membership", {
    groupId: group.id,
    groupUrl,
    windowMode: getFbScraperWindowMode(),
  });
}

async function removeKnownFacebookGroup(groupId: string): Promise<boolean> {
  const store = useAppStore.getState();
  const knownGroups = { ...(store.preferences.fbCapture?.knownGroups ?? {}) };
  const excludedGroupIds = { ...(store.preferences.fbCapture?.excludedGroupIds ?? {}) };
  const existed = Boolean(knownGroups[groupId] || excludedGroupIds[groupId]);
  delete knownGroups[groupId];
  delete excludedGroupIds[groupId];

  if (existed) {
    await store.updatePreferences({
      fbCapture: {
        knownGroups,
        excludedGroupIds,
      },
    });
  }

  return existed;
}

async function hydrateMissingFacebookGroupNames(
  options: CaptureFbGroupsOptions = {},
): Promise<{
  checkedCount: number;
  repairedNameCount: number;
  removedCount: number;
}> {
  const store = useAppStore.getState();
  const missingGroups = Object.values(store.preferences.fbCapture?.knownGroups ?? {}).filter(
    isMissingFacebookGroupName,
  );

  let repairedNameCount = 0;
  let removedCount = 0;

  for (const group of missingGroups) {
    options.onCheckingGroup?.(group.id);
    try {
      const check = await checkFacebookGroupMembership(group);
      if (check.stillJoined === false) {
        if (await removeKnownFacebookGroup(group.id)) {
          removedCount += 1;
        }
        continue;
      }

      if (!check.name) {
        addDebugEvent(
          "change",
          `[FB] group name still missing for ...${group.id.slice(-8)}: ${check.reason}`,
        );
        continue;
      }

      const merge = await updateKnownFacebookGroups([
        {
          id: group.id,
          name: check.name,
          url: check.url || group.url,
        },
      ]);
      repairedNameCount += merge.repairedNameCount;
    } catch (err) {
      addDebugEvent(
        "error",
        `[FB] group name repair failed for ...${group.id.slice(-8)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      options.onCheckingGroup?.(null);
    }
  }

  return {
    checkedCount: missingGroups.length,
    repairedNameCount,
    removedCount,
  };
}

export async function verifyFacebookGroupLeave(
  group: FbGroupInfo,
): Promise<FbGroupLeaveVerification> {
  const check = await checkFacebookGroupMembership(group);
  let repairedNameCount = 0;
  if (check.name && check.stillJoined !== false) {
    const merge = await updateKnownFacebookGroups([
      {
        id: group.id,
        name: check.name,
        url: check.url || group.url,
      },
    ]);
    repairedNameCount = merge.repairedNameCount;
  }

  if (check.stillJoined !== false) {
    addDebugEvent(
      "change",
      `[FB] leave check kept group ...${group.id.slice(-8)}: ${check.reason}`,
    );
    return { check, removed: false, repairedNameCount };
  }

  const existed = await removeKnownFacebookGroup(group.id);

  addDebugEvent(
    "change",
    `[FB] leave check removed group ...${group.id.slice(-8)}: ${check.reason}`,
  );

  return { check, removed: existed, repairedNameCount };
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture Facebook feed and add items to the store.
 * Respects rate limiting to avoid triggering Facebook's anti-bot measures.
 */
export async function captureFbFeed(): Promise<FbSyncResult> {
  const startedAt = Date.now();
  const providerPause = getProviderPause("facebook");
  if (providerPause) {
    addDebugEvent("change", `[FB] paused until ${formatClockTime(providerPause.pausedUntil)}`);
    return {
      items: [],
      diag: createEmptyFbSyncDiag({
        errorStage: "provider_rate_limit",
        errorMessage: providerPause.pauseReason,
      }),
    };
  }

  if (isRateLimited()) {
    const minutesRemaining = Math.ceil(
      (MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000,
    );
    addDebugEvent(
      "change",
      `[FB] rate limited, next scrape in ~${minutesRemaining} min`,
    );
    await recordProviderHealthEvent({
      provider: "facebook",
      outcome: "cooldown",
      stage: "cooldown",
      reason: `Cooling down. Try again in ~${minutesRemaining} minutes.`,
      startedAt,
      finishedAt: Date.now(),
    });
    return {
      items: [],
      diag: createEmptyFbSyncDiag({
        errorStage: "cooldown",
        errorMessage: `Cooling down. Try again in ~${minutesRemaining} minutes.`,
      }),
    };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    addDebugEvent("change", "[FB] sync started");
    const fetchStartedAt = performance.now();
    const result = await fetchFbFeed();
    log.info(
      `[FB] fetch finished duration=${formatSocialCaptureDuration(socialCaptureDurationMs(fetchStartedAt))} ` +
        `items=${result.items.length.toLocaleString()} stage=${result.diag.errorStage ?? "ok"}`,
    );

    if (result.diag.errorStage) {
      const runtimeDeferred = isRuntimeDeferredStage(result.diag.errorStage);
      const detail = `[FB] sync ${runtimeDeferred ? "deferred" : "failed"} at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      addDebugEvent(runtimeDeferred ? "change" : "error", detail);
      if (runtimeDeferred) {
        return result;
      }
      if (result.diag.errorStage !== "memory_pressure") {
        recordScrape();
      }
      if (result.diag.errorStage !== "memory_pressure") {
        store.setError(result.diag.errorMessage ?? result.diag.errorStage);
        const errState = {
          ...useAppStore.getState().fbAuth,
          isAuthenticated:
            result.diag.errorStage === "auth" ? false : useAppStore.getState().fbAuth.isAuthenticated,
          lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed",
        };
        store.setFbAuth(errState);
        storeFbAuthState(errState);
      }
      await recordProviderHealthEvent({
        provider: "facebook",
        outcome: "error",
        stage: result.diag.errorStage,
        reason: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed",
        startedAt,
        finishedAt: Date.now(),
        itemsSeen: result.diag.postsExtracted,
        itemsAdded: result.diag.itemsAdded,
      });
      return result;
    }

    recordScrape();
    if (result.items.length > 0) {
      await repairStoredFacebookGroupNamesFromItems(result.items);
      const excludedGroupIds =
        useAppStore.getState().preferences.fbCapture?.excludedGroupIds ?? {};
      const filteredItems = filterExcludedGroups(result.items, excludedGroupIds);
      result.diag.candidateItems = filteredItems.length;
      result.diag.excludedItems = result.items.length - filteredItems.length;
      const beforeState = useAppStore.getState();
      const beforeFacebookItems = beforeState.items.filter((i) => i.platform === "facebook");
      const beforeFacebookIds = new Set(beforeFacebookItems.map((item) => item.globalId));
      const existingCandidateCount = filteredItems.filter((item) => beforeFacebookIds.has(item.globalId)).length;
      result.diag.existingItems = existingCandidateCount;
      addDebugEvent(
        "change",
        `[FB] writing ${filteredItems.length.toLocaleString()} candidate item${filteredItems.length === 1 ? "" : "s"} to the library (${existingCandidateCount.toLocaleString()} already present, ${result.diag.excludedItems.toLocaleString()} excluded)`,
      );
      const before = beforeFacebookItems.length;
      const writeStartedAt = performance.now();
      await store.addItems(filteredItems);
      const writeDurationMs = socialCaptureDurationMs(writeStartedAt);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "facebook").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      log.info(
        `[FB] store write complete candidates=${filteredItems.length.toLocaleString()} before=${before.toLocaleString()} after=${after.toLocaleString()} added=${result.diag.itemsAdded.toLocaleString()} existing=${result.diag.existingItems.toLocaleString()} excluded=${result.diag.excludedItems.toLocaleString()} duration=${formatSocialCaptureDuration(writeDurationMs)}`,
      );
      const mediaStartedAt = performance.now();
      await upsertMediaVaultRosterFromItems("facebook", filteredItems);
      const archivedCount = await archiveRecentProviderMedia(
        "facebook",
        filteredItems,
      );
      const mediaDurationMs = socialCaptureDurationMs(mediaStartedAt);
      const archivedTotal = archivedCount ?? 0;
      log.info(
        `[FB] media vault complete candidates=${filteredItems.length.toLocaleString()} archived=${archivedTotal.toLocaleString()} duration=${formatSocialCaptureDuration(mediaDurationMs)}`,
      );
      if (archivedTotal > 0) {
        addDebugEvent(
          "change",
          `[FB] archived ${archivedTotal.toLocaleString()} permanent media file${archivedTotal === 1 ? "" : "s"}`,
        );
      }
      addDebugEvent(
        "change",
        `[FB] synced: ${result.diag.postsExtracted.toLocaleString()} posts extracted, ${result.diag.itemsAdded.toLocaleString()} new item${result.diag.itemsAdded === 1 ? "" : "s"}, ${result.diag.existingItems.toLocaleString()} already present, ${result.diag.excludedItems.toLocaleString()} excluded`,
      );
    } else {
      const emptyMessage = formatFacebookEmptySyncMessage(result.diag);
      addDebugEvent("change", `[FB] sync complete: ${emptyMessage}`);
      store.setError(emptyMessage);
      const emptyState = {
        ...useAppStore.getState().fbAuth,
        lastCaptureError: emptyMessage,
      };
      store.setFbAuth(emptyState);
      storeFbAuthState(emptyState);
      await recordProviderHealthEvent({
        provider: "facebook",
        outcome: "empty",
        stage: "empty",
        reason: emptyMessage,
        startedAt,
        finishedAt: Date.now(),
        itemsSeen: result.diag.postsExtracted,
        itemsAdded: result.diag.itemsAdded,
      });
      return result;
    }

    // Persist success timestamp so the sync dropdown shows "Synced X ago"
    const successState = { ...useAppStore.getState().fbAuth, lastCapturedAt: Date.now(), lastCaptureError: undefined };
    store.setFbAuth(successState);
    storeFbAuthState(successState);
    await recordProviderHealthEvent({
      provider: "facebook",
      outcome: result.diag.postsExtracted > 0 ? "success" : "empty",
      stage: result.diag.postsExtracted > 0 ? undefined : "empty",
      reason:
        result.diag.postsExtracted > 0 && result.diag.itemsAdded === 0
          ? formatFacebookNoNewItemsMessage(result.diag)
          : result.diag.postsExtracted > 0
            ? undefined
            : "No posts pulled",
      startedAt,
      finishedAt: Date.now(),
      itemsSeen: result.diag.postsExtracted,
      itemsAdded: result.diag.itemsAdded,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture Facebook feed";
    store.setError(message);
    addDebugEvent("error", `[FB] captureFbFeed threw: ${message}`);
    const errState = { ...useAppStore.getState().fbAuth, lastCaptureError: message };
    store.setFbAuth(errState);
    storeFbAuthState(errState);
    await recordProviderHealthEvent({
      provider: "facebook",
      outcome: "error",
      stage: "unknown",
      reason: message,
      startedAt,
      finishedAt: Date.now(),
    });
    throw error;
  } finally {
    store.setLoading(false);
  }
}
