/**
 * X/Twitter capture service
 *
 * Fetches tweets from X's GraphQL API via Tauri backend.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FeedItem } from "@freed/shared";
import type { XCookies } from "./x-auth";
import { useAppStore } from "./store";

// X API Constants (from capture-x package)
const X_API_BASE = "https://x.com/i/api/graphql";
const X_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Query IDs (may need updates if X changes them)
const HomeLatestTimeline = {
  queryId: "HJFjzBgCs16TqxewQOeLNg",
  operationName: "HomeLatestTimeline",
};

// Feature flags
const TIMELINE_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_home_pinned_timelines_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  blue_business_profile_image_shape_enabled: true,
  profile_foundations_has_custom_visual_feature_enabled: false,
};

// Types
interface XTweetResult {
  __typename: string;
  rest_id: string;
  core: {
    user_results: {
      result: {
        rest_id: string;
        legacy: {
          screen_name: string;
          name: string;
          profile_image_url_https: string;
        };
      };
    };
  };
  legacy: {
    full_text: string;
    created_at: string;
    favorite_count: number;
    retweet_count: number;
    reply_count: number;
    entities: {
      urls?: { expanded_url: string }[];
      hashtags?: { text: string }[];
      media?: { media_url_https: string; type: string }[];
    };
    extended_entities?: {
      media?: { media_url_https: string; type: string; video_info?: { variants: { url: string; bitrate?: number }[] } }[];
    };
    retweeted_status_result?: { result: XTweetResult };
  };
  views?: { count?: string };
  note_tweet?: { note_tweet_results: { result: { text: string } } };
}

/**
 * Make authenticated request to X API via Tauri
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

  // Use Tauri backend to make the request
  const response = await invoke<string>("x_api_request", {
    url,
    body,
    headers,
  });

  return JSON.parse(response);
}

/**
 * Convert X tweet to FeedItem
 */
function tweetToFeedItem(tweet: XTweetResult): FeedItem {
  // Handle retweets
  const isRetweet = !!tweet.legacy.retweeted_status_result?.result;
  const displayTweet = isRetweet
    ? tweet.legacy.retweeted_status_result!.result
    : tweet;

  // Get tweet text
  let text = displayTweet.legacy.full_text;
  if (displayTweet.note_tweet?.note_tweet_results?.result?.text) {
    text = displayTweet.note_tweet.note_tweet_results.result.text;
  }

  // Expand URLs in text
  if (displayTweet.legacy.entities.urls) {
    for (const url of displayTweet.legacy.entities.urls) {
      text = text.replace(/https:\/\/t\.co\/\w+/, url.expanded_url);
    }
  }

  // Extract media
  const media = displayTweet.legacy.extended_entities?.media || displayTweet.legacy.entities.media || [];
  const mediaUrls: string[] = [];
  const mediaTypes: Array<"image" | "video" | "link"> = [];

  for (const item of media) {
    if (item.type === "photo") {
      mediaUrls.push(item.media_url_https + ":large");
      mediaTypes.push("image");
    } else if (item.type === "video" || item.type === "animated_gif") {
      const variants = item.video_info?.variants || [];
      const mp4 = variants
        .filter(v => v.url.includes(".mp4"))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (mp4) {
        mediaUrls.push(mp4.url);
        mediaTypes.push("video");
      }
    }
  }

  // Extract topics from hashtags
  const topics = displayTweet.legacy.entities.hashtags?.map(h => h.text.toLowerCase()) || [];

  const publishedAt = new Date(displayTweet.legacy.created_at).getTime();

  return {
    globalId: `x:${displayTweet.rest_id}`,
    platform: "x",
    contentType: "post",
    capturedAt: Date.now(),
    publishedAt,
    author: {
      id: displayTweet.core.user_results.result.rest_id,
      handle: displayTweet.core.user_results.result.legacy.screen_name,
      displayName: displayTweet.core.user_results.result.legacy.name,
      avatarUrl: displayTweet.core.user_results.result.legacy.profile_image_url_https.replace("_normal", "_bigger"),
    },
    content: {
      text: text.trim(),
      mediaUrls,
      mediaTypes,
    },
    engagement: {
      likes: displayTweet.legacy.favorite_count,
      reposts: displayTweet.legacy.retweet_count,
      comments: displayTweet.legacy.reply_count,
      views: displayTweet.views?.count ? parseInt(displayTweet.views.count) : undefined,
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics,
  };
}

/**
 * Fetch X timeline
 */
export async function fetchXTimeline(cookies: XCookies): Promise<FeedItem[]> {
  const variables = {
    count: 20,
    includePromotedContent: false,
    latestControlAvailable: true,
    requestContext: "launch",
    withCommunity: true,
  };

  const response = await xRequest(cookies, HomeLatestTimeline, variables) as {
    data: {
      home: {
        home_timeline_urt: {
          instructions: Array<{
            type: string;
            entries?: Array<{
              content: {
                itemContent?: {
                  tweet_results?: {
                    result: XTweetResult;
                  };
                };
              };
            }>;
          }>;
        };
      };
    };
  };

  const tweets: XTweetResult[] = [];
  const instructions = response.data?.home?.home_timeline_urt?.instructions || [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" && instruction.entries) {
      for (const entry of instruction.entries) {
        const tweet = entry.content?.itemContent?.tweet_results?.result;
        if (tweet && (tweet.__typename === "Tweet" || tweet.__typename === "TweetWithVisibilityResults")) {
          tweets.push(tweet);
        }
      }
    }
  }

  return tweets
    .filter(t => t.__typename !== "TweetTombstone")
    .map(tweetToFeedItem);
}

/**
 * Capture X timeline and add to store
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
    const message = error instanceof Error ? error.message : "Failed to capture X timeline";
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
}
