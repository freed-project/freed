import { generateSampleLibraryData } from "./sample-data.js";
import { SAMPLE_CHARACTER_ARCS } from "./sample-character-arcs.js";
import { SAMPLE_CHARACTER_AVATAR_MEDIA, SAMPLE_CURATED_DEMO_MEDIA, sampleCorpusAttribution, sampleCorpusMediaUrl, sampleCorpusSourceUrl } from "./sample-corpus.js";
import { sampleEditorialContentSignals } from "./sample-editorial-data.js";
import { projectSampleYouTubeVideo } from "./sample-youtube.js";
import type { Account, FeedItem, Person, RssFeed } from "./types.js";

/** Authored publication names, never generated from a generic suffix. */
const DEMO_RSS_PUBLICATION_TITLES: Readonly<Record<string, string>> = {
  "nova-remains": "Nova's Afterglow",
  "alma-eight": "Alma's Eight-Sided Argument",
  "alba-longwing": "Alba Takes the Long Way",
  "faye-thread": "Faye's Loose Ends",
  "ellis-hook": "Ellis Was Never Here",
  "moss-button": "Moss, Transparently",
  "ada-dew": "Ada After Dark",
  "nib-willow": "Nib's Branch Office",
  "juniper-ears": "Juniper Heard That",
  "orla-reach": "Orla Gets to the Point",
  "finch-fidget": "Finch Can't Sit Still",
  "bramble-shortlegs": "Bramble's Underground Affairs",
  "kit-snowshoe": "Kit's Haypile Dispatch",
  "mallow-fold": "Mallow, Unfolded",
  "nessa-whisker": "Nessa Below Zero",
  "mira-mask": "Mira's Midnight Acquisitions",
  "nell-pelagic": "Nell Flaps Through It",
  "percy-silt": "Percy's Bottom Line",
  "vera-veil": "Vera Lets It Drift",
  "iris-undertow": "Iris Changes the Subject",
  "tavi-tilt": "Tavi Sees Another Colour",
  "rue-ribbon": "Rue's Narrow Opening",
  "rollo-round": "Rollo Under Pressure",
  "peri-bracken": "Peri's Next Instar",
  "ludo-bluecap": "Under Ludo's Little Umbrella",
  "oona-rose": "Oona Is Several Things",
  "vesta-prickle": "Vesta Sticks to Her Story",
  "ottilie-hook": "Ottilie's Acorn Affairs",
  "dora-dew": "Dora's Sticky Invitations",
  "coral-clad": "Coral's Joint Account",
  "sela-current": "Sela Keeps Going",
  "ivo-softshield": "Ivo's Unfurling Business",
  "calder-mugger": "Calder's Patient Smile",
  "gilda-grip": "Gilda Holds On",
  "tess-near": "Tess at Arm's Length",
  "miri-faint": "Miri's Falling Company",
  "claude-carry": "Claude Brings the House",
  "otto-interlace": "Otto's Tangled Attachments",
  "pip-sway": "Pip Goes with the Flow",
  "rudi-glide": "Rudi's Unscheduled Landing",
  "mireille-tap": "Mireille Knocks on Wood",
  "yuri-thaw": "Yuri Follows His Nose",
  "akio-sheen": "Akio in a Different Light",
  "lucette-vein": "Lucette's Delicate Business",
  "greta-blade": "Greta in the Tall Grass",
  "barnaby-many": "Barnaby Puts His Feet Down",
  "penny-focus": "Penny's Small Leaps",
  "romy-helix": "Romy's Spiral Correspondence",
  "oswald-cup": "Oswald Takes It All In",
  "severin-quiet": "Severin's Nothing Happened Today",
  "dorian-sulk": "Dorian Sits with It",
  "cato-many": "Cato's Many Open Arms"
};

function demoRssPublicationTitle(characterId: string): string {
  const title = DEMO_RSS_PUBLICATION_TITLES[characterId];
  if (!title) throw new Error(`Missing editorial RSS publication title for ${characterId}`);
  return title;
}

