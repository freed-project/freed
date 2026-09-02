import { describe, expect, it } from "vitest";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CORPUS_PLACES,
  sampleCorpusAuthoredText,
  sampleCorpusDisplayTitle,
  sampleCorpusMediaUrl,
  sampleCorpusSourceUrl,
} from "./sample-corpus.js";

const PLATFORMS = [
  "facebook", "instagram", "linkedin", "medium", "rss", "saved", "substack", "x", "youtube",
] as const;

describe("sample corpus", () => {
  it("keeps every curated image attributable and uniquely addressable", () => {
    expect(SAMPLE_CORPUS_MEDIA).toHaveLength(1_750);
    expect(new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.id)).size).toBe(1_750);
    expect(new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.sha1)).size).toBe(1_750);
    expect(new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.imageUrl)).size).toBe(1_750);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.creator.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.license.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.alt.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.fieldNote.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => /\b(?:I|my|me)\b/i.test(asset.fieldNote))).toBe(true);
    expect(Object.fromEntries(
      ["astronomy", "geology", "insect", "microfauna", "undersea"].map((category) => [
        category,
        SAMPLE_CORPUS_MEDIA.filter((asset) => asset.category === category).length,
      ]),
    )).toEqual({ astronomy: 430, geology: 450, insect: 390, microfauna: 40, undersea: 440 });
  });

  it("renders through Wikimedia Commons and preserves valid corpus places", () => {
    const placeIds = new Set(SAMPLE_CORPUS_PLACES.map((place) => place.id));

    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      new URL(sampleCorpusMediaUrl(asset)).hostname === "thumb.wikimedia.org"
    )).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      new URL(sampleCorpusSourceUrl(asset)).hostname === "commons.wikimedia.org"
    )).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => !asset.placeId || placeIds.has(asset.placeId))).toBe(true);
  });

  it("uses varied organic title forms instead of one corpus-wide template", () => {
    const usedTitles = new Set<string>();
    const titles = SAMPLE_CORPUS_MEDIA.map((asset, index) => {
      const platform = PLATFORMS[index % PLATFORMS.length]!;
      let variant = 0;
      let title = sampleCorpusDisplayTitle(asset, platform, index, variant);
      while (usedTitles.has(title)) {
        variant += 1;
        title = sampleCorpusDisplayTitle(asset, platform, index, variant);
      }
      usedTitles.add(title);
      return title;
    });
    const openingWords = new Set(titles.map((title) =>
      title.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).slice(0, 3).join(" ")
    ));

    expect(new Set(titles).size).toBe(titles.length);
    expect(openingWords.size).toBeGreaterThan(100);
    const instagramTitles = SAMPLE_CORPUS_MEDIA.slice(0, 12).map((asset, index) =>
      sampleCorpusDisplayTitle(asset, "instagram", index)
    );
    expect(instagramTitles.some((title) => /thirst trap|chose violence|main character/i.test(title))).toBe(true);
    expect(titles.filter((title) => /against modesty/i.test(title))).toEqual([]);
    expect(titles.filter((title) => title.includes(":")).length).toBeLessThan(titles.length / 2);
  });

  it("keeps LinkedIn astronomy titles compact", () => {
    const titles = SAMPLE_CORPUS_MEDIA
      .filter((asset) => asset.category === "astronomy")
      .map((asset, index) => sampleCorpusDisplayTitle(asset, "linkedin", index));

    expect(Math.max(...titles.map((title) => title.length))).toBeLessThanOrEqual(58);
  });

  it("gives every frogfish Instagram post a distinct opening joke", () => {
    const frogfish = SAMPLE_CORPUS_MEDIA
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => asset.subject === "frogfish underwater");
    const openings = frogfish.map(({ asset, index }) =>
      sampleCorpusAuthoredText(asset, "instagram", index).split(";")[0]!.trim()
    );

    expect(frogfish).toHaveLength(30);
    expect(new Set(openings).size).toBe(frogfish.length);
  });
});
