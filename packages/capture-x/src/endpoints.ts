/**
 * X/Twitter GraphQL endpoint definitions
 *
 * Query IDs and feature flags are subject to change.
 * Reference: github.com/fa0311/TwitterInternalAPIDocument
 */

// =============================================================================
// Base Configuration
// =============================================================================

export const X_API_BASE = "https://x.com/i/api/graphql";

/**
 * Static bearer token used by X web client
 * This is a public token - authentication is done via cookies
 */
export const X_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// =============================================================================
// Feature Flags
// =============================================================================

/**
 * Common feature flags required by most endpoints
 */
export const COMMON_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
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
};

/**
 * Timeline-specific features
 */
export const TIMELINE_FEATURES = {
  ...COMMON_FEATURES,
  responsive_web_home_pinned_timelines_enabled: true,
  blue_business_profile_image_shape_enabled: true,
  profile_foundations_has_custom_visual_feature_enabled: false,
};

// =============================================================================
// Endpoint Definitions
// =============================================================================

export interface EndpointDefinition {
  /** GraphQL query ID (changes occasionally) */
  queryId: string;
  /** Endpoint name */
  operationName: string;
  /** Required feature flags */
  features: Record<string, boolean>;
}

/**
 * HomeLatestTimeline - Get chronological "Following" feed
 */
export const HomeLatestTimeline: EndpointDefinition = {
  queryId: "HJFjzBgCs16TqxewQOeLNg",
  operationName: "HomeLatestTimeline",
  features: TIMELINE_FEATURES,
};

/**
 * HomeTimeline - Get algorithmic "For You" feed
 */
export const HomeTimeline: EndpointDefinition = {
  queryId: "s6ERr1UxkxxBx4YundNsXw",
  operationName: "HomeTimeline",
  features: TIMELINE_FEATURES,
};

/**
 * Following - Get list of accounts user follows
 */
export const Following: EndpointDefinition = {
  queryId: "eWTmcJY3EMh-dxIR7CYTKw",
  operationName: "Following",
  features: COMMON_FEATURES,
};

/**
 * UserTweets - Get tweets from a specific user
 */
export const UserTweets: EndpointDefinition = {
  queryId: "E3opETHurmVJflFsUBVuUQ",
  operationName: "UserTweets",
  features: COMMON_FEATURES,
};

/**
 * TweetDetail - Get a single tweet with replies
 */
export const TweetDetail: EndpointDefinition = {
  queryId: "VWFGPVAGkZMGRKGe3GFFnA",
  operationName: "TweetDetail",
  features: COMMON_FEATURES,
};

// =============================================================================
// Request Building
// =============================================================================

/**
 * Build the URL for a GraphQL request
 */
export function buildGraphQLUrl(endpoint: EndpointDefinition): string {
  return `${X_API_BASE}/${endpoint.queryId}/${endpoint.operationName}`;
}

/**
 * Build the request body for a GraphQL request
 */
export function buildRequestBody(
  endpoint: EndpointDefinition,
  variables: Record<string, unknown>,
): string {
  return JSON.stringify({
    variables: JSON.stringify(variables),
    features: JSON.stringify(endpoint.features),
  });
}

/**
 * Default variables for HomeLatestTimeline
 */
export function getHomeLatestTimelineVariables(
  cursor?: string,
  count: number = 20,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    count,
    includePromotedContent: true,
    latestControlAvailable: true,
    requestContext: "launch",
    withCommunity: true,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  return variables;
}

/**
 * Default variables for Following
 */
export function getFollowingVariables(
  userId: string,
  cursor?: string,
  count: number = 20,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    userId,
    count,
    includePromotedContent: false,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  return variables;
}

/**
 * Default variables for UserTweets
 */
export function getUserTweetsVariables(
  userId: string,
  cursor?: string,
  count: number = 20,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    userId,
    count,
    includePromotedContent: true,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  return variables;
}