const admittedPopulationArcs = SAMPLE_CHARACTER_ARCS.map(arc => ({
  ...arc, episodes: arc.episodes.filter(episode => episode.mediaSha1 !== null),
})).filter(arc => arc.episodes.length > 0);
/** Counts for the single user-facing population routine. Stress fixtures are separate. */
export const DEMO_POPULATION_COUNTS = {
  items: admittedPopulationArcs.reduce((sum, arc) => sum + arc.episodes.length, 0),
  persons: admittedPopulationArcs.length,
  friends: Math.round(admittedPopulationArcs.length * 0.15),
  accounts: admittedPopulationArcs.reduce((sum, arc) => sum + new Set(arc.episodes.map(episode => episode.platform ?? arc.platform)).size, 0),
  feeds: admittedPopulationArcs.filter(arc => arc.episodes.some(episode => (episode.platform ?? arc.platform) === "rss")).length,
} as const;

const DEMO_CHARACTER_CARE_LEVELS = {
  "manny-tis": 5,
  "cygnus-shy": 4,
  "nudi-branch-manager": 3,
  "frogbert-angler": 3,
  "flora-mingo": 2,
  "nova-remains": 1,
  "alma-eight": 4,
  "mora-grey": 2,
  "colm-still": 1,
} as const satisfies Readonly<Record<string, Person["careLevel"]>>;


function stablePresentationNumber(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}

