/**
 * X/Twitter specific types
 * 
 * These types represent the raw data structures returned by X's GraphQL API.
 * Based on community research: github.com/fa0311/TwitterInternalAPIDocument
 */

// =============================================================================
// Authentication
// =============================================================================

export interface XCookies {
  /** CSRF token */
  ct0: string
  /** Auth token */
  authToken: string
}

export interface XAuthHeaders {
  authorization: string
  'x-csrf-token': string
  cookie: string
  'content-type': string
  'x-twitter-active-user': string
  'x-twitter-auth-type': string
  'x-twitter-client-language': string
}

// =============================================================================
// API Response Types
// =============================================================================

export interface XApiResponse<T> {
  data: T
  errors?: XApiError[]
}

export interface XApiError {
  message: string
  code: number
}

// =============================================================================
// Timeline Types
// =============================================================================

export interface TimelineResponse {
  home: {
    home_timeline_urt: {
      instructions: TimelineInstruction[]
      responseObjects?: {
        feedbackActions?: unknown[]
      }
    }
  }
}

export interface TimelineInstruction {
  type: 'TimelineAddEntries' | 'TimelineClearCache' | 'TimelinePinEntry'
  entries?: TimelineEntry[]
}

export interface TimelineEntry {
  entryId: string
  sortIndex: string
  content: TimelineEntryContent
}

export interface TimelineEntryContent {
  entryType: 'TimelineTimelineItem' | 'TimelineTimelineCursor' | 'TimelineTimelineModule'
  __typename: string
  itemContent?: TimelineItemContent
  value?: string // For cursors
  cursorType?: 'Top' | 'Bottom'
}

export interface TimelineItemContent {
  itemType: 'TimelineTweet' | 'TimelineUser'
  __typename: string
  tweet_results?: {
    result: XTweetResult
  }
  tweetDisplayType?: string
}

// =============================================================================
// Tweet Types
// =============================================================================

export interface XTweetResult {
  __typename: 'Tweet' | 'TweetWithVisibilityResults' | 'TweetTombstone'
  rest_id: string
  core: XTweetCore
  legacy: XTweetLegacy
  views?: XTweetViews
  card?: XCard
  quoted_status_result?: {
    result: XTweetResult
  }
  note_tweet?: {
    note_tweet_results: {
      result: {
        text: string
        entity_set: XEntitySet
      }
    }
  }
}

export interface XTweetCore {
  user_results: {
    result: XUserResult
  }
}

export interface XUserResult {
  __typename: 'User'
  id: string
  rest_id: string
  legacy: XUserLegacy
  is_blue_verified?: boolean
  profile_image_shape?: string
}

export interface XUserLegacy {
  id_str: string
  name: string
  screen_name: string
  description?: string
  location?: string
  url?: string
  followers_count: number
  friends_count: number
  statuses_count: number
  profile_image_url_https: string
  profile_banner_url?: string
  verified?: boolean
  created_at: string
}

export interface XTweetLegacy {
  id_str: string
  full_text: string
  created_at: string
  favorite_count: number
  retweet_count: number
  reply_count: number
  quote_count: number
  bookmark_count?: number
  conversation_id_str: string
  in_reply_to_status_id_str?: string
  in_reply_to_user_id_str?: string
  in_reply_to_screen_name?: string
  is_quote_status: boolean
  lang: string
  entities: XEntitySet
  extended_entities?: XExtendedEntities
  retweeted_status_result?: {
    result: XTweetResult
  }
}

export interface XTweetViews {
  count?: string
  state: string
}

// =============================================================================
// Entity Types
// =============================================================================

export interface XEntitySet {
  urls?: XUrlEntity[]
  hashtags?: XHashtagEntity[]
  user_mentions?: XUserMentionEntity[]
  media?: XMediaEntity[]
  symbols?: XSymbolEntity[]
}

export interface XExtendedEntities {
  media?: XMediaEntity[]
}

export interface XUrlEntity {
  url: string
  expanded_url: string
  display_url: string
  indices: [number, number]
}

export interface XHashtagEntity {
  text: string
  indices: [number, number]
}

export interface XUserMentionEntity {
  id_str: string
  name: string
  screen_name: string
  indices: [number, number]
}

export interface XMediaEntity {
  id_str: string
  media_url_https: string
  url: string
  expanded_url: string
  type: 'photo' | 'video' | 'animated_gif'
  sizes: {
    thumb: XMediaSize
    small: XMediaSize
    medium: XMediaSize
    large: XMediaSize
  }
  video_info?: {
    duration_millis: number
    variants: XVideoVariant[]
  }
}

export interface XMediaSize {
  w: number
  h: number
  resize: 'fit' | 'crop'
}

export interface XVideoVariant {
  bitrate?: number
  content_type: string
  url: string
}

export interface XSymbolEntity {
  text: string
  indices: [number, number]
}

// =============================================================================
// Card Types (Link Previews)
// =============================================================================

export interface XCard {
  rest_id: string
  legacy: {
    binding_values: XCardBindingValue[]
    card_platform: {
      platform: {
        device: {
          name: string
          version: string
        }
      }
    }
    name: string
    url: string
  }
}

export interface XCardBindingValue {
  key: string
  value: {
    string_value?: string
    image_value?: {
      url: string
      width: number
      height: number
    }
  }
}

// =============================================================================
// User Following Types
// =============================================================================

export interface FollowingResponse {
  user: {
    result: {
      timeline: {
        timeline: {
          instructions: FollowingInstruction[]
        }
      }
    }
  }
}

export interface FollowingInstruction {
  type: 'TimelineAddEntries' | 'TimelineClearCache'
  entries?: FollowingEntry[]
}

export interface FollowingEntry {
  entryId: string
  sortIndex: string
  content: {
    entryType: 'TimelineTimelineItem'
    itemContent?: {
      user_results: {
        result: XUserResult
      }
    }
  }
}

// =============================================================================
// Rate Limiting
// =============================================================================

export interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
}
