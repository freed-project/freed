import { describe, expect, it } from "vitest";
import { collectSavedYouTubeVideoUrls, parseYouTubeVideoUrl } from "./youtube";

const VIDEO_ID = "dQw4w9WgXcQ";
const EXPECTED_REFERENCE = {
  videoId: VIDEO_ID,
  canonicalWatchUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  privacyEnhancedEmbedUrl:
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?enablejsapi=1&playsinline=1&rel=0&autoplay=0`,
};

describe("parseYouTubeVideoUrl", () => {
  it.each([
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL123&autoplay=1`,
    `https://youtube.com/watch/?feature=share&v=${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://music.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}?si=tracking-token`,
    `https://www.youtube.com/shorts/${VIDEO_ID}?feature=share`,
    `https://www.youtube.com/live/${VIDEO_ID}?si=tracking-token`,
    `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1`,
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
  ])("canonicalizes %s", (url) => {
    expect(parseYouTubeVideoUrl(url)).toEqual(EXPECTED_REFERENCE);
  });

  it.each([
    "",
    "not a URL",
    VIDEO_ID,
    `ftp://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://example.com/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com.evil.test/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com/watch?v=${VIDEO_ID.slice(1)}`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}x`,
    "https://www.youtube.com/watch?v=invalid!id",
    `https://youtu.be/${VIDEO_ID}/unexpected`,
    `https://www.youtube.com/channel/${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}/unexpected`,
  ])("rejects unsupported or unsafe input %s", (url) => {
    expect(parseYouTubeVideoUrl(url)).toBeNull();
  });
});

describe("collectSavedYouTubeVideoUrls", () => {
  it("deduplicates canonical URLs and includes hidden saved items", () => {
    expect(collectSavedYouTubeVideoUrls([
      {
        userState: { saved: true, hidden: true },
        sourceUrl: `https://youtu.be/${VIDEO_ID}?si=tracking`,
        content: { linkPreview: { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` } },
      },
      {
        userState: { saved: true },
        sourceUrl: `https://www.youtube.com/shorts/${VIDEO_ID}`,
        content: { linkPreview: { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` } },
      },
      {
        userState: { saved: false },
        sourceUrl: "https://youtu.be/00000000000",
        content: {},
      },
    ])).toEqual([`https://www.youtube.com/watch?v=${VIDEO_ID}`]);
  });

  it("does not apply the hydrated feed item limit", () => {
    const items = Array.from({ length: 2_501 }, (_, index) => {
      const videoId = index.toString(36).padStart(11, "0");
      return {
        userState: { saved: true },
        sourceUrl: `https://youtu.be/${videoId}`,
        content: {},
      };
    });

    expect(collectSavedYouTubeVideoUrls(items)).toHaveLength(2_501);
  });
});