function curatedDemoSample(
  sample: ReturnType<typeof generateSampleLibraryData>,
  generatedAt: number,
  presentationSeed: number,
  previousTopItemId: string | null | undefined,
  batchId: string,
) {
  if (!sample.items.length || !sample.persons.length || !sample.accounts.length || !sample.feeds.length) {
    throw new Error("The demo requires nonempty record templates.");
  }
  const mediaBySha = new Map(SAMPLE_CURATED_DEMO_MEDIA.map((asset) => [asset.sha1, asset]));
  const mediaByCharacter = new Map<string, typeof SAMPLE_CURATED_DEMO_MEDIA>();
  for (const arc of SAMPLE_CHARACTER_ARCS) {
    mediaByCharacter.set(
      arc.characterId,
      arc.episodes.flatMap((episode) => {
        const asset = episode.mediaSha1 ? mediaBySha.get(episode.mediaSha1) : undefined;
        return asset ? [asset] : [];
      }),
    );
  }
  const characterItems = new Map<string, FeedItem[]>();
  let templateIndex = 0;
  for (const arc of SAMPLE_CHARACTER_ARCS) {
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    const avatar = SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId) ?? assets[0];
    const externalId = `${batchId}:sample-character-${arc.characterId}`;
    const items = arc.episodes.flatMap((episode, sequence) => {
      // Keep sequence IDs from the authored timeline, including unpublished gaps.
      if (!episode.mediaSha1) return [];
      if (!episode.classification) {
        throw new Error(`Missing editorial classification for ${arc.characterId}:${sequence}`);
      }
      const platform = episode.platform ?? arc.platform;
      const contentType = episode.contentType ?? (
        platform === "rss" || platform === "medium" || platform === "substack"
          ? "article" : platform === "youtube" ? "video" : "post"
      );
      const asset = episode.mediaSha1 ? mediaBySha.get(episode.mediaSha1) : undefined;
      if (episode.mediaSha1 && !asset) {
        throw new Error(`Missing reviewed demo media for ${arc.characterId}:${sequence}`);
      }
      if ((platform === "youtube") !== (contentType === "video") ||
          (episode.video && platform !== "youtube")) {
        throw new Error("Demo video metadata requires the YouTube video format.");
      }
      const video = platform === "youtube"
        ? projectSampleYouTubeVideo(episode.video, sampleCorpusMediaUrl(asset!), episode.body)
        : undefined;
      // The reader displays content text, not link descriptions. Preserve both
      // independent creators' credits there, including the thumbnail's license.
      const thumbnailCredit = video && asset
        ? `Thumbnail by ${asset.creator}, ${asset.license}. Source: ${sampleCorpusSourceUrl(asset)}`
        : undefined;
      // Templates supply record defaults, not a ceiling on authored content.
      // Every public identity and content field is replaced below.
      const template = sample.items[templateIndex++ % sample.items.length]!;
      const globalId = `${batchId}:sample-character:${arc.characterId}:${sequence}`;
      const sourceUrl = video?.sourceUrl ?? (asset
        ? sampleCorpusSourceUrl(asset)
        : `https://demo.freed.wtf/?item=${encodeURIComponent(globalId)}`);
      return [{
        ...template,
        globalId,
        platform,
        contentType,
        sourceUrl,
        author: {
          id: externalId,
          displayName: arc.identityNameBase,
          handle: arc.characterId,
          avatarUrl: avatar ? sampleCorpusMediaUrl(avatar) : undefined,
        },
        content: {
          text: video ? `${video.text}\n\n${thumbnailCredit}` : episode.body,
          mediaUrls: asset ? [sampleCorpusMediaUrl(asset)] : [],
          mediaTypes: asset ? ["image" as const] : [],
          linkPreview: {
            url: sourceUrl,
            title: episode.title,
            description: video
              ? `${video.attribution}\n${thumbnailCredit}`
              : (asset ? sampleCorpusAttribution(asset) : undefined),
          },
        },
        contentSignals: sampleEditorialContentSignals(episode.classification, generatedAt),
        ...(platform === "rss"
          ? {
              rssSource: {
                feedUrl: `https://sample.freed.wtf/${batchId}/characters/${arc.characterId}`,
                feedTitle: demoRssPublicationTitle(arc.characterId),
                siteUrl: "https://sample.freed.wtf",
              },
            }
          : { rssSource: undefined }),
        ...(arc.location || asset?.coordinates
          ? {
              location: {
                name: arc.location?.name ?? asset!.detail,
                coordinates: arc.location?.coordinates ?? asset!.coordinates!,
                source: "text_extraction" as const,
              },
            }
          : { location: undefined }),
        preservedContent: contentType === "article"
          ? {
              preservedAt: generatedAt,
              publishedAt: generatedAt,
              author: arc.identityNameBase,
              text: episode.body,
              wordCount: episode.body.trim().split(/\s+/).length,
              readingTime: Math.max(1, Math.ceil(episode.body.trim().split(/\s+/).length / 200)),
            }
          : undefined,
        userState: {
          ...template.userState,
          // A replacement demo begins unread, regardless of sample-template history.
          readAt: undefined,
          seenSyncedAt: undefined,
          archived: false,
          hidden: false,
        },
      } satisfies FeedItem];
    });
    characterItems.set(arc.characterId, items);
  }

  const newestFirst: FeedItem[] = [];
  const maximumEpisodes = Math.max(...[...characterItems.values()].map((items) => items.length));
  for (let round = 0; round < maximumEpisodes; round += 1) {
    const activeArcs = SAMPLE_CHARACTER_ARCS
      .filter((arc) => round < (characterItems.get(arc.characterId)?.length ?? 0))
      .sort((left, right) =>
        stablePresentationNumber(`${round}:${left.characterId}`, presentationSeed) -
        stablePresentationNumber(`${round}:${right.characterId}`, presentationSeed)
      );
    for (const arc of activeArcs) {
      const episodes = characterItems.get(arc.characterId)!;
      newestFirst.push(episodes[episodes.length - 1 - round]!);
    }
  }
  const visibleTopIndex = newestFirst.findIndex((item) => item.contentType !== "story");
  const visibleTop = newestFirst[visibleTopIndex];
  if (visibleTop && visibleTop.globalId === previousTopItemId) {
    const replacementIndex = newestFirst.findIndex((item, index) =>
      index !== visibleTopIndex &&
      item.contentType !== "story" &&
      item.author.id !== visibleTop.author.id
    );
    if (replacementIndex >= 0) {
      [newestFirst[visibleTopIndex], newestFirst[replacementIndex]] = [
        newestFirst[replacementIndex]!,
        newestFirst[visibleTopIndex]!,
      ];
    }
  }
  const timelineSlots = sample.items
    .slice(0, newestFirst.length)
    .map((item) => item.publishedAt)
    .sort((left, right) => right - left);
  const items = newestFirst.map((item, index) => {
    const publishedAt = timelineSlots[index]
      ?? (timelineSlots.at(-1) ?? generatedAt) - (index - timelineSlots.length + 1) * 60_000;
    const delta = publishedAt - item.publishedAt;
    return {
      ...item,
      publishedAt,
      capturedAt: item.capturedAt + delta,
    };
  });

  const admittedArcs = SAMPLE_CHARACTER_ARCS.filter((arc) => characterItems.get(arc.characterId)?.length);
  // Stable membership makes the two feed scopes meaningfully different without
  // changing who is a friend whenever the timeline is shuffled. Preserve curated
  // close relationships first, then fill the remaining slots deterministically.
  const curatedCare = (id: string) =>
    DEMO_CHARACTER_CARE_LEVELS[id as keyof typeof DEMO_CHARACTER_CARE_LEVELS];
  const membershipPriority = (id: string) => {
    const level = curatedCare(id);
    return level === undefined ? 1 : level >= 3 ? 0 : 2;
  };
  const friendIds = new Set([...admittedArcs]
    .sort((left, right) =>
      membershipPriority(left.characterId) - membershipPriority(right.characterId)
      || stablePresentationNumber(left.characterId, 0) - stablePresentationNumber(right.characterId, 0)
      || left.characterId.localeCompare(right.characterId))
    .slice(0, Math.round(admittedArcs.length * 0.15))
    .map((arc) => arc.characterId));
  const persons = admittedArcs.map((arc, index) => {
    const template = sample.persons[index % sample.persons.length]!;
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    const isFriend = friendIds.has(arc.characterId);
    const preferredCare = curatedCare(arc.characterId);
    // Care level is relationship status, not a second independent rating.
    const careLevel = (isFriend
      ? preferredCare !== undefined && preferredCare >= 3 ? preferredCare : 3 + stablePresentationNumber(arc.characterId, 0) % 3
      : preferredCare !== undefined && preferredCare <= 2 ? preferredCare : 1 + stablePresentationNumber(arc.characterId, 0) % 2
    ) as Person["careLevel"];
    return {
      ...template,
      id: `${batchId}:sample-person-${arc.characterId}`,
      name: arc.identityNameBase,
      bio: arc.bio,
      avatarUrl: SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId)?.baseUrl ?? (assets[0] ? sampleCorpusMediaUrl(assets[0]) : undefined),
      careLevel,
      relationshipStatus: isFriend ? "friend" : "connection",
    } satisfies Person;
  });
  const accounts = admittedArcs.flatMap((arc, index) => {
    const template = sample.accounts[index % sample.accounts.length]!;
    const assets = mediaByCharacter.get(arc.characterId) ?? [];
    const externalId = `${batchId}:sample-character-${arc.characterId}`;
    const platforms = [...new Set(characterItems.get(arc.characterId)!.map((item) => item.platform))];
    return platforms.map((platform) => ({
      ...template,
      id: `social:${platform}:${externalId}`,
      provider: platform,
      externalId,
      handle: arc.characterId,
      displayName: arc.identityNameBase,
      avatarUrl: SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId)?.baseUrl ?? (assets[0] ? sampleCorpusMediaUrl(assets[0]) : undefined),
      personId: persons[index]!.id,
    } satisfies Account));
  });
  const feedTemplate = sample.feeds[0]!;
  const feeds: RssFeed[] = admittedArcs.filter((arc) => characterItems.get(arc.characterId)!.some((item) => item.platform === "rss")).map((arc) => ({
    ...feedTemplate,
    // Sample feeds are presentation records, never scheduled RSS endpoints.
    enabled: false,
    url: `https://sample.freed.wtf/${batchId}/characters/${arc.characterId}`,
    title: demoRssPublicationTitle(arc.characterId),
    siteUrl: "https://sample.freed.wtf",
    imageUrl: undefined,
  }));
  return { accounts, feeds, items, persons };
}


/** One curated population for public demos and sample actions in every build; no storage or network access. */
export function generateDemoLibraryData(options: {
  batchId: string;
  generatedAt: number;
  presentationSeed: number;
  previousTopItemId?: string | null;
}) {
  const sample = generateSampleLibraryData({
    ...options,
    previousTopItemId: options.previousTopItemId ?? undefined,
    friendCount: 80,
    identitiesPerFriend: 2,
    seed: 20260831,
    unlinkedIdentityRatio: 1,
  });
  return curatedDemoSample(sample, options.generatedAt, options.presentationSeed, options.previousTopItemId, options.batchId);
}
