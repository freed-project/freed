/**
 * X/Twitter capture service
 *
 * Makes authenticated requests to X's GraphQL API via the Tauri backend
 * (which bypasses CORS/CSP restrictions the renderer would otherwise hit).
 *
 * All constants, types, and normalization logic live in @freed/capture-x.
 * This file owns the Tauri transport adapter (xRequest), the store-integration
 * layer (captureXTimeline), and the diagnostic types that expose per-stage
 * visibility into the pipeline.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  X_API_BASE,
  X_BEARER_TOKEN,
  HomeLatestTimeline,
  TweetDetail,
  FavoriteTweet,
  UnfavoriteTweet,
  buildMutationUrl,
  buildMutationBody,
  tweetsToFeedItems,
  deduplicateFeedItems,
  getHomeLatestTimelineVariables,
  getTweetDetailVariables,
} from "@freed/capture-x/browser";
import type { XTweetResult, TimelineResponse } from "@freed/capture-x/browser";
import type { XCookies } from "./x-auth";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getPlatformUA, extractChromeVersion, osPlatformHeader } from "./user-agent";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { clearStoredCookies } from "./x-auth";

// =============================================================================
// Injectable Transport
// =============================================================================

/**
 * A function that sends an HTTP request to the X API and returns the raw
 * response body as a string. In production this calls Tauri's x_api_request
 * command; in tests any function that returns fixture JSON can be substituted.
 *
 * Headers are passed as ordered pairs so the Rust backend preserves the exact
 * header ordering Chrome would use (important for JA4H fingerprinting).
 * `method` defaults to "GET" — X's read-only GraphQL endpoints expect GET.
 */
export type XRequester = (
  url: string,
  body: string,
  headers: Array<[string, string]>,
  method?: string,
) => Promise<string>;

const defaultRequester: XRequester = (url, body, headers, method = "GET") =>
  invoke<string>("x_api_request", { url, body, headers, method });

// =============================================================================
// Diagnostic Types
// =============================================================================

/**
 * Per-stage counts and error info from a single timeline fetch.
 * Every field is set regardless of success or failure so callers can pinpoint
 * exactly where the pipeline produced zero items.
 */
export interface XSyncDiag {
  /** Byte length of the raw response string (0 on transport error) */
  rawResponseBytes: number;
  /**
   * First 500 characters of the raw response — useful when tweetsExtracted
   * is 0 and the shape looks unexpected (stale queryId, rate-limit JSON, etc.)
   */
  rawResponsePreview: string;
  /** Number of TimelineAddEntries instructions found in the response */
  instructionsFound: number;
  /** Tweets extracted from all instructions before normalization */
  tweetsExtracted: number;
  /** Items produced by tweetsToFeedItems() */
  itemsNormalized: number;
  /** Items remaining after deduplicateFeedItems() */
  itemsDeduplicated: number;
  /**
   * Items actually written to the CRDT store (new items only — items already
   * present are skipped). Set by captureXTimeline after addItems() returns.
   */
  itemsAdded: number;
  /**
   * Pipeline stage where the first anomaly occurred, or null for a clean run.
   * Possible values: "parse" | "auth" | "rate_limit" | "instructions" | "normalize"
   */
  errorStage: string | null;
  /** Human-readable description of the error, or null */
  errorMessage: string | null;
}

export interface XSyncResult {
  items: ReturnType<typeof tweetsToFeedItems>;
  diag: XSyncDiag;
}

export interface XThreadResult {
  replies: ReturnType<typeof tweetsToFeedItems>;
  errorStage: string | null;
  errorMessage: string | null;
}

// =============================================================================
// Transport Layer
// =============================================================================

