import { describe, expect, it } from "vitest";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CURATED_DEMO_MEDIA,
  SAMPLE_CORPUS_PLACES,
  sampleCorpusAuthoredText,
  sampleCorpusAttribution,
  sampleCorpusDisplayTitle,
  sampleCorpusIdentityName,
  sampleCorpusMediaUrl,
  sampleCorpusSourceUrl,
} from "./sample-corpus.js";
import { SAMPLE_CHARACTER_ARCS } from "./sample-character-arcs.js";

const PLATFORMS = [
  "facebook", "instagram", "linkedin", "medium", "rss", "saved", "substack", "x", "youtube",
] as const;

const WIKIMEDIA_IMAGE_HOSTS = new Set(["thumb.wikimedia.org", "upload.wikimedia.org"]);

const EXPECTED_CURATED_MEDIA_SHA1S: readonly string[] = [
  // Manny Tis
  "d67cc98af34b60d6e8b2e7aa586aa9e05de4d3fd",
  // Frogbert Angler
  "3c0d019158c7d78248e12b1151b0a462cea627b3",
  "4fac2f792ffba0fc2240e5e6cb792decd3596f65",
  "215028f2956ac61b9567ca0ac7d45450cf451bae",
  "708922c5bacfa31a2ed33f2b068c1837fe027b8b",
  // Nudi Branch Manager
  "78cee6949fb8cd5308c53c9725de02cea1c64a62",
  "3dbe7e0c03e5de95816b0cec07171d1915c27199",
  "129c619a92dfef320bf5e9fb98b05742b3e36a7b",
  "34f2a4da704222a48592ad20bb8d1c645a105c70",
  "d47c50dd9dc91166939340307b3560a3ea9d032e",
  "628d8aba303ab7799dd78292023cdddb8194baf7",
  // Cygnus Shy
  "a28cb915c46d2dcb4966227b7b34b475cc5cdfdc",
  "cd185b8e433a0179c4ffea8bd75db0ecd252c90c",
  "ce1ef641230b414aeb30ce82ce63b418334d53a9",
  "a2a57edb7708d629231c15bc1ff5fa6af728f513",
  // Flora Mingo
  "d7db5d3f032ac43eb40c19d527e79ea12e4a6ac8",
  // Nova Remains
  "c447255ad8fe6aab3c24c59dde232234cce6c490",
  "3cea93a1a3bf7a2e60405c6fce570ecfac26842f",
  // Alma Eight
  // Mora Grey
  "591383436276e3a2ce2539a8d71b2ed7bab14c6d",
  "07937bdc8f0afca1203c479dab4e63e15d21922f",
  "f153543d44150bd03fb04a49c9419ad6d02737c2",
  // Colm Still
  "e79a752849690cedabe3da27bb875d7e8072fe36",
  "4bfa89fc6b9b8721976b3cfdb59ce7b0b9493d06",
] as const;

