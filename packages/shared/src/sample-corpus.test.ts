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

const WIKIMEDIA_IMAGE_HOSTS = new Set(["thumb.wikimedia.org", "upload.wikimedia.org"]);

const EXPECTED_CURATED_MEDIA_SHA1S = [
  // Manny Tis
  "c88ce5d5c8cd990996d841db9af09646ae2d47c7",
  "d419335f51a0e926dbd6a7a49d0e5449b6790d0a",
  "e5f6a877347285e1ca1e38f040566752f1b90305",
  "5e6da761a344b8f0a359091ac1b995a6d5c4056e",
  "4bd31bee0500c333e4367a0bbacb3b24efce198c",
  "2cb2762eb9cb6f68bcbe16287fb038170521aaed",
  "31e1e5639ab0477d2a2466941d5883f6dfe1a57f",
  "7e07c6b30b74a08ea83cbbb05e68d54da3adfe10",
  "d67cc98af34b60d6e8b2e7aa586aa9e05de4d3fd",
  // Frogbert Angler
  "ab98dabf54fe33be92581795707d73fd56b68176",
  "d8db811f9a3957e75569f46ac91be3a8456373b0",
  "28f071a8ba9eb3e27a92f099918b66dabe6f8662",
  "01e2e869995438145c0354c19e554df0a82dffd3",
  "4fac2f792ffba0fc2240e5e6cb792decd3596f65",
  "e710824197892596f5f929fb93529038436cc68d",
  "17fe76cd81e2688f0ba67e0de0b378e32bdd8d1c",
  "791547f8fd744ca2c6c6406b352b1c12282d63f0",
  "9663a30640ec7d977a6ce02a9a1b87b875f85365",
  // Nudi Branch Manager
  "132c45ae85dc04fbd3f381cd972135af36b1f7ea",
  "999b6de9c270b6cf084e91d32519aab2f1b24366",
  "f78edbd368573323bec2926ac2459c1cc009a6f6",
  "a1bfc86887366dde276f85612da527a42f49d3a1",
  "129c619a92dfef320bf5e9fb98b05742b3e36a7b",
  "6da2fa0f46144ea10d89649891e6e7aef2964355",
  "4e80c87a290b277ca8c9770557c51119552827c8",
  "09361b603602c7aa91cf31ea3236aa39d049a4f6",
  "a86cab4596ddf0314085105b82709bbfd72017ca",
  // Cygnus Shy
  "a28cb915c46d2dcb4966227b7b34b475cc5cdfdc",
  "cd185b8e433a0179c4ffea8bd75db0ecd252c90c",
  "ce1ef641230b414aeb30ce82ce63b418334d53a9",
  "eb7c447489d5ac7dc20d38c1a658b843f933102e",
  "c73bd0646805fbbb12ecd768c90d88ac07194f6d",
  "fd8a4385cec80d48c4d960c5c4e145b8ca5834ad",
  "a2a57edb7708d629231c15bc1ff5fa6af728f513",
  // Flora Mingo
  "edc8481461023dbcd11a9cdd43607db51b9a5e49",
  "edb5d781162da4eb272fea42020ce8a14e36ef59",
  "d7db5d3f032ac43eb40c19d527e79ea12e4a6ac8",
  "93e39136932440ef7d122a427808cf6d1b383dd1",
  // Nova Remains
  "315078d06ac86e674de56d66f859d89bc516295e",
  "308e74d35484433631fb5f786294a1ecb6d6ae36",
  "69e0ef67759def985b27811707ef2b9baae03ce6",
  "451c25be5d978d1393363812ca1ae2f31f2db618",
  "c03fc532fda31868f7f0269abd2fe2eaa4560fb9",
  "30d841ea8b83576cf6e622d4fd5f08987daf8807",
  "ba2a2537792822fe82dd11f8f9d8aab93e37f1e0",
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

  it("binds every authored episode to its exact reviewed image", () => {
    const episodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes);
    const authoredSha1s = episodes.map((episode) => episode.mediaSha1);
    const curatedSha1s = SAMPLE_CURATED_DEMO_MEDIA.map((asset) => asset.sha1);

    expect(authoredSha1s).toEqual(EXPECTED_CURATED_MEDIA_SHA1S);
    expect(curatedSha1s).toEqual(EXPECTED_CURATED_MEDIA_SHA1S);
    expect(new Set(authoredSha1s).size).toBe(authoredSha1s.length);
    expect(authoredSha1s.every((sha1) => /^[0-9a-f]{40}$/.test(sha1))).toBe(true);
    expect(episodes.every((episode, index) =>
      episode.subject === SAMPLE_CURATED_DEMO_MEDIA[index]!.subject
    )).toBe(true);
    expect(curatedSha1s.filter((sha1) => KNOWN_BAD_CURATED_MEDIA_SHA1S.has(sha1))).toEqual([]);
  });

  it("keeps courtship as one strand of a much larger life", () => {
    const episodes = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes);
    const intimateThemes = new Set(["courtship", "family"]);

    expect(episodes).toHaveLength(45);
    expect(episodes.filter((episode) => intimateThemes.has(episode.theme))).toHaveLength(7);
    for (const arc of SAMPLE_CHARACTER_ARCS) {
      expect(arc.episodes.filter((episode) => intimateThemes.has(episode.theme)).length).toBeLessThanOrEqual(2);
    }

    const flora = SAMPLE_CHARACTER_ARCS.find((arc) => arc.characterId === "flora-mingo");
    expect(flora?.episodes).toHaveLength(4);
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
    expect(rainAsset?.detail).toBe("Praying mantis camouflaging");
  });

  it("renders through Wikimedia Commons and preserves valid corpus places", () => {
    const placeIds = new Set(SAMPLE_CORPUS_PLACES.map((place) => place.id));

    expect(SAMPLE_CORPUS_MEDIA.every((asset) =>
      WIKIMEDIA_IMAGE_HOSTS.has(new URL(sampleCorpusMediaUrl(asset)).hostname)
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

    expect(frogfish).toHaveLength(9);
    expect(new Set(openings).size).toBe(frogfish.length);
  });
});
