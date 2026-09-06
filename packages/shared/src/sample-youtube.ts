import { parseYouTubeVideoUrl } from "./youtube.js";

/** Editorial evidence, not an automatic claim of licensing or playback availability. */
export interface SampleYouTubeVideo {
  videoId: string;
  title: string;
  uploader: string;
  channelUrl: string;
  watchUrl: string;
  primarySourceUrl: string;
  thumbnailUrl: string;
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Demo video provenance requires credential-free HTTPS URLs.");
  }
  return url;
}

/**
 * Validate the authored record without requests. Editors must independently check
 * the actual footage, uploader, reuse conditions, and matching catalog thumbnail.
 */
export function projectSampleYouTubeVideo(
  video: SampleYouTubeVideo | undefined,
  reviewedThumbnailUrl: string,
  fictionalCommentary: string,
) {
  if (!video) throw new Error("Verified demo video source required");
  const watchUrl = httpsUrl(video.watchUrl);
  const reference = parseYouTubeVideoUrl(watchUrl.href);
  if (!reference || reference.videoId !== video.videoId || !/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) {
    throw new Error("Demo video identity does not match its YouTube source.");
  }
  const channel = httpsUrl(video.channelUrl);
  if (!["youtube.com", "www.youtube.com"].includes(channel.hostname) ||
      !/^\/(?:@[A-Za-z0-9_.-]+|channel\/UC[A-Za-z0-9_-]{22})\/?$/.test(channel.pathname) ||
      channel.search || channel.hash) {
    throw new Error("Demo video requires its actual YouTube channel URL.");
  }
  httpsUrl(video.primarySourceUrl);
  httpsUrl(video.thumbnailUrl);
  if (video.thumbnailUrl !== reviewedThumbnailUrl) {
    throw new Error("Demo video thumbnail does not match its reviewed catalog media.");
  }
  if (![video.title, video.uploader, fictionalCommentary].every((value) => value.trim().length > 0)) {
    throw new Error("Demo video requires title, uploader, and fictional commentary.");
  }
  const attribution = `Original video: ${video.title}\nUploaded by ${video.uploader}: ${channel.href}\nSource: ${video.primarySourceUrl}`;
  return {
    sourceUrl: reference.canonicalWatchUrl,
    thumbnailUrl: video.thumbnailUrl,
    attribution,
    text: `${fictionalCommentary.trim()}\n\n${attribution}`,
  };
}