const KNOWN_BAD_CURATED_MEDIA_SHA1S = new Set([
  "629fce61875f78854f5d5a8cce20fba9dde3e5a0", // Praying Mantis, the band
  "dd5b4199dba6fe907e94f62c2082383147b7b76b", // Great crested grebes
  "986ae86f7c47c276edee7706f7a7a0969fb11243", // Great crested grebe
  "c9ad414d6777c03b83f59d5ff54af968ea2d5583", // Book spread with a staged pigeon
]);

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
  it("credits each image's actual source rather than inventing a Commons intermediary", () => {
    for (const hostname of ["commons.wikimedia.org", "oceanexplorer.noaa.gov"]) {
      const asset = SAMPLE_CURATED_DEMO_MEDIA.find((candidate) => new URL(candidate.sourceUrl).hostname === hostname)!;
      expect(asset, hostname).toBeDefined();
      expect(sampleCorpusAttribution(asset)).toBe(`Photograph by ${asset.creator}, ${asset.license}.\nSource: ${asset.sourceUrl}${asset.licenseUrl ? `\nLicense: ${asset.licenseUrl}` : ""}`);
    }
  });
  it("tracks the 896-entry source corpus across 134 located characters", () => {
    const episodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes);
    const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    expect(episodes).toHaveLength(896);
    expect(new Set(episodes.map((episode) => normalize(episode.title))).size).toBe(896);
    expect(new Set(episodes.map((episode) => normalize(episode.body))).size).toBe(896);
    expect(SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes.filter((episode) => (episode.platform ?? arc.platform) === "rss"))).toHaveLength(196);
    for (const arc of SAMPLE_CHARACTER_ARCS) {
      if (arc.characterId === "nova-remains") continue; // A supernova has no Earth coordinate.
      expect(arc.location, arc.characterId).toBeDefined();
      expect(Math.abs(arc.location!.coordinates.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(arc.location!.coordinates.lng)).toBeLessThanOrEqual(180);
    }
  });
  it("keeps every curated image attributable and uniquely addressable", () => {
    expect(SAMPLE_CORPUS_MEDIA).toHaveLength(2_177);
    expect(SAMPLE_CURATED_DEMO_MEDIA).toHaveLength(500);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.id)).size).toBe(500);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.sha1)).size).toBe(500);
    expect(new Set(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.imageUrl)).size).toBe(500);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.creator.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.license.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.alt.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => asset.fieldNote.trim().length > 0)).toBe(true);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) => /\b(?:I|my|me|we|our|us)\b/i.test(asset.fieldNote))).toBe(true);
    const sentences = SAMPLE_CURATED_DEMO_MEDIA.flatMap((asset) =>
      asset.fieldNote.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
    );
    // Ordinary short speech can recur. Catch copied passages, not words like "Empty."
    const passages = sentences.filter((sentence) => sentence.split(/\s+/).length >= 8);
    expect(new Set(passages).size).toBe(passages.length);
    expect(SAMPLE_CURATED_DEMO_MEDIA.filter((asset) =>
      /^(?:field note|my testimony|result|observed|for the record|at this location):/i.test(asset.fieldNote)
    )).toEqual([]);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset) =>
      SAMPLE_CHARACTER_ARCS.some((arc) => arc.identityNameBase === asset.identityNameBase)
    )).toBe(true);
  });

  it("preserves exact bindings while tracking legacy text-only entries awaiting replacement", () => {
    const allEpisodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes);
    const episodes = allEpisodes.filter((episode) => episode.mediaSha1 !== null);
    const authoredSha1s = episodes.map((episode) => episode.mediaSha1!);
    const curatedSha1s = SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.sha1);

    expect(allEpisodes).toHaveLength(896);
    expect(allEpisodes.filter((episode) => episode.mediaSha1 === null)).toHaveLength(396);
    expect(authoredSha1s.filter((sha1) => EXPECTED_CURATED_MEDIA_SHA1S.includes(sha1))).toEqual(EXPECTED_CURATED_MEDIA_SHA1S);
    expect(curatedSha1s).toEqual(authoredSha1s);
    expect(new Set(authoredSha1s).size).toBe(authoredSha1s.length);
    expect(authoredSha1s.every((sha1) => /^[0-9a-f]{40}$/.test(sha1))).toBe(true);
    expect(episodes.every((episode, index) =>
      episode.subject === SAMPLE_CURATED_DEMO_MEDIA[index]!.subject
    )).toBe(true);
    expect(curatedSha1s.filter((sha1) => KNOWN_BAD_CURATED_MEDIA_SHA1S.has(sha1))).toEqual([]);
  });

  it("assigns one human editorial classification to every accepted post", () => {
    const accepted = SAMPLE_CHARACTER_ARCS.flatMap((arc) =>
      arc.episodes.filter((episode) => episode.mediaSha1 !== null)
    );
    const counts = accepted.reduce<Record<string, number>>((result, episode) => {
      const classification = episode.classification ?? "missing";
      result[classification] = (result[classification] ?? 0) + 1;
      return result;
    }, {});

    expect(accepted.every((episode) => episode.classification !== undefined)).toBe(true);
    expect(counts).toEqual({
      inspiring: 115,
      conversation: 155,
      personal: 106,
      event: 72,
      news: 52,
    });
  });

  it("keeps courtship as one strand of a much larger life", () => {
    const episodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes);
    const intimateThemes = new Set(["courtship", "family"]);

    expect(episodes).toHaveLength(896);
    // The 1,000-entry brief supersedes the old per-character two-entry cap.
    // Relationships may develop within an arc without dominating the whole feed.
    expect(episodes.filter((episode) => intimateThemes.has(episode.theme)).length).toBeLessThan(episodes.length / 2);

    const flora = SAMPLE_CHARACTER_ARCS.find((arc) => arc.characterId === "flora-mingo");
    expect(flora?.episodes).toHaveLength(5);
    expect(flora?.episodes.filter((episode) => intimateThemes.has(episode.theme))).toHaveLength(1);
  });

  it("rejects known performative copy and human subject false positives", () => {
    const authoredCopy = SAMPLE_CHARACTER_ARCS.flatMap((arc) =>
      arc.episodes.flatMap((episode) => [episode.title, episode.body])
    ).join("\n");
    const rainAsset = SAMPLE_CURATED_DEMO_MEDIA.find((asset, index) =>
      sampleCorpusDisplayTitle(asset, "instagram", index) === "Rain has hands"
    );

    expect(authoredCopy).not.toMatch(/three a\.m\. doctrine|ceremonial robes|review of commitment|philosophy I had not requested/i);
    expect(SAMPLE_CORPUS_MEDIA.some((asset) => asset.detail === "PrayingMantisSRF2010")).toBe(false);
    expect(rainAsset).toBeUndefined();
    expect(SAMPLE_CHARACTER_ARCS.find((arc) => arc.characterId === "manny-tis")?.episodes.find((episode) => episode.title === "Rain has hands")?.mediaSha1).toBeNull();
  });

  it("renders through reviewed source hosts and preserves valid corpus places", () => {
    const placeIds = new Set(SAMPLE_CORPUS_PLACES.map((place) => place.id));

    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      [...WIKIMEDIA_IMAGE_HOSTS, "live.staticflickr.com", "inaturalist-open-data.s3.amazonaws.com", "assets.science.nasa.gov", "i.ytimg.com", "oceanexplorer.noaa.gov", "archive.oceanexplorer.noaa.gov", "chandra.harvard.edu", "www.fisheries.noaa.gov", "npgallery.nps.gov", "www.nps.gov", "www.fws.gov", "media.fisheries.noaa.gov", "d9-wret.s3.us-west-2.amazonaws.com"].includes(new URL(sampleCorpusMediaUrl(asset)).hostname)
    )).toBe(true);
    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      ["commons.wikimedia.org", "www.flickr.com", "www.inaturalist.org", "science.nasa.gov", "oceanexplorer.noaa.gov", "archive.oceanexplorer.noaa.gov", "chandra.harvard.edu", "www.fisheries.noaa.gov", "npgallery.nps.gov", "www.nps.gov", "www.fws.gov", "media.fisheries.noaa.gov", "www.usgs.gov"].includes(new URL(sampleCorpusSourceUrl(asset)).hostname)
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
    expect(SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes.map((episode) => episode.title)))
      .toContain("Violence, and better lighting.");
    expect(titles.filter((title) => /against modesty/i.test(title))).toEqual([]);
    const curatedTitles = SAMPLE_CURATED_DEMO_MEDIA.map((asset, index) =>
      sampleCorpusDisplayTitle(asset, "instagram", index)
    );
    expect(new Set(curatedTitles).size).toBe(curatedTitles.length);
    expect(SAMPLE_CURATED_DEMO_MEDIA.every((asset, index) =>
      // A title may quote the narrative, but must not be prepended as a label.
      curatedTitles[index] === "grey." || !asset.fieldNote.startsWith(`${curatedTitles[index]}\n`)
    )).toBe(true);
  });

  it("uses recurring character names without fabricated location credentials", () => {
    const names = SAMPLE_CURATED_DEMO_MEDIA.map((asset, index) => sampleCorpusIdentityName(asset, index));

    expect(names.every((name, index) => name === SAMPLE_CURATED_DEMO_MEDIA[index]!.identityNameBase)).toBe(true);
    expect(names.every((name) => !containsEditorialLocation(name))).toBe(true);
    expect(SAMPLE_CHARACTER_ARCS).toHaveLength(134);
    expect(new Set(SAMPLE_CHARACTER_ARCS.map((arc) => arc.identityNameBase)).size).toBe(134);
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

    expect(frogfish).toHaveLength(9);
    expect(new Set(openings).size).toBe(frogfish.length);
  });
});
