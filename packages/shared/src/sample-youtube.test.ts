import { describe, expect, it } from "vitest";
import { SAMPLE_CHARACTER_ARCS } from "./sample-character-arcs.js";
import { projectSampleYouTubeVideo, type SampleYouTubeVideo } from "./sample-youtube";

// Synthetic metadata only. Tests never fetch or claim these fixtures are real footage.
const fixture: SampleYouTubeVideo = {
  videoId: "TESTvideo01",
  title: "Synthetic footage title",
  uploader: "Synthetic uploader",
  channelUrl: "https://www.youtube.com/@synthetic-fixture",
  watchUrl: "https://www.youtube.com/watch?v=TESTvideo01&autoplay=1",
  primarySourceUrl: "https://example.org/footage-provenance",
  thumbnailUrl: "https://example.org/reviewed-thumbnail.jpg",
};

describe("demo YouTube provenance", () => {
  it("keeps all current and future YouTube posts in the character's first-person voice", () => {
    const episodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) =>
      arc.episodes.filter((episode) => (episode.platform ?? arc.platform) === "youtube"));
    expect(episodes.length).toBeGreaterThan(0);
    for (const episode of episodes) {
      expect(episode.title).toMatch(/\b(?:I|I'm|I've|I'll|I'd|me|my|mine|we|our|ours)\b/i);
      expect(episode.body).not.toMatch(/^(?:fictional|physical) character commentary:/i);
    }
  });

  it("keeps canonical playback identity and real creator attribution separate from fiction", () => {
    const commentary = "I waited beside the rock.\n\nThen I swam home.";
    const result = projectSampleYouTubeVideo(fixture, fixture.thumbnailUrl, commentary);
    expect(result.sourceUrl).toBe("https://www.youtube.com/watch?v=TESTvideo01");
    expect(result.text).toBe(`${commentary}\n\nOriginal video: ${fixture.title}\nUploaded by ${fixture.uploader}: ${fixture.channelUrl}\nSource: ${fixture.primarySourceUrl}`);
    expect(result.text).not.toContain("Fictional character commentary:");
    expect(result.attribution).toContain(fixture.title);
    expect(result.attribution).toContain(fixture.uploader);
    expect(result.attribution).toContain(fixture.channelUrl);
    expect(result.attribution).toContain(fixture.primarySourceUrl);
  });

  it("rejects missing evidence, mismatched IDs, unsafe URLs, and unrelated thumbnails", () => {
    expect(() => projectSampleYouTubeVideo(undefined, fixture.thumbnailUrl, "commentary"))
      .toThrow("Verified demo video source required");
    for (const patch of [
      { videoId: "too-short" },
      { videoId: "OTHERvideo1" },
      { watchUrl: "https://example.org/watch?v=TESTvideo01" },
      { watchUrl: "https://user:password@www.youtube.com/watch?v=TESTvideo01" },
      { channelUrl: "https://youtube.com.evil.example/@uploader" },
      { channelUrl: "https://www.youtube.com/watch?v=TESTvideo01" },
      { primarySourceUrl: "javascript:alert(1)" },
      { primarySourceUrl: "http://example.org/source" },
      { thumbnailUrl: "https://example.org/unreviewed.jpg" },
      { uploader: " " },
      { title: "" },
    ]) {
      expect(() => projectSampleYouTubeVideo({ ...fixture, ...patch }, fixture.thumbnailUrl, "commentary"))
        .toThrow();
    }
  });
});
