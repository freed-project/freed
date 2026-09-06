import type { Account, FeedItem, Person, RssFeed, SampleDataFingerprint } from "./types.js";
import { SAMPLE_CHARACTER_ARCS } from "./sample-character-arcs.js";
import { SAMPLE_CHARACTER_AVATAR_MEDIA, SAMPLE_CURATED_DEMO_MEDIA, sampleCorpusAttribution } from "./sample-corpus.js";
import { projectSampleYouTubeVideo } from "./sample-youtube.js";

const characterCareLevels: Readonly<Record<string, Person["careLevel"]>> = {
  "manny-tis": 5, "cygnus-shy": 4, "nudi-branch-manager": 3,
  "frogbert-angler": 3, "flora-mingo": 2, "nova-remains": 1,
};

const acceptedArcs = SAMPLE_CHARACTER_ARCS.map((arc) => ({
  ...arc,
  episodes: arc.episodes.filter((episode) => episode.mediaSha1 !== null),
})).filter((arc) => arc.episodes.length > 0);
const mediaBySha = new Map(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => [asset.sha1, asset]));
const feedPlatforms = new Set(["rss", "medium", "substack", "youtube"]);
const platformsFor = (arc: typeof acceptedArcs[number]) =>
  [...new Set(arc.episodes.map((episode) => episode.platform ?? arc.platform))];

/** Counts describe accepted editorial source, never the larger image catalog. */
export const SAMPLE_EDITORIAL_COUNTS = {
  items: acceptedArcs.reduce((sum, arc) => sum + arc.episodes.length, 0),
  persons: acceptedArcs.length,
  accounts: acceptedArcs.reduce((sum, arc) => sum + platformsFor(arc).length, 0),
  feeds: acceptedArcs.reduce((sum, arc) => sum + platformsFor(arc).filter((platform) => feedPlatforms.has(platform)).length, 0),
} as const;

