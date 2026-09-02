import { describe, expect, it } from "vitest";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CURATED_DEMO_MEDIA,
  SAMPLE_CORPUS_PLACES,
  sampleCorpusAuthoredText,
  sampleCorpusDisplayTitle,
  sampleCorpusIdentityName,
  sampleCorpusMediaUrl,
  sampleCorpusSourceUrl,
} from "./sample-corpus.js";
import { SAMPLE_CHARACTER_ARCS } from "./sample-character-arcs.js";

const PLATFORMS = [
  "facebook", "instagram", "linkedin", "medium", "rss", "saved", "substack", "x", "youtube",
] as const;

const EDITORIAL_LOCATIONS = [
  "Fern Chapel", "Moonlit Reef", "Basalt Choir", "Velvet Current", "Amber Meadow",
  "Quiet Crater", "Coral Garden", "Salt Horizon", "Moss Council", "Twilight Pool",
  "Silver Dune", "Starlit Ridge", "Hidden Kelp", "Crystal Hollow", "Orchid Thicket",
  "Deep Blue", "Glacier Gate", "Warm Tide", "Canyon Echo", "Wildflower Court",
  "Tidal Lantern", "Ancient Stone", "Meteor Meadow", "Rainforest Balcony", "Lunar Valley",
  "Emerald Grotto", "Comet Tail", "Golden Savanna", "Night Bloom", "Whale Road",
  "Mantis Grove", "Jelly Sea", "Geode Hall", "Nebula Field", "Dragonfly Bend",
  "Octopus Garden", "Volcano Rim", "Star Cluster", "Beetle Wood", "Aurora Vale",
] as const;

const containsEditorialLocation = (value: string): boolean =>
  EDITORIAL_LOCATIONS.some((location) => value.includes(location));

describe("sample corpus", () => {
  it("keeps every curated image attributable and uniquely addressable", () => {
    expect(SAMPLE_CORPUS_MEDIA).toHaveLength(1_750);
    expect(SAMPLE_CURATED_DEMO_MEDIA).toHaveLength(45);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.id)).size).toBe(45);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.sha1)).size).toBe(45);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.imageUrl)).size).toBe(45);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.creator.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.license.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.alt.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.fieldNote.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => /\b(?:I|my|me|we|our|us)\b/i.test(asset.fieldNote))).toBe(true);
    const sentences = SAMPLE_CURATED_DEMO_MEDIA.flatMap((asset) =>
      asset.fieldNote.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
    );
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(SAMPLE_CURATED_DEMO_MEDIA.filter((asset) =>
      /^(?:field note|my testimony|result|observed|for the record|at this location):/i.test(asset.fieldNote)
    )).toEqual([]);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) =>
      SAMPLE_CHARACTER_ARCS.some((arc) => arc.identityNameBase === asset.identityNameBase)
    )).toBe(true);
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

  it("keeps titles short and free of account names and invented locations", () => {
    const titles = SAMPLE_CORPUS_MEDIA.map((asset, index) => {
      const platform = PLATFORMS[index % PLATFORMS.length]!;
      return sampleCorpusDisplayTitle(asset, platform, index);
    });

    expect(titles.every((title) => title.trim().split(/\s+/).length <= 9)).toBe(true);
    expect(titles.every((title, index) => !title.includes(SAMPLE_CORPUS_MEDIA[index]!.identityNameBase))).toBe(true);
    expect(titles.every((title) => !containsEditorialLocation(title))).toBe(true);
    expect(titles).toContain("Violence, and better lighting.");
    expect(titles.filter((title) => /against modesty/i.test(title))).toEqual([]);
    const curatedTitles = SAMPLE_CURATED_DEMO_MEDIA.map((asset, index) =>
      sampleCorpusDisplayTitle(asset, "instagram", index)
    );
    expect(new Set(curatedTitles).size).toBe(curatedTitles.length);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset, index) =>
      !asset.fieldNote.includes(curatedTitles[index]!)
    )).toBe(true);
  });

  it("uses recurring character names without fabricated location credentials", () => {
    const names = SAMPLE_CURATED_DEMO_MEDIA.map((asset, index) => sampleCorpusIdentityName(asset, index));

    expect(names.every((name, index) => name === SAMPLE_CURATED_DEMO_MEDIA[index]!.identityNameBase)).toBe(true);
    expect(names.every((name) => !containsEditorialLocation(name))).toBe(true);
    expect(new Set(names).size).toBe(SAMPLE_CHARACTER_ARCS.length);
  });

  it("reserves invented locations for rare status jokes", () => {
    const bodies = SAMPLE_CORPUS_MEDIA.map((asset, index) =>
      sampleCorpusAuthoredText(asset, PLATFORMS[index % PLATFORMS.length]!, index)
    );
    const locationBodies = bodies.filter(containsEditorialLocation);

    expect(locationBodies.length).toBeLessThanOrEqual(Math.floor(bodies.length / 40));
    expect(locationBodies.every((body) =>
      /does not book ordinary talent|guest list at .* remains selective|has standards, and inconveniently, so do I/.test(body)
    )).toBe(true);
    expect(locationBodies.every((body) =>
      EDITORIAL_LOCATIONS.filter((location) => body.includes(location)).length === 1
    )).toBe(true);
  });

  it("keeps LinkedIn astronomy titles compact", () => {
    const titles = SAMPLE_CORPUS_MEDIA
      .filter((asset) => asset.category === "astronomy")
      .map((asset, index) => sampleCorpusDisplayTitle(asset, "linkedin", index));

    expect(Math.max(...titles.map((title) => title.length))).toBeLessThanOrEqual(58);
  });

  it("gives every frogfish Instagram post a distinct opening joke", () => {
    const frogfish = SAMPLE_CURATED_DEMO_MEDIA
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => asset.subject === "frogfish underwater");
    const openings = frogfish.map(({ asset, index }) =>
      sampleCorpusAuthoredText(asset, "instagram", index).split(";")[0]!.trim()
    );

    expect(frogfish).toHaveLength(8);
    expect(new Set(openings).size).toBe(frogfish.length);
  });
});
