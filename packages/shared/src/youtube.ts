const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

const YOUTUBE_EMBED_HOSTS = new Set([
  ...YOUTUBE_HOSTS,
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export interface YouTubeVideoReference {
  videoId: string;
  canonicalWatchUrl: string;
  privacyEnhancedEmbedUrl: string;
}

export interface SavedYouTubeItemCandidate {
  userState: { saved: boolean; hidden?: boolean };
  sourceUrl?: string;
  content: { linkPreview?: { url: string } };
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function videoIdFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = pathSegments(url);

  if (host === "youtu.be") {
    return segments.length === 1 ? segments[0] : null;
  }

  if (!YOUTUBE_EMBED_HOSTS.has(host)) return null;

  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  if (YOUTUBE_HOSTS.has(host) && normalizedPath === "/watch") {
    return url.searchParams.get("v");
  }

  if (
    segments.length === 2 &&
    (segments[0] === "shorts" || segments[0] === "live" || segments[0] === "embed")
  ) {
    return segments[1];
  }

  return null;
}

/**
 * Resolve a supported YouTube URL to one strict video identity and safe URLs.
 * Tracking, playlist, autoplay, and short-form path parameters are discarded.
 */
export function parseYouTubeVideoUrl(value: string | null | undefined): YouTubeVideoReference | null {
  const input = value?.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const videoId = videoIdFromUrl(url);
  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) return null;

  const canonicalWatchUrl = new URL("https://www.youtube.com/watch");
  canonicalWatchUrl.searchParams.set("v", videoId);

  const privacyEnhancedEmbedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  privacyEnhancedEmbedUrl.searchParams.set("enablejsapi", "1");
  privacyEnhancedEmbedUrl.searchParams.set("playsinline", "1");
  privacyEnhancedEmbedUrl.searchParams.set("rel", "0");
  privacyEnhancedEmbedUrl.searchParams.set("autoplay", "0");

  return {
    videoId,
    canonicalWatchUrl: canonicalWatchUrl.toString(),
    privacyEnhancedEmbedUrl: privacyEnhancedEmbedUrl.toString(),
  };
}

/** Collect every distinct saved YouTube video without applying feed visibility limits. */
export function collectSavedYouTubeVideoUrls(
  items: readonly SavedYouTubeItemCandidate[],
): string[] {
  const urls = new Map<string, string>();
  for (const item of items) {
    if (!item.userState.saved) continue;
    const reference = [item.sourceUrl, item.content.linkPreview?.url]
      .map((url) => parseYouTubeVideoUrl(url))
      .find((candidate) => candidate !== null);
    if (reference) urls.set(reference.videoId, reference.canonicalWatchUrl);
  }
  return Array.from(urls.values());
}
