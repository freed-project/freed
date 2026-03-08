/**
 * Platform Actions Registry
 *
 * Maps each Platform to a set of async write-back actions (like, unlike,
 * markSeen, commentUrl). The outbox processor calls these — never the store
 * directly.
 *
 * Each action returns a boolean:
 *   true  = platform confirmed the action
 *   false = soft failure (retry on next drain cycle)
 * Throws = hard error (logged, item eventually marked failed after 3 retries)
 */

import { invoke } from "@tauri-apps/api/core";
import type { FeedItem, Platform } from "@freed/shared";
import { favoriteTweet, unfavoriteTweet } from "./x-capture";
import type { XCookies } from "./x-auth";

// =============================================================================
// Interface
// =============================================================================

export interface PlatformActions {
  /**
   * Like this item on its source platform.
   * Returns true on success, false on soft failure.
   */
  like(item: FeedItem): Promise<boolean>;

  /**
   * Unlike this item on its source platform.
   * Returns true on success, false on soft failure.
   */
  unlike(item: FeedItem): Promise<boolean>;

  /**
   * Mark this item as seen/visited on its source platform.
   * Returns true on success, false on soft failure.
   */
  markSeen(item: FeedItem): Promise<boolean>;

  /**
   * Returns a URL to open for commenting on this item, or null if unsupported.
   */
  commentUrl(item: FeedItem): string | null;
}

// =============================================================================
// X Actions
// =============================================================================

function makXActions(getXCookies: () => XCookies | null): PlatformActions {
  return {
    async like(item) {
      const cookies = getXCookies();
      if (!cookies) return false;
      // globalId = "x:<tweetId>"
      const tweetId = item.globalId.replace(/^x:/, "");
      return favoriteTweet(tweetId, cookies);
    },
    async unlike(item) {
      const cookies = getXCookies();
      if (!cookies) return false;
      const tweetId = item.globalId.replace(/^x:/, "");
      return unfavoriteTweet(tweetId, cookies);
    },
    async markSeen(_item) {
      // X doesn't have a meaningful "mark seen" API — skip.
      return true;
    },
    commentUrl(item) {
      return item.sourceUrl ?? null;
    },
  };
}

// =============================================================================
// Facebook Actions
// =============================================================================

const fbActions: PlatformActions = {
  async like(item) {
    if (!item.sourceUrl) return false;
    try {
      const result = await invoke<boolean>("fb_like_post", { url: item.sourceUrl });
      return result;
    } catch {
      return false;
    }
  },
  async unlike(_item) {
    // Unlike via WebView DOM click is complex and fragile — skip for now.
    // The outbox only calls unlike when liked=false, which means the user
    // un-liked locally; we log true so the item leaves the outbox.
    return true;
  },
  async markSeen(item) {
    if (!item.sourceUrl) return true;
    try {
      await invoke("fb_visit_url", { url: item.sourceUrl });
      return true;
    } catch {
      return false;
    }
  },
  commentUrl(item) {
    return item.sourceUrl ?? null;
  },
};

// =============================================================================
// Instagram Actions
// =============================================================================

const igActions: PlatformActions = {
  async like(item) {
    if (!item.sourceUrl) return false;
    try {
      const result = await invoke<boolean>("ig_like_post", { url: item.sourceUrl });
      return result;
    } catch {
      return false;
    }
  },
  async unlike(_item) {
    return true;
  },
  async markSeen(item) {
    if (!item.sourceUrl) return true;
    try {
      await invoke("ig_visit_url", { url: item.sourceUrl });
      return true;
    } catch {
      return false;
    }
  },
  commentUrl(item) {
    return item.sourceUrl ?? null;
  },
};

// =============================================================================
// RSS / Saved / Other (no-op like/seen, article URL for comment)
// =============================================================================

const noopActions: PlatformActions = {
  async like(_item) { return true; },
  async unlike(_item) { return true; },
  async markSeen(_item) { return true; },
  commentUrl(item) { return item.sourceUrl ?? item.content.linkPreview?.url ?? null; },
};

// =============================================================================
// Registry Factory
// =============================================================================

/**
 * Build the platform actions registry.
 * Call once during store init and pass the result to startOutboxProcessor.
 *
 * @param getXCookies - Getter that returns current X session cookies (or null if not authed).
 */
export function buildPlatformActionsRegistry(
  getXCookies: () => XCookies | null,
): Map<Platform, PlatformActions> {
  const registry = new Map<Platform, PlatformActions>();
  const xActions = makXActions(getXCookies);
  registry.set("x", xActions);
  registry.set("facebook", fbActions);
  registry.set("instagram", igActions);
  registry.set("rss", noopActions);
  registry.set("youtube", noopActions);
  registry.set("reddit", noopActions);
  registry.set("mastodon", noopActions);
  registry.set("github", noopActions);
  registry.set("saved", noopActions);
  registry.set("linkedin", noopActions);
  return registry;
}
