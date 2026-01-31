/**
 * X/Twitter GraphQL Client
 * 
 * Handles authenticated requests to X's internal GraphQL API.
 */

import type {
  XCookies,
  XAuthHeaders,
  XApiResponse,
  TimelineResponse,
  TimelineEntry,
  XTweetResult,
  FollowingResponse,
  XUserResult,
  RateLimitInfo
} from './types.js'

import {
  X_BEARER_TOKEN,
  HomeLatestTimeline,
  Following,
  UserTweets,
  buildGraphQLUrl,
  buildRequestBody,
  getHomeLatestTimelineVariables,
  getFollowingVariables,
  getUserTweetsVariables,
  type EndpointDefinition
} from './endpoints.js'

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_RETRY_COUNT = 3
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

// =============================================================================
// Client Implementation
// =============================================================================

export class XClient {
  private cookies: XCookies
  private rateLimitInfo: RateLimitInfo | null = null
  
  constructor(cookies: XCookies) {
    this.cookies = cookies
  }
  
  /**
   * Build authentication headers for requests
   */
  private buildHeaders(): XAuthHeaders {
    return {
      authorization: `Bearer ${X_BEARER_TOKEN}`,
      'x-csrf-token': this.cookies.ct0,
      cookie: `ct0=${this.cookies.ct0}; auth_token=${this.cookies.authToken}`,
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en'
    }
  }
  
  /**
   * Make an authenticated request with retry logic
   */
  private async request<T>(
    endpoint: EndpointDefinition,
    variables: Record<string, unknown>,
    retryCount: number = DEFAULT_RETRY_COUNT
  ): Promise<T> {
    const url = buildGraphQLUrl(endpoint)
    const body = buildRequestBody(endpoint, variables)
    const headers = this.buildHeaders()
    
    let lastError: Error | null = null
    let backoffMs = INITIAL_BACKOFF_MS
    
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        // Check rate limit before making request
        if (this.rateLimitInfo && this.rateLimitInfo.remaining === 0) {
          const waitTime = (this.rateLimitInfo.reset * 1000) - Date.now()
          if (waitTime > 0) {
            console.log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`)
            await this.sleep(waitTime)
          }
        }
        
        const response = await fetch(url, {
          method: 'POST',
          headers: headers as unknown as HeadersInit,
          body
        })
        
        // Update rate limit info from headers
        this.updateRateLimitInfo(response.headers)
        
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoffMs
          console.log(`Rate limited (429). Waiting ${Math.ceil(waitTime / 1000)}s...`)
          await this.sleep(waitTime)
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
          continue
        }
        
        // Handle other errors
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        const data = await response.json() as XApiResponse<T>
        
        // Check for GraphQL errors
        if (data.errors && data.errors.length > 0) {
          const errorMessages = data.errors.map(e => e.message).join(', ')
          throw new Error(`GraphQL errors: ${errorMessages}`)
        }
        
        return data.data
        
      } catch (error) {
        lastError = error as Error
        
        // Don't retry on certain errors
        if (error instanceof Error) {
          if (error.message.includes('401') || error.message.includes('403')) {
            throw error // Auth errors shouldn't be retried
          }
        }
        
        // Exponential backoff for other errors
        if (attempt < retryCount - 1) {
          console.log(`Request failed, retrying in ${backoffMs}ms...`, error)
          await this.sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
        }
      }
    }
    
    throw lastError || new Error('Request failed after retries')
  }
  
  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitInfo(headers: Headers): void {
    const limit = headers.get('x-rate-limit-limit')
    const remaining = headers.get('x-rate-limit-remaining')
    const reset = headers.get('x-rate-limit-reset')
    
    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        reset: parseInt(reset)
      }
    }
  }
  
  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  // ===========================================================================
  // Public API Methods
  // ===========================================================================
  
  /**
   * Get the "Following" timeline (chronological, from followed accounts)
   */
  async getHomeLatestTimeline(cursor?: string, count: number = 20): Promise<{
    tweets: XTweetResult[]
    topCursor?: string
    bottomCursor?: string
  }> {
    const variables = getHomeLatestTimelineVariables(cursor, count)
    const response = await this.request<TimelineResponse>(
      HomeLatestTimeline,
      variables
    )
    
    const tweets: XTweetResult[] = []
    let topCursor: string | undefined
    let bottomCursor: string | undefined
    
    const instructions = response.home.home_timeline_urt.instructions
    
    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
        for (const entry of instruction.entries) {
          // Extract tweets
          if (entry.content.itemContent?.tweet_results?.result) {
            const tweet = entry.content.itemContent.tweet_results.result
            if (tweet.__typename === 'Tweet' || tweet.__typename === 'TweetWithVisibilityResults') {
              tweets.push(tweet)
            }
          }
          
          // Extract cursors
          if (entry.content.cursorType === 'Top' && entry.content.value) {
            topCursor = entry.content.value
          }
          if (entry.content.cursorType === 'Bottom' && entry.content.value) {
            bottomCursor = entry.content.value
          }
        }
      }
    }
    
    return { tweets, topCursor, bottomCursor }
  }
  
  /**
   * Get list of accounts the user follows
   */
  async getFollowing(userId: string, cursor?: string, count: number = 20): Promise<{
    users: XUserResult[]
    cursor?: string
  }> {
    const variables = getFollowingVariables(userId, cursor, count)
    const response = await this.request<FollowingResponse>(
      Following,
      variables
    )
    
    const users: XUserResult[] = []
    let nextCursor: string | undefined
    
    const instructions = response.user.result.timeline.timeline.instructions
    
    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
        for (const entry of instruction.entries) {
          if (entry.content.itemContent?.user_results?.result) {
            users.push(entry.content.itemContent.user_results.result)
          }
          
          // Look for cursor in entry ID
          if (entry.entryId.startsWith('cursor-bottom-')) {
            // Extract cursor value (it's usually in the content)
            // This is a simplified approach
          }
        }
      }
    }
    
    return { users, cursor: nextCursor }
  }
  
  /**
   * Get tweets from a specific user
   */
  async getUserTweets(userId: string, cursor?: string, count: number = 20): Promise<{
    tweets: XTweetResult[]
    cursor?: string
  }> {
    const variables = getUserTweetsVariables(userId, cursor, count)
    
    // UserTweets returns a similar structure but nested differently
    const response = await this.request<any>(UserTweets, variables)
    
    const tweets: XTweetResult[] = []
    let nextCursor: string | undefined
    
    // Navigate the response structure
    const timeline = response?.user?.result?.timeline_v2?.timeline
    if (timeline?.instructions) {
      for (const instruction of timeline.instructions) {
        if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
          for (const entry of instruction.entries) {
            const tweetResult = entry.content?.itemContent?.tweet_results?.result
            if (tweetResult && (tweetResult.__typename === 'Tweet' || tweetResult.__typename === 'TweetWithVisibilityResults')) {
              tweets.push(tweetResult)
            }
            
            if (entry.content?.cursorType === 'Bottom' && entry.content?.value) {
              nextCursor = entry.content.value
            }
          }
        }
      }
    }
    
    return { tweets, cursor: nextCursor }
  }
  
  /**
   * Get current rate limit status
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo
  }
  
  /**
   * Check if we're currently rate limited
   */
  isRateLimited(): boolean {
    if (!this.rateLimitInfo) return false
    return this.rateLimitInfo.remaining === 0 && 
           this.rateLimitInfo.reset * 1000 > Date.now()
  }
}
