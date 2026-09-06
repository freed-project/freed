/**
 * Unit tests for @freed/capture-x normalize functions
 *
 * Asserts that tweetToFeedItem and extractLinkPreview never produce objects
 * containing `undefined` values, which violate the closed mutation contracts.
 */

import { describe, it, expect } from "vitest";
import { tweetToFeedItem, extractLinkPreview } from "@freed/capture-x/browser";
import type { XMediaEntity, XTweetResult, XVideoVariant } from "@freed/capture-x/browser";
import { sanitizeFeedItemCaptureWrite } from "@freed/shared";
import { FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";

// =============================================================================
// Fixtures
// =============================================================================

/** Minimal user stub — the only required fields for normalization */
function makeUser(overrides: Partial<{
  rest_id: string;
  screen_name: string;
  name: string;
  profile_image_url_https: string;
}> = {}) {
  return {
    __typename: "User" as const,
    id: "u1",
    rest_id: overrides.rest_id ?? "12345",
    is_blue_verified: false,
    legacy: {
      id_str: overrides.rest_id ?? "12345",
      name: overrides.name ?? "Test User",
      screen_name: overrides.screen_name ?? "testuser",
      followers_count: 100,
      friends_count: 50,
      statuses_count: 200,
      profile_image_url_https:
        overrides.profile_image_url_https ??
        "https://pbs.twimg.com/profile_images/1/photo_normal.jpg",
      created_at: "Mon Jan 01 00:00:00 +0000 2024",
    },
  };
}

/** Build a tweet fixture with optional field overrides */
function makeTweet(
  overrides: {
    rest_id?: string;
    full_text?: string;
    hasViews?: boolean;
    hasCard?: boolean;
    hasUrlEntities?: boolean;
    isRetweet?: boolean;
  } = {}
): XTweetResult {
  const user = makeUser();

  const urlEntities = overrides.hasUrlEntities
    ? [
        {
          url: "https://t.co/abc",
          expanded_url: "https://example.com/article",
          display_url: "example.com/article",
          indices: [80, 103] as [number, number],
        },
      ]
    : [];

  return {
    __typename: "Tweet",
    rest_id: overrides.rest_id ?? "9876543210",
    core: { user_results: { result: user } },
    legacy: {
      id_str: overrides.rest_id ?? "9876543210",
      full_text: overrides.full_text ?? "Hello world",
      created_at: "Wed Mar 05 00:00:00 +0000 2025",
      favorite_count: 42,
      retweet_count: 7,
      reply_count: 3,
      quote_count: 1,
      conversation_id_str: "9876543210",
      is_quote_status: false,
      lang: "en",
      entities: {
        urls: urlEntities,
        hashtags: [],
        user_mentions: [],
      },
    },
    // Conditionally include views
    ...(overrides.hasViews
      ? { views: { count: "1234", state: "EnabledWithCount" } }
      : {}),
    // Conditionally include a card (link preview)
    ...(overrides.hasCard
      ? {
          card: {
            rest_id: "https://t.co/abc",
            legacy: {
              binding_values: [
                { key: "title", value: { string_value: "Example Title" } },
                { key: "description", value: { string_value: "Example desc" } },
                { key: "url", value: { string_value: "https://example.com" } },
              ],
              card_platform: {
                platform: { device: { name: "Swift", version: "12" } },
              },
              name: "summary",
              url: "https://t.co/abc",
            },
          },
        }
      : {}),
  };
}

// =============================================================================
// Utilities
// =============================================================================

/** Deep-collect every value reachable from an object */
function collectValues(obj: unknown): unknown[] {
  if (obj === null || typeof obj !== "object") return [obj];
  const values: unknown[] = [];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    values.push(...collectValues(v));
  }
  return values;
}

function hasNoUndefined(obj: unknown): boolean {
  return !collectValues(obj).includes(undefined);
}

// =============================================================================
// Tests
// =============================================================================