/** Pure projection. It neither fetches sources nor mutates a Library. */
export function generateEditorialSampleData(options: {
  batchId: string;
  generatedAt: number;
  seed: number;
  fingerprint: SampleDataFingerprint;
  previousTopItemId?: string;
}): { items: FeedItem[]; persons: Person[]; accounts: Account[]; feeds: RssFeed[] } {
  const { batchId, generatedAt: now, fingerprint } = options;
  const namespace = encodeURIComponent(batchId);
  const items: FeedItem[] = [];
  const persons: Person[] = [];
  const accounts: Account[] = [];
  const feeds: RssFeed[] = [];
  const seed = options.seed | 0; // Match the existing PRNG integer coercion.
  const offset = ((seed % acceptedArcs.length) + acceptedArcs.length) % acceptedArcs.length;
  const orderedArcs = acceptedArcs.slice(offset).concat(acceptedArcs.slice(0, offset));
  const feedUrl = (characterId: string, platform: string) =>
    `https://sample.freed.wtf/${namespace}/${characterId}/${platform}`;

  for (const arc of orderedArcs) {
    const portrait = SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId);
    if (!portrait) throw new Error(`Missing reviewed portrait for ${arc.characterId}.`);
    const personId = `sample:${namespace}:person:${arc.characterId}`;
    // One identity across platforms; no catalog-index aliases or fabricated profiles.
    const authorId = `sample:${namespace}:author:${arc.characterId}`;
    persons.push({
      id: personId, name: arc.identityNameBase, bio: arc.bio,
      avatarUrl: portrait.imageUrl, relationshipStatus: "friend", careLevel: characterCareLevels[arc.characterId] ?? 3,
      tags: ["sample"], createdAt: now, updatedAt: now, sampleDataFingerprint: fingerprint,
    });
    for (const platform of platformsFor(arc)) {
      const first = arc.episodes.find((episode) => (episode.platform ?? arc.platform) === platform)!;
      const source = mediaBySha.get(first.mediaSha1!)!;
      accounts.push({
        id: `social:${platform}:${authorId}`, personId, kind: "social", provider: platform,
        externalId: authorId, handle: arc.characterId, displayName: arc.identityNameBase,
        avatarUrl: portrait.imageUrl, firstSeenAt: now, lastSeenAt: now,
        discoveredFrom: "captured_item", createdAt: now, updatedAt: now,
        sampleDataFingerprint: fingerprint,
      });
      if (feedPlatforms.has(platform)) feeds.push({
        url: feedUrl(arc.characterId, platform), title: arc.identityNameBase,
        siteUrl: first.video?.channelUrl ?? source.sourceUrl,
        imageUrl: portrait.imageUrl, enabled: false, trackUnread: true,
        folder: "Sample Feeds", sampleDataFingerprint: fingerprint,
      });
    }
    for (const episode of arc.episodes) {
      const asset = mediaBySha.get(episode.mediaSha1!);
      if (!asset) throw new Error(`Missing admitted image for ${arc.characterId}: ${episode.title}`);
      const platform = episode.platform ?? arc.platform;
      const contentType = episode.contentType ?? (feedPlatforms.has(platform) ? "article" : "post");
      const video = platform === "youtube"
        ? projectSampleYouTubeVideo(episode.video, asset.imageUrl, episode.body)
        : undefined;
      const sourceUrl = video?.sourceUrl ?? asset.sourceUrl;
      const text = video
        ? `${video.text}\nThumbnail by ${asset.creator}, ${asset.license}.\nThumbnail source: ${asset.sourceUrl}`
        : episode.body;
      // Every arc stays in editorial order. Even its earlier Stories remain in
      // the 22-hour Story window; no invented future travel or events are added.
      const publishedAt = now - Math.round((SAMPLE_EDITORIAL_COUNTS.items - items.length) * (22 * 3_600_000 / (SAMPLE_EDITORIAL_COUNTS.items + 1)));
      const item: FeedItem = {
        globalId: `${platform}:sample:${namespace}:${arc.characterId}:${asset.sha1}`,
        platform, contentType, publishedAt, capturedAt: now,
        author: { id: authorId, handle: arc.characterId, displayName: arc.identityNameBase, avatarUrl: portrait.imageUrl },
        content: {
          text, mediaUrls: [asset.imageUrl], mediaTypes: ["image"],
          linkPreview: { url: sourceUrl, title: episode.title, description: sampleCorpusAttribution(asset) },
        },
        sourceUrl, topics: [episode.theme],
        userState: { saved: false, archived: false, hidden: false, tags: [] },
        sampleDataFingerprint: fingerprint,
      };
      if (arc.location) item.location = { ...arc.location, coordinates: { ...arc.location.coordinates }, source: "text_extraction" };
      if (feedPlatforms.has(platform)) item.rssSource = {
        feedUrl: feedUrl(arc.characterId, platform), feedTitle: arc.identityNameBase,
        siteUrl: episode.video?.channelUrl ?? asset.sourceUrl,
      };
      {
        // Every authored sample is complete reader content, including Stories.
        const wordCount = text.trim().split(/\s+/).length;
        item.preservedContent = {
          text, author: arc.identityNameBase, publishedAt,
          wordCount, readingTime: Math.max(1, Math.ceil(wordCount / 200)), preservedAt: now,
        };
      }
      items.push(item);
    }
  }
  // Interleave whole character timelines without changing their internal order.
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const group = groups.get(item.author.id) ?? [];
    group.push(item);
    groups.set(item.author.id, group);
  }
  const timelines = [...groups.values()];
  let ordered: FeedItem[] = [];
  for (let round = 0; timelines.some((group) => group.length > round); round += 1) {
    const start = (offset + round) % timelines.length;
    for (let index = 0; index < timelines.length; index += 1) {
      const item = timelines[(start + index) % timelines.length]![round];
      if (item) ordered.push(item);
    }
  }
  const top = [...ordered].reverse().find((item) => item.contentType !== "story");
  if (top?.globalId === options.previousTopItemId) {
    const replacement = [...ordered].reverse().find((item) => item.contentType !== "story" && item.author.id !== top.author.id);
    if (replacement) {
      const lastGroup = ordered.filter((item) => item.author.id === replacement.author.id);
      ordered = ordered.filter((item) => item.author.id !== replacement.author.id).concat(lastGroup);
    }
  }
  ordered.forEach((item, index) => {
    item.publishedAt = now - Math.round((ordered.length - index) * (22 * 3_600_000 / (ordered.length + 1)));
    if (item.preservedContent) item.preservedContent.publishedAt = item.publishedAt;
  });
  return { items: ordered, persons, accounts, feeds };
}