function buildXHeaders(cookies: XCookies, isPost = false): Array<[string, string]> {
  const ua = getPlatformUA("x");
  const chromeVersion = extractChromeVersion(ua) ?? "131";
  const platform = osPlatformHeader();

  // Headers in Chrome's canonical order — ordering is preserved end-to-end
  // because we use Vec<(String, String)> in the Rust backend rather than HashMap.
  const headers: Array<[string, string]> = [
    ["authorization", `Bearer ${X_BEARER_TOKEN}`],
    ["accept", "*/*"],
    ["accept-language", "en-US,en;q=0.9"],
    ["accept-encoding", "gzip, deflate, br"],
    ...(isPost ? [["content-type", "application/json"] as [string, string]] : []),
    ["x-csrf-token", cookies.ct0],
    ["x-twitter-active-user", "yes"],
    ["x-twitter-auth-type", "OAuth2Session"],
    ["x-twitter-client-language", "en"],
    ["sec-ch-ua", `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-platform", platform],
    ["sec-fetch-site", "same-site"],
    ["sec-fetch-mode", "cors"],
    ["sec-fetch-dest", "empty"],
    ["origin", "https://twitter.com"],
    ["referer", "https://twitter.com/"],
    ["cookie", `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`],
  ];

  return headers;
}

async function xRequest(
  cookies: XCookies,
  endpoint: { queryId: string; operationName: string; features: Record<string, boolean> },
  variables: Record<string, unknown>,
  requester: XRequester,
): Promise<string> {
  // X read-only GraphQL endpoints use GET with variables/features as URL params.
  // Sending them as POST causes 422 GRAPHQL_VALIDATION_FAILED.
  const base = `${X_API_BASE}/${endpoint.queryId}/${endpoint.operationName}`;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(endpoint.features),
  });
  const url = `${base}?${params.toString()}`;

  return requester(url, "", buildXHeaders(cookies, false), "GET");
}

function collectTweets(value: unknown, tweets: XTweetResult[], seen: Set<string>): void {
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const typename = record.__typename;
  const legacy = record.legacy;
  const restId = record.rest_id;
  if (
    (typename === "Tweet" || typename === "TweetWithVisibilityResults") &&
    typeof restId === "string" &&
    legacy &&
    typeof legacy === "object" &&
    !seen.has(restId)
  ) {
    seen.add(restId);
    tweets.push(value as XTweetResult);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTweets(item, tweets, seen);
    return;
  }

  for (const child of Object.values(record)) {
    collectTweets(child, tweets, seen);
  }
}

// =============================================================================
// Timeline Fetch
// =============================================================================

/**
 * Fetch the home latest timeline from X and return items alongside
 * per-stage diagnostics.
 *
 * @param cookies  Valid X session cookies.
 * @param requester  Optional transport override — pass a fixture function in
 *                   tests to avoid hitting Tauri IPC.
 */
export async function fetchXTimeline(
  cookies: XCookies,
  requester: XRequester = defaultRequester,
): Promise<XSyncResult> {
  const diag: XSyncDiag = {
    rawResponseBytes: 0,
    rawResponsePreview: "",
    instructionsFound: 0,
    tweetsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    errorStage: null,
    errorMessage: null,
  };

  let rawResponse: string;

  try {
    addDebugEvent("change", "[X] requesting home timeline");
    rawResponse = await xRequest(
      cookies,
      HomeLatestTimeline,
      getHomeLatestTimelineVariables(),
      requester,
    );
  } catch (err) {
    diag.errorStage = "transport";
    diag.errorMessage = err instanceof Error ? err.message : String(err);
    return { items: [], diag };
  }

  diag.rawResponseBytes = rawResponse.length;
  diag.rawResponsePreview = rawResponse.slice(0, 500);
  addDebugEvent(
    "change",
    `[X] response received: ${diag.rawResponseBytes.toLocaleString()} bytes`,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (err) {
    diag.errorStage = "parse";
    diag.errorMessage = `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`;
    return { items: [], diag };
  }

  // Detect auth/rate-limit errors returned as valid JSON (not HTTP errors)
  const asError = parsed as { errors?: Array<{ code: number; message?: string }> };
  if (Array.isArray(asError?.errors) && asError.errors.length > 0) {
    const code = asError.errors[0].code;
    if (code === 32 || code === 89 || code === 135 || code === 326) {
      diag.errorStage = "auth";
      diag.errorMessage =
        asError.errors[0].message ?? `X auth error (code ${code})`;
      return { items: [], diag };
    }
    if (code === 88) {
      diag.errorStage = "provider_rate_limit";
      diag.errorMessage = "Rate limit exceeded — try again in 15 minutes.";
      return { items: [], diag };
    }
    // Unknown error code: fall through and let the instructions check catch it
    diag.errorStage = "api_error";
    diag.errorMessage =
      asError.errors[0].message ?? `X API error (code ${code})`;
    return { items: [], diag };
  }

  // Raw X API wraps in { data: { home: ... } }; capture-x client unwraps
  // the data layer but desktop hits the API directly via Tauri invoke.
  const wrapped = parsed as { data?: TimelineResponse };
  const unwrapped = parsed as TimelineResponse;
  const home = wrapped?.data?.home ?? unwrapped?.home;
  const instructions = home?.home_timeline_urt?.instructions ?? [];
  addDebugEvent(
    "change",
    `[X] parsed ${instructions.length.toLocaleString()} timeline instruction${instructions.length === 1 ? "" : "s"}`,
  );

  if (instructions.length === 0) {
    diag.errorStage = "instructions";
    diag.errorMessage =
      "Response parsed but contained no timeline instructions. " +
      "The queryId may be stale or the response shape has changed.";
    return { items: [], diag };
  }

  const tweets: XTweetResult[] = [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" && instruction.entries) {
      diag.instructionsFound++;
      for (const entry of instruction.entries) {
        if (entry.entryId?.startsWith("promoted-tweet-")) {
          continue;
        }
        const tweet = entry.content?.itemContent?.tweet_results?.result;
        if (
          tweet &&
          (tweet.__typename === "Tweet" ||
            tweet.__typename === "TweetWithVisibilityResults")
        ) {
          tweets.push(tweet);
        }
      }
    }
  }

  diag.tweetsExtracted = tweets.length;
  addDebugEvent(
    "change",
    `[X] extracted ${diag.tweetsExtracted.toLocaleString()} timeline tweet${diag.tweetsExtracted === 1 ? "" : "s"}`,
  );

  if (tweets.length === 0) {
    // Not an error per se — the timeline may genuinely be empty.
    return { items: [], diag };
  }

  let normalized: ReturnType<typeof tweetsToFeedItems>;
  try {
    normalized = tweetsToFeedItems(tweets);
  } catch (err) {
    diag.errorStage = "normalize";
    diag.errorMessage = err instanceof Error ? err.message : String(err);
    return { items: [], diag };
  }

  diag.itemsNormalized = normalized.length;
  addDebugEvent(
    "change",
    `[X] normalized ${diag.itemsNormalized.toLocaleString()} item${diag.itemsNormalized === 1 ? "" : "s"}`,
  );

  const items = deduplicateFeedItems(normalized);
  diag.itemsDeduplicated = items.length;
  addDebugEvent(
    "change",
    `[X] deduplicated to ${diag.itemsDeduplicated.toLocaleString()} item${diag.itemsDeduplicated === 1 ? "" : "s"}`,
  );

  return { items, diag };
}

export async function fetchXThreadReplies(
  tweetId: string,
  cookies: XCookies,
  requester: XRequester = defaultRequester,
): Promise<XThreadResult> {
  let rawResponse: string;
  try {
    rawResponse = await xRequest(
      cookies,
      TweetDetail,
      getTweetDetailVariables(tweetId),
      requester,
    );
  } catch (err) {
    return {
      replies: [],
      errorStage: "transport",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (err) {
    return {
      replies: [],
      errorStage: "parse",
      errorMessage: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const tweets: XTweetResult[] = [];
  collectTweets(parsed, tweets, new Set());
  const normalized = tweetsToFeedItems(tweets).filter((item) => {
    if (item.globalId === `x:${tweetId}`) return false;
    return item.sourceUrl !== `https://x.com/${item.author.handle}/status/${tweetId}`;
  });

  return {
    replies: deduplicateFeedItems(normalized).slice(0, 25),
    errorStage: null,
    errorMessage: null,
  };
}

