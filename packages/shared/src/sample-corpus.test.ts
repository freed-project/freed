import { describe, expect, it } from "vitest";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CORPUS_PLACES,
  sampleCorpusMediaUrl,
  sampleCorpusUnsplashUrl,
} from "./sample-corpus.js";

describe("sample corpus", () => {
  it("keeps every curated image attributable and uniquely addressable", () => {
    expect(SAMPLE_CORPUS_MEDIA).toHaveLength(48);
    expect(new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.id)).size).toBe(48);
    expect(new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.unsplashId)).size).toBe(48);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.photographer.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.alt.trim().length > 0)).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => asset.fieldNote.trim().length > 0)).toBe(true);
  });

  it("renders through fixed Unsplash hosts and valid corpus places", () => {
    const placeIds = new Set(SAMPLE_CORPUS_PLACES.map((place) => place.id));

    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      new URL(sampleCorpusMediaUrl(asset)).hostname === "images.unsplash.com"
    )).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      new URL(sampleCorpusUnsplashUrl(asset)).hostname === "unsplash.com"
    )).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) => !asset.placeId || placeIds.has(asset.placeId))).toBe(true);
  });
});