describe("tweetToFeedItem", () => {
  it.each([{ hasCard: true }, { hasUrlEntities: true }])(
    "keeps link previews out of the paired media arrays: %j",
    (options) => {
      const item = tweetToFeedItem(makeTweet(options));
      expect(item.content.linkPreview?.url).toBeTruthy();
      expect(item.content.mediaUrls).toEqual([]);
      expect(item.content.mediaTypes).toEqual([]);
      expect(FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({
        item: sanitizeFeedItemCaptureWrite(item),
      })).toMatchObject({ ok: true });
    },
  );

  it.each<{ variants: XVideoVariant[] }>([
    { variants: [] },
    { variants: [{ content_type: "application/x-mpegURL", url: "https://cdn.example/video.m3u8" }] },
    { variants: [{ content_type: "video/mp4", url: "https://cdn.example/no-bitrate.mp4" }] },
  ])("omits a video type when existing URL selection finds no playable variant: $variants", ({ variants }) => {
    const tweet = makeTweet();
    tweet.legacy.extended_entities = { media: [makeMedia("video", variants)] };
    const item = tweetToFeedItem(tweet);
    expect(item.content.mediaUrls).toEqual([]);
    expect(item.content.mediaTypes).toEqual([]);
    expect(FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({
      item: sanitizeFeedItemCaptureWrite(item),
    })).toMatchObject({ ok: true });
  });

  it("preserves URL order and highest-bitrate selection across missing media and links", () => {
    const tweet = makeTweet({ hasCard: true });
    tweet.legacy.extended_entities = { media: [
      makeMedia("photo"),
      makeMedia("animated_gif"),
      makeMedia("video", [
        { bitrate: 100, content_type: "video/mp4", url: "https://cdn.example/low.mp4" },
        { bitrate: 200, content_type: "video/mp4", url: "https://cdn.example/high.mp4" },
      ]),
    ] };
    const item = tweetToFeedItem(tweet);
    expect(item.content.mediaUrls).toEqual(["https://cdn.example/photo.jpg:large", "https://cdn.example/high.mp4"]);
    expect(item.content.mediaTypes).toEqual(["image", "video"]);
    expect(item.content.linkPreview?.url).toBe("https://example.com");
    expect(FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate({
      item: sanitizeFeedItemCaptureWrite(item),
    })).toMatchObject({ ok: true });
  });

  it("produces no undefined values for a plain tweet without views or card", () => {
    const item = tweetToFeedItem(makeTweet());
    expect(hasNoUndefined(item)).toBe(true);
  });

  it("produces no undefined values for a tweet with views", () => {
    const item = tweetToFeedItem(makeTweet({ hasViews: true }));
    expect(hasNoUndefined(item)).toBe(true);
    expect(item.engagement?.views).toBe(1234);
  });

  it("produces no undefined values for a tweet with a card (link preview)", () => {
    const item = tweetToFeedItem(makeTweet({ hasCard: true }));
    expect(hasNoUndefined(item)).toBe(true);
    expect(item.content.linkPreview?.title).toBe("Example Title");
  });

  it("produces no undefined values for a tweet with URL entities but no card", () => {
    const item = tweetToFeedItem(makeTweet({ hasUrlEntities: true }));
    expect(hasNoUndefined(item)).toBe(true);
    // URL-entity fallback: only url is set, title/description are absent (not undefined)
    if (item.content.linkPreview) {
      expect("title" in item.content.linkPreview).toBe(false);
      expect("description" in item.content.linkPreview).toBe(false);
    }
  });

  it("sets the correct globalId and platform", () => {
    const item = tweetToFeedItem(makeTweet({ rest_id: "111222333" }));
    expect(item.globalId).toBe("x:111222333");
    expect(item.platform).toBe("x");
  });

  it("includes engagement counts from the tweet legacy fields", () => {
    const item = tweetToFeedItem(makeTweet());
    expect(item.engagement?.likes).toBe(42);
    expect(item.engagement?.reposts).toBe(7);
    expect(item.engagement?.comments).toBe(3);
  });

  it("omits engagement.views when the tweet has no views data", () => {
    const item = tweetToFeedItem(makeTweet({ hasViews: false }));
    expect(item.engagement).toBeDefined();
    // views should be absent, not set to undefined
    expect("views" in (item.engagement ?? {})).toBe(false);
  });

  it("resolves a bigger avatar URL from profile_image_url_https", () => {
    const item = tweetToFeedItem(makeTweet());
    expect(item.author.avatarUrl).toContain("_bigger");
  });
});

function makeMedia(type: XMediaEntity["type"], variants: XVideoVariant[] = []): XMediaEntity {
  const size = { w: 640, h: 480, resize: "fit" as const };
  return {
    id_str: "media-1", type, media_url_https: "https://cdn.example/photo.jpg",
    url: "https://t.co/media", expanded_url: "https://x.com/testuser/status/9876543210/photo/1",
    sizes: { thumb: size, small: size, medium: size, large: size },
    video_info: { duration_millis: 1_000, variants },
  };
}

describe("extractLinkPreview", () => {
  it("returns undefined when there are no URLs and no card", () => {
    const tweet = makeTweet();
    const preview = extractLinkPreview(tweet);
    expect(preview).toBeUndefined();
  });

  it("returns a preview with no undefined values when a card is present", () => {
    const tweet = makeTweet({ hasCard: true });
    const preview = extractLinkPreview(tweet);
    expect(preview).toBeDefined();
    expect(hasNoUndefined(preview)).toBe(true);
  });

  it("returns only { url } when falling back to URL entities (no title/desc)", () => {
    const tweet = makeTweet({ hasUrlEntities: true });
    const preview = extractLinkPreview(tweet);
    expect(preview).toBeDefined();
    expect(preview?.url).toBe("https://example.com/article");
    // title and description must be absent, never undefined
    expect("title" in (preview ?? {})).toBe(false);
    expect("description" in (preview ?? {})).toBe(false);
  });
});