// =============================================================================
// Mutation Transport
// =============================================================================

/**
 * Send a POST mutation to the X GraphQL API (like/unlike).
 * Returns the raw response string; throws on HTTP error.
 */
async function xMutationRequest(
  cookies: XCookies,
  url: string,
  body: string,
  requester: XRequester,
): Promise<string> {
  return requester(url, body, buildXHeaders(cookies, true), "POST");
}

/**
 * Like a tweet via X's FavoriteTweet GraphQL mutation.
 *
 * @param tweetId - The tweet's rest_id (numeric string)
 * @param cookies - Valid X session cookies
 * @param requester - Optional transport override for testing
 * @returns true on success, false on failure
 */
export async function favoriteTweet(
  tweetId: string,
  cookies: XCookies,
  requester: XRequester = defaultRequester,
): Promise<boolean> {
  try {
    const url = buildMutationUrl(FavoriteTweet);
    const body = buildMutationBody(FavoriteTweet, tweetId);
    await xMutationRequest(cookies, url, body, requester);
    addDebugEvent("change", `[X] liked tweet ${tweetId}`);
    return true;
  } catch (err) {
    addDebugEvent("error", `[X] favoriteTweet failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Unlike a tweet via X's UnfavoriteTweet GraphQL mutation.
 *
 * @param tweetId - The tweet's rest_id (numeric string)
 * @param cookies - Valid X session cookies
 * @param requester - Optional transport override for testing
 * @returns true on success, false on false
 */
export async function unfavoriteTweet(
  tweetId: string,
  cookies: XCookies,
  requester: XRequester = defaultRequester,
): Promise<boolean> {
  try {
    const url = buildMutationUrl(UnfavoriteTweet);
    const body = buildMutationBody(UnfavoriteTweet, tweetId);
    await xMutationRequest(cookies, url, body, requester);
    addDebugEvent("change", `[X] unliked tweet ${tweetId}`);
    return true;
  } catch (err) {
    addDebugEvent("error", `[X] unfavoriteTweet failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture the X timeline and persist new items to the Automerge store.
 * Returns the full sync result including per-stage diagnostics.
 *
 * @param cookies   Valid X session cookies.
 * @param requester Optional transport override for testing.
 */
export async function captureXTimeline(
  cookies: XCookies,
  requester: XRequester = defaultRequester,
): Promise<XSyncResult> {
  const store = useAppStore.getState();
  const startedAt = Date.now();

  store.setLoading(true);
  store.setError(null);

  try {
    const pause = getProviderPause("x");
    if (pause) {
      return {
        items: [],
        diag: {
          rawResponseBytes: 0,
          rawResponsePreview: "",
          instructionsFound: 0,
          tweetsExtracted: 0,
          itemsNormalized: 0,
          itemsDeduplicated: 0,
          itemsAdded: 0,
          errorStage: "provider_rate_limit",
          errorMessage: pause.pauseReason,
        },
      };
    }

    addDebugEvent("change", "[X] sync started");
    const result = await fetchXTimeline(cookies, requester);

    if (result.diag.errorStage) {
      const detail = `[X] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      addDebugEvent("error", detail);
      const nextAuth =
        result.diag.errorStage === "auth"
          ? { isAuthenticated: false, lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage }
          : {
              ...store.xAuth,
              lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage,
            };
      if (result.diag.errorStage === "auth") {
        clearStoredCookies();
      }
      store.setXAuth(nextAuth);
      await recordProviderHealthEvent({
        provider: "x",
        outcome:
          result.diag.errorStage === "provider_rate_limit"
            ? "provider_rate_limit"
            : "error",
        stage: result.diag.errorStage,
        reason: result.diag.errorMessage ?? result.diag.errorStage,
        startedAt,
        finishedAt: Date.now(),
        itemsSeen: result.diag.tweetsExtracted,
        itemsAdded: result.diag.itemsAdded,
        signalType:
          result.diag.errorStage === "provider_rate_limit" ? "explicit" : "none",
      });
      return result;
    }

    if (result.items.length > 0) {
      addDebugEvent(
        "change",
        `[X] writing ${result.items.length.toLocaleString()} candidate item${result.items.length === 1 ? "" : "s"} to the library`,
      );
      const before = store.items.filter((i) => i.platform === "x").length;
      await store.addItems(result.items);
      const after = useAppStore.getState().items.filter((i) => i.platform === "x").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      addDebugEvent(
        "change",
        `[X] synced: ${result.diag.tweetsExtracted} tweets → ${result.diag.itemsAdded} new items`,
      );
    } else {
      addDebugEvent("change", `[X] sync complete: timeline returned 0 tweets`);
    }

    store.setXAuth({
      ...store.xAuth,
      lastCapturedAt: Date.now(),
      lastCaptureError: undefined,
    });
    await recordProviderHealthEvent({
      provider: "x",
      outcome: result.diag.tweetsExtracted > 0 ? "success" : "empty",
      stage: result.diag.tweetsExtracted > 0 ? undefined : "empty",
      reason: result.diag.tweetsExtracted > 0 ? undefined : "No tweets pulled",
      startedAt,
      finishedAt: Date.now(),
      itemsSeen: result.diag.tweetsExtracted,
      itemsAdded: result.diag.itemsAdded,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture X timeline";
    store.setError(message);
    addDebugEvent("error", `[X] captureXTimeline threw: ${message}`);
    store.setXAuth({
      ...store.xAuth,
      lastCaptureError: message,
    });
    await recordProviderHealthEvent({
      provider: "x",
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
