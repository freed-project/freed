import { describe, expect, it } from "vitest";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CORPUS_PLACES,
  sampleCorpusMediaUrl,
  sampleCorpusSourceUrl,
} from "./sample-corpus.js";

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
});
