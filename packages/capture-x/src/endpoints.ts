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
 * Common feature flags shared across endpoints.
 * Derived from the current X web client (TwitterInternalAPIDocument).
 */
export const COMMON_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

/**
 * Timeline-specific features (HomeTimeline / HomeLatestTimeline).
 * Same set as COMMON_FEATURES for now — kept separate for future divergence.
 */
export const TIMELINE_FEATURES = {
  ...COMMON_FEATURES,
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
  queryId: "vIA2Cqe3OdTO9TTi75kXqA",
  operationName: "HomeLatestTimeline",
  features: TIMELINE_FEATURES,
};

/**
 * HomeTimeline - Get algorithmic "For You" feed
 */
export const HomeTimeline: EndpointDefinition = {
  queryId: "5HIFewm4IR4zjZoYSa1vBg",
  operationName: "HomeTimeline",
  features: TIMELINE_FEATURES,
};

/**
 * Following - Get list of accounts user follows
 */
export const Following: EndpointDefinition = {
  queryId: "gGVkcwUnM_ISWg3NIby2TA",
  operationName: "Following",
  features: COMMON_FEATURES,
};

/**
 * UserTweets - Get tweets from a specific user
 */
export const UserTweets: EndpointDefinition = {
  queryId: "N9_71NodX1yntoC5pa4IFw",
  operationName: "UserTweets",
  features: COMMON_FEATURES,
};

/**
 * TweetDetail - Get a single tweet with replies
 */
export const TweetDetail: EndpointDefinition = {
  queryId: "flqCy6kvOMolEquuRpOaHQ",
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
 * Build the request body for a GraphQL request.
 *
 * X's modern API expects variables and features as plain JSON objects (not
 * double-stringified), with queryId included in the body alongside them.
 */
export function buildRequestBody(
  endpoint: EndpointDefinition,
  variables: Record<string, unknown>,
): string {
  return JSON.stringify({
    variables,
    features: endpoint.features,
    queryId: endpoint.queryId,
  });
}

/**
 * Default variables for HomeLatestTimeline.
 *
 * X's schema only validates the variable names it declares. Sending unknown
 * variables (e.g. `requestContext`, `withCommunity`) causes a 422
 * GRAPHQL_VALIDATION_FAILED. Keeping this to the documented minimum set.
 */
export function getHomeLatestTimelineVariables(
  cursor?: string,
  count: number = 20,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    count,
    includePromotedContent: true,
    latestControlAvailable: true,
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
