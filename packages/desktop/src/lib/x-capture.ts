/**
 * X/Twitter capture service
 *
 * Makes authenticated requests to X's GraphQL API via the Tauri backend
 * (which bypasses CORS/CSP restrictions the renderer would otherwise hit).
 *
 * All constants, types, and normalization logic live in @freed/capture-x.
 * This file owns only the Tauri transport adapter (xRequest) and the
 * store-integration layer (captureXTimeline).
 */

import { invoke } from "@tauri-apps/api/core";
import {
  X_API_BASE,
  X_BEARER_TOKEN,
  HomeLatestTimeline,
  TIMELINE_FEATURES,
  tweetsToFeedItems,
  deduplicateFeedItems,
  getHomeLatestTimelineVariables,
} from "@freed/capture-x";
import type { XTweetResult, TimelineResponse } from "@freed/capture-x";
import type { XCookies } from "./x-auth";
import { useAppStore } from "./store";

/**
 * Make an authenticated request to the X GraphQL API via Tauri.
 *
 * The Tauri backend handles the actual HTTP request, bypassing the CORS and
 * CSP restrictions that would block the renderer from calling x.com directly.
 */
async function xRequest(
  cookies: XCookies,
  endpoint: { queryId: string; operationName: string },
  variables: Record<string, unknown>
): Promise<unknown> {
  const url = `${X_API_BASE}/${endpoint.queryId}/${endpoint.operationName}`;

  const body = JSON.stringify({
    variables: JSON.stringify(variables),
    features: JSON.stringify(TIMELINE_FEATURES),
  });

  const headers = {
    authorization: `Bearer ${X_BEARER_TOKEN}`,
    "x-csrf-token": cookies.ct0,
    cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
    "content-type": "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
  };

  const response = await invoke<string>("x_api_request", {
    url,
    body,
    headers,
  });

  return JSON.parse(response);
}

/**
 * Fetch the home latest timeline from X
 */
export async function fetchXTimeline(cookies: XCookies): Promise<ReturnType<typeof tweetsToFeedItems>> {
  const variables = getHomeLatestTimelineVariables();
  const response = await xRequest(cookies, HomeLatestTimeline, variables) as TimelineResponse;

  const tweets: XTweetResult[] = [];
  const instructions =
    response.data?.home?.home_timeline_urt?.instructions || [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" && instruction.entries) {
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

  return deduplicateFeedItems(tweetsToFeedItems(tweets));
}

/**
 * Capture the X timeline and persist items to the Automerge store
 */
export async function captureXTimeline(cookies: XCookies): Promise<void> {
  const store = useAppStore.getState();

  store.setLoading(true);
  store.setError(null);

  try {
    const items = await fetchXTimeline(cookies);
    if (items.length > 0) {
      await store.addItems(items);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture X timeline";
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
}
