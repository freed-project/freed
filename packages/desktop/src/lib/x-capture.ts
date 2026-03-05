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
  tweetsToFeedItems,
  deduplicateFeedItems,
  getHomeLatestTimelineVariables,
} from "@freed/capture-x/browser";
import type { XTweetResult, TimelineResponse } from "@freed/capture-x/browser";
import type { XCookies } from "./x-auth";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";

// =============================================================================
// Injectable Transport
// =============================================================================

/**
 * A function that sends an HTTP request to the X API and returns the raw
 * response body as a string. In production this calls Tauri's x_api_request
 * command; in tests any function that returns fixture JSON can be substituted.
 *
 * `method` defaults to "GET" — X's read-only GraphQL endpoints expect GET
 * with variables/features encoded as URL query params.
 */
export type XRequester = (
  url: string,
  body: string,
  headers: Record<string, string>,
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

// =============================================================================
// Transport Layer
// =============================================================================

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

  const headers: Record<string, string> = {
    authorization: `Bearer ${X_BEARER_TOKEN}`,
    "x-csrf-token": cookies.ct0,
    cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
  };

  return requester(url, "", headers, "GET");
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
      diag.errorStage = "rate_limit";
      diag.errorMessage = "Rate limit exceeded — try again in 15 minutes.";
      return { items: [], diag };
    }
    // Unknown error code: fall through and let the instructions check catch it
    diag.errorStage = "api_error";
    diag.errorMessage =
      asError.errors[0].message ?? `X API error (code ${code})`;
    return { items: [], diag };
  }

  const response = parsed as TimelineResponse;
  const instructions = response?.home?.home_timeline_urt?.instructions ?? [];

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

  const items = deduplicateFeedItems(normalized);
  diag.itemsDeduplicated = items.length;

  return { items, diag };
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

  store.setLoading(true);
  store.setError(null);

  try {
    const result = await fetchXTimeline(cookies, requester);

    if (result.diag.errorStage) {
      const detail = `[X] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      addDebugEvent("error", detail);
      return result;
    }

    if (result.items.length > 0) {
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

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture X timeline";
    store.setError(message);
    addDebugEvent("error", `[X] captureXTimeline threw: ${message}`);
    throw error;
  } finally {
    store.setLoading(false);
  }
}
