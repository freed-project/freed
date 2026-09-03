/**
 * Sample data generator for regression testing.
 *
 * Produces a showcase-scale local library with deterministic IDs so
 * repeated calls are idempotent against registered SQLite mutations.
 *
 * All feed URLs use the `https://sample.freed.wtf/` prefix to avoid
 * colliding with real subscriptions and to prevent actual fetch attempts.
 */

import type {
  Account,
  FeedItem,
  Person,
  RssFeed,
  SampleDataFingerprint,
} from "./types.js";
import {
  SAMPLE_CORPUS_MEDIA,
  SAMPLE_CORPUS_VERSION,
  sampleCorpusAttribution,
  sampleCorpusDisplayTitle,
  sampleCorpusGeneratedText,
  sampleCorpusIdentityBio,
  sampleCorpusIdentityName,
  sampleCorpusMedia,
  sampleCorpusMediaUrl,
  sampleCorpusPlace,
  sampleCorpusSourceUrl,
  type SampleCorpusPlatform,
} from "./sample-corpus.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── Feed definitions ────────────────────────────────────────────────────────

interface FeedDef {
  channel: "medium" | "substack" | "youtube";
  slug: string;
  title: string;
  siteUrl: string;
}

const FEED_DEFS: FeedDef[] = [
  { channel: "substack", slug: "mantis-has-notes", title: "The Mantis Has Notes, Substack", siteUrl: "https://sample.freed.wtf/substack/mantis" },
  { channel: "substack", slug: "longform-from-the-abyss", title: "Longform from the Abyss, Substack", siteUrl: "https://sample.freed.wtf/substack/abyss" },
  { channel: "substack", slug: "deep-time-dispatch", title: "Deep Time Dispatch, Substack", siteUrl: "https://sample.freed.wtf/substack/deep-time" },
  { channel: "substack", slug: "letters-from-a-minor-galaxy", title: "Letters from a Minor Galaxy, Substack", siteUrl: "https://sample.freed.wtf/substack/galaxy" },
  { channel: "substack", slug: "opinionated-tidepool", title: "The Opinionated Tidepool, Substack", siteUrl: "https://sample.freed.wtf/substack/tidepool" },
  { channel: "medium", slug: "wildly-overqualified", title: "Wildly Overqualified, Medium", siteUrl: "https://sample.freed.wtf/medium/overqualified" },
  { channel: "medium", slug: "patient-planet", title: "The Patient Planet, Medium", siteUrl: "https://sample.freed.wtf/medium/planet" },
  { channel: "medium", slug: "field-notes-with-boundaries", title: "Field Notes with Boundaries, Medium", siteUrl: "https://sample.freed.wtf/medium/boundaries" },
  { channel: "medium", slug: "astonishment-edited", title: "Astonishment, Edited, Medium", siteUrl: "https://sample.freed.wtf/medium/astonishment" },
  { channel: "medium", slug: "natural-causes", title: "Natural Causes, Medium", siteUrl: "https://sample.freed.wtf/medium/natural-causes" },
  { channel: "youtube", slug: "mantis-cam", title: "Mantis Cam, YouTube", siteUrl: "https://sample.freed.wtf/youtube/mantis" },
  { channel: "youtube", slug: "deep-sea-main-character", title: "Deep Sea Main Character, YouTube", siteUrl: "https://sample.freed.wtf/youtube/deep-sea" },
  { channel: "youtube", slug: "rock-drama", title: "Rock Drama, YouTube", siteUrl: "https://sample.freed.wtf/youtube/rock-drama" },
  { channel: "youtube", slug: "galaxy-live-technically", title: "Galaxy Live, Technically, YouTube", siteUrl: "https://sample.freed.wtf/youtube/galaxy" },
  { channel: "youtube", slug: "unreasonable-creatures", title: "Unreasonable Creatures, YouTube", siteUrl: "https://sample.freed.wtf/youtube/creatures" },
];

// ── Topic + headline pools ──────────────────────────────────────────────────

const TOPICS = [
  "astronomy", "oceans", "forests", "wildlife", "geology",
  "weather", "conservation", "ecology", "climate", "photography",
  "field-notes", "earth-science", "space", "mountains", "deserts",
];

const RSS_HEADLINES: string[] = [
  "New compiler optimization reduces build times by 40%",
  "The hidden costs of microservice architectures",
  "Why SQLite is the most deployed database engine",
  "A deep dive into modern garbage collection strategies",
  "Browser vendors agree on new web component standard",
  "How end-to-end encryption actually works in practice",
  "The resurgence of server-side rendering in 2026",
  "Open-source maintainers push back on corporate free-riding",
  "Inside the race to build chips that run on light",
  "What the latest kernel update means for desktop Linux",
  "Zero-knowledge proofs explained without the math",
  "Revisiting the Unix philosophy in a containerized world",
  "How DNS over HTTPS changes your threat model",
  "The case for writing your own static site generator",
  "Understanding memory-safe languages beyond Rust",
  "Why your CI pipeline is slower than it needs to be",
  "Graph databases find their niche in fraud detection",
  "The surprising history of the cursor (the blinking kind)",
  "Mesh networking takes another step toward the mainstream",
  "Functional programming patterns in everyday TypeScript",
  "A practical guide to WebAssembly outside the browser",
  "The economics of running a one-person SaaS",
  "How image diffusion models learn to see edges",
  "Tracking the mass migration away from centralized social media",
  "What makes a good API error message",
  "Small language models hit a performance inflection point",
  "The art of designing keyboard-first interfaces",
  "Distributed consensus is still an unsolved UX problem",
  "TLS 1.3 adoption finally passes 90% globally",
  "A tour of the most interesting RISC-V boards in 2026",
  "Container escape vulnerabilities and what to do about them",
  "Why plain text is the most durable file format",
  "Building offline-first apps that actually sync correctly",
  "The environmental footprint of training large models",
  "An oral history of the RSS ecosystem",
  "Rethinking pagination for infinite-scroll fatigue",
  "Hardware security keys go mainstream with passkey adoption",
  "Porting a game engine from C++ to Zig: lessons learned",
  "When your database is too fast for its own good",
  "The ergonomics of error handling across six languages",
  "MapReduce is dead, long live MapReduce",
  "What happens when you type a URL and press enter (2026 edition)",
  "The state of native app development on Linux",
  "How multiplayer collaboration works in CRDTs",
  "Designing systems that degrade gracefully under load",
  "Accessibility audits catch what automated tools miss",
  "The slow comeback of personal websites",
  "Understanding CPU branch prediction in five minutes",
  "Why observability is eating monitoring",
  "A field guide to text encoding bugs",
  "Solar-powered edge computing reaches remote villages",
  "Local-first software and the ownership question",
  "The hidden complexity of date and time handling",
  "Static analysis tools that actually find real bugs",
  "How peer-to-peer sync scales without a server",
  "Running ML inference on a Raspberry Pi 5",
  "The tension between DRY and readability",
  "What package managers can learn from Nix",
  "BitTorrent turns 25 and remains unmatched for large files",
  "Writing documentation that people actually read",
  "How content-addressable storage simplifies backups",
  "Exploring the design space of terminal emulators",
  "Why semantic versioning keeps breaking in practice",
  "A comparison of embedded key-value stores in 2026",
  "The unintended consequences of ad blockers on the open web",
  "How streaming architectures replace batch processing",
  "Making search work well on small datasets",
  "Type systems as a tool for thinking, not just checking",
  "The physics of fiber optic signal degradation",
  "Digital gardens and the evolution of personal knowledge management",
  "Benchmarking async runtimes: Tokio vs. Glommio vs. smol",
  "Why every developer should understand basic cryptography",
  "The pragmatic case for monorepos",
  "How screen readers interpret modern web layouts",
  "Edge computing meets agriculture: precision farming updates",
  "Reverse engineering a proprietary protocol for interoperability",
  "Color spaces and why your purple looks different on every screen",
  "The unseen labor behind open data initiatives",
  "What SQLite's test suite can teach us about reliability",
  "Building a search engine for a 10-million-document corpus",
];

const SAVED_HEADLINES: string[] = [
  "A field guide to reading clouds before the forecast arrives",
  "Why old forests store more than carbon",
  "The hidden architecture of a coral reef",
  "How migrating birds navigate a planet without road signs",
  "A practical guide to the winter constellations",
  "What desert varnish reveals about deep time",
  "The patient physics of glaciers",
  "How whale songs travel through an entire ocean basin",
  "A visual introduction to storm structure",
  "Why bioluminescence evolved so many times",
  "The improbable engineering of a feather",
  "How to read a topographic map",
  "A natural history of moss",
  "What happens inside a stellar nursery",
  "The ecological importance of inconvenient predators",
  "How dunes remember the wind",
  "A complete guide to tide pools after dark",
  "Why rivers refuse to stay where maps put them",
  "The great seasonal machinery of monsoons",
  "Learning the night sky without turning it into homework",
];

const SAVED_DOMAINS = [
  "deepfield.sample.freed.wtf", "wildwater.sample.freed.wtf",
  "patientgeology.sample.freed.wtf", "nightwatch.sample.freed.wtf",
  "livingforest.sample.freed.wtf", "weatherdesk.sample.freed.wtf",
  "migration.sample.freed.wtf", "reefnotes.sample.freed.wtf",
  "icearchive.sample.freed.wtf", "fieldmanual.sample.freed.wtf",
];

// ── Social post pools ────────────────────────────────────────────────────────

const X_POSTS: string[] = [
  "Saturn continues to have absolutely unreasonable visual branding.",
  "The volcano remains unconcerned about our revised itinerary.",
  "A raven stole the lens cap. Peer review has become hostile.",
  "The Milky Way contains at least one hundred billion stars and still found room for our emails.",
  "Wind erased every footprint before lunch. The desert has excellent data-retention policies.",
  "Rock versus ocean, year nine million. Neither side appears interested in mediation.",
  "The atmosphere has escalated the disagreement.",
  "A whale surfaced, took one breath, and improved the entire horizon.",
  "Water found the shortest path downhill and then made it unnecessarily beautiful.",
  "Orion is forming new stars while we debate whether the meeting needed an agenda.",
];

const X_AUTHORS = [
  { id: "sample-x-1", handle: "@orbitmanual", displayName: "Orbit Manual" },
  { id: "sample-x-2", handle: "@weatherwindow", displayName: "Weather Window" },
  { id: "sample-x-3", handle: "@fieldmargins", displayName: "Field Margins" },
  { id: "sample-x-4", handle: "@deepbluehours", displayName: "Deep Blue Hours" },
  { id: "sample-x-5", handle: "@patientgeology", displayName: "Patient Geology" },
];

const FACEBOOK_POSTS: string[] = [
  "We hiked six hours for this cloud. No notes.",
  "The calf attempted to investigate every tree, rock, camera, and adult. A productive morning.",
  "Low water at Silver Falls today, but the moss has compensated with theatrical commitment.",
  "A giraffe reviewed the canopy and reports that the leaves are excellent up there.",
  "Storm rolled through after dinner. The dog objected formally and at length.",
  "The tide erased our elaborate sand diagram before anyone could assign action items.",
  "Three owls outside the cabin. Apparently we are the evening entertainment.",
  "The lake achieved perfect stillness. We immediately ruined it by discussing aperture.",
  "A fox crossed the trail and looked embarrassed for us.",
  "No signal for two days. The mountains somehow continued operating.",
];

const FACEBOOK_AUTHORS = [
  { id: "sample-fb-1", handle: "Weekend Field Notes", displayName: "Weekend Field Notes" },
  { id: "sample-fb-2", handle: "Cabin Weather Club", displayName: "Cabin Weather Club" },
  { id: "sample-fb-3", handle: "Neighborhood Naturalists", displayName: "Neighborhood Naturalists" },
  { id: "sample-fb-4", handle: "Migration Watch", displayName: "Migration Watch" },
  { id: "sample-fb-5", handle: "River Friends", displayName: "River Friends" },
];

const INSTAGRAM_POSTS: string[] = [
  "Morning light across the dunes. The wind did all the art direction.",
  "The forest built a cathedral and forgot to install a gift shop.",
  "Black sand, white water, and Iceland showing off again.",
  "Tonight's weather: electrically opinionated.",
  "The reef deployed turquoise without consulting the design system.",
  "Moraine Lake continues to look computationally expensive.",
  "Interstellar dust, but make it cathedral lighting.",
  "Dawn at Lewa. Nobody hurried, especially the elephant.",
  "A seven-light-year bubble blown by a star. Subtlety remains optional.",
  "Golden hour arrived. The giraffe was already dressed for it.",
];

const INSTAGRAM_REPEAT_REFLECTIONS: string[] = [
  "No filter. Creation had already made several decisions.",
  "We stood quietly for a minute, an unusually successful group project.",
  "The scale is difficult to explain and rude to reduce to a rectangle.",
  "The weather provided the lighting department and declined further notes.",
  "A reminder that grandeur does not require a launch strategy.",
  "The horizon remained gloriously indifferent to our calendar.",
  "Nothing here asked to become content. We behaved ourselves as best we could.",
  "The planet continues to outperform the mood board.",
  "Silence, distance, and an unreasonable quantity of light.",
  "The view was free. The humility arrived somewhat later.",
  "Proof that the world can be dramatic without issuing a press release.",
  "We brought cameras. The landscape brought everything else.",
];

const INSTAGRAM_AUTHORS = [
  { id: "sample-ig-1", handle: "@earth.after.light", displayName: "Earth After Light" },
  { id: "sample-ig-2", handle: "@smallhours.sky", displayName: "Small Hours Sky" },
  { id: "sample-ig-3", handle: "@wildwater.archive", displayName: "Wild Water Archive" },
  { id: "sample-ig-4", handle: "@patient.mountains", displayName: "Patient Mountains" },
  { id: "sample-ig-5", handle: "@field.notes.only", displayName: "Field Notes Only" },
];

const LINKEDIN_POSTS: string[] = [
  "Field lesson: the best monitoring system remains looking at the river long enough to notice it changed.",
  "Conservation succeeds through patient local work, reliable measurements, and considerably fewer heroic keynote slides.",
  "The observatory ran all night without a growth strategy. It produced excellent results anyway.",
  "A healthy forest is an infrastructure project with a several-century planning horizon.",
  "The expedition plan survived first contact with weather for almost eleven minutes.",
  "We completed the migration survey. The birds declined to align their route with our reporting calendar.",
  "Good field notes separate what happened from what everyone hoped would happen. Organizations could try this.",
  "The reef restoration team celebrated a small increase in coral cover. Small, measured wins are still wins.",
  "If your climate dashboard cannot be understood by the people living beside the river, redesign the dashboard.",
  "The mountain remains a persuasive argument for humility, risk management, and better socks.",
];

const LINKEDIN_AUTHORS = [
  { id: "sample-li-1", handle: "ada-lovelace-lab", displayName: "Ada Lovelace Lab" },
  { id: "sample-li-2", handle: "field-ops-journal", displayName: "Field Ops Journal" },
  { id: "sample-li-3", handle: "systems-and-sunlight", displayName: "Systems and Sunlight" },
  { id: "sample-li-4", handle: "quiet-launches", displayName: "Quiet Launches" },
  { id: "sample-li-5", handle: "network-state-notes", displayName: "Network State Notes" },
];

// ── Story pools ──────────────────────────────────────────────────────────────

const IG_STORY_AUTHORS = [
  { id: "sample-ig-sa-1", handle: "@afterlight.earth", displayName: "Afterlight Earth" },
  { id: "sample-ig-sa-2", handle: "@deep.field", displayName: "Deep Field" },
  { id: "sample-ig-sa-3", handle: "@the.alpine.hour", displayName: "The Alpine Hour" },
  { id: "sample-ig-sa-4", handle: "@weather.room", displayName: "Weather Room" },
  { id: "sample-ig-sa-5", handle: "@sky.archive", displayName: "Sky Archive" },
  { id: "sample-ig-sa-6", handle: "@quiet.tide", displayName: "Quiet Tide" },
  { id: "sample-ig-sa-7", handle: "@trail.camera", displayName: "Trail Camera" },
  { id: "sample-ig-sa-8", handle: "@smallhours.space", displayName: "Small Hours Space" },
];

const FB_STORY_AUTHORS = [
  { id: "sample-fb-sa-1", handle: "River Weather Club", displayName: "River Weather Club" },
  { id: "sample-fb-sa-2", handle: "Weekend Naturalists", displayName: "Weekend Naturalists" },
  { id: "sample-fb-sa-3", handle: "Coast Watch", displayName: "Coast Watch" },
  { id: "sample-fb-sa-4", handle: "Backyard Astronomy", displayName: "Backyard Astronomy" },
  { id: "sample-fb-sa-5", handle: "Morning Migration", displayName: "Morning Migration" },
  { id: "sample-fb-sa-6", handle: "Forest Neighbors", displayName: "Forest Neighbors" },
  { id: "sample-fb-sa-7", handle: "The Night Watch", displayName: "The Night Watch" },
];

// Short captions for stories. Most are null so the photograph can carry the moment.
interface SamplePersonDef {
  id: string;
  name: string;
  careLevel: Person["careLevel"];
  bio: string;
  avatarUrl: string;
  notes?: string;
  sources: Array<{
    platform: FeedItem["platform"];
    authorId: string;
    handle: string;
    displayName: string;
    avatarUrl: string;
  }>;
}

export interface SampleDataOptions {
  batchId?: string;
  generatedAt?: number;
  seed?: number;
  presentationSeed?: number;
  previousTopItemId?: string;
  scale?: "showcase" | "stress";
  friendCount?: number;
  identitiesPerFriend?: number;
  unlinkedIdentityRatio?: number;
}

export const SAMPLE_SHOWCASE_FEED_COUNT = 15;
export const SAMPLE_SHOWCASE_FRIEND_COUNT = 250;
export const SAMPLE_SHOWCASE_IDENTITIES_PER_FRIEND = 5;
export const SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT =
  SAMPLE_SHOWCASE_FRIEND_COUNT * SAMPLE_SHOWCASE_IDENTITIES_PER_FRIEND;
export const SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT =
  Math.round(SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT * 0.2);
export const SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT =
  SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT + SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT;
const SAMPLE_LOCATION_WINDOW_ITEM_COUNT = 6;
export const SAMPLE_SHOWCASE_ITEM_COUNT =
  SAMPLE_SHOWCASE_FEED_COUNT * 8 +
  20 +
  10 +
  10 +
  10 +
  10 +
  8 +
  7 +
  SAMPLE_LOCATION_WINDOW_ITEM_COUNT +
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT;
export const SAMPLE_STRESS_FRIEND_COUNT = 1_000;
export const SAMPLE_STRESS_IDENTITIES_PER_FRIEND = 5;
export const SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT =
  SAMPLE_STRESS_FRIEND_COUNT * SAMPLE_STRESS_IDENTITIES_PER_FRIEND;
export const SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT =
  Math.round(SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT * 0.2);
export const SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT =
  SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT + SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT;
export const SAMPLE_DATA_FINGERPRINT = "freed.sample-data.v1" as const;
export const SAMPLE_DATA_GENERATOR_VERSION = 11;
export const SAMPLE_DATA_CORPUS_VERSION = SAMPLE_CORPUS_VERSION;

interface ResolvedSampleDataOptions {
  batchId: string;
  generatedAt: number;
  seed: number;
  presentationSeed: number | undefined;
  previousTopItemId: string | undefined;
  friendCount: number;
  identitiesPerFriend: number;
  unlinkedIdentityRatio: number;
}

// ── Deterministic pseudo-random ─────────────────────────────────────────────

/** Simple seeded PRNG (mulberry32) for reproducible distributions. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(31, hash) + input.charCodeAt(i) | 0;
  }
  return hash;
}

function makeBatchId(): string {
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveSampleDataOptions(options?: SampleDataOptions): ResolvedSampleDataOptions {
  const batchId = options?.batchId ?? makeBatchId();
  const scale = options?.scale ?? "showcase";
  const friendCount = options?.friendCount ??
    (scale === "stress" ? SAMPLE_STRESS_FRIEND_COUNT : SAMPLE_SHOWCASE_FRIEND_COUNT);
  const identitiesPerFriend = options?.identitiesPerFriend ??
    (scale === "stress" ? SAMPLE_STRESS_IDENTITIES_PER_FRIEND : SAMPLE_SHOWCASE_IDENTITIES_PER_FRIEND);
  const unlinkedIdentityRatio = Math.max(0, Math.min(1, options?.unlinkedIdentityRatio ?? 0.2));
  return {
    batchId,
    generatedAt: options?.generatedAt ?? Date.now(),
    seed: options?.seed ?? hashSeed(batchId),
    presentationSeed: options?.presentationSeed,
    previousTopItemId: options?.previousTopItemId,
    friendCount,
    identitiesPerFriend,
    unlinkedIdentityRatio,
  };
}

function sampleDataFingerprint(options: ResolvedSampleDataOptions): SampleDataFingerprint {
  return {
    marker: SAMPLE_DATA_FINGERPRINT,
    batchId: options.batchId,
    generatedAt: options.generatedAt,
    generatorVersion: SAMPLE_DATA_GENERATOR_VERSION,
  };
}

export function hasSampleDataFingerprint(
  record: Pick<FeedItem | RssFeed | Person | Account, "sampleDataFingerprint"> | null | undefined,
): boolean {
  return record?.sampleDataFingerprint?.marker === SAMPLE_DATA_FINGERPRINT;
}

function rotateArray<T>(values: T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalizedOffset = ((offset % values.length) + values.length) % values.length;
  return values.slice(normalizedOffset).concat(values.slice(0, normalizedOffset));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function shuffleArray<T>(values: readonly T[], rand: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function shiftTimestamp(value: number | undefined, delta: number): number | undefined {
  return value === undefined ? undefined : value + delta;
}

function shiftSampleItemTimeline(item: FeedItem, publishedAt: number): FeedItem {
  const delta = publishedAt - item.publishedAt;
  if (delta === 0) return item;
  return {
    ...item,
    publishedAt,
    capturedAt: item.capturedAt + delta,
    priorityComputedAt: shiftTimestamp(item.priorityComputedAt, delta),
    preservedContent: item.preservedContent
      ? {
          ...item.preservedContent,
          preservedAt: item.preservedContent.preservedAt + delta,
          publishedAt: shiftTimestamp(item.preservedContent.publishedAt, delta),
        }
      : undefined,
    userState: {
      ...item.userState,
      archivedAt: shiftTimestamp(item.userState.archivedAt, delta),
      likedAt: shiftTimestamp(item.userState.likedAt, delta),
      likedSyncedAt: shiftTimestamp(item.userState.likedSyncedAt, delta),
      readAt: shiftTimestamp(item.userState.readAt, delta),
      savedAt: shiftTimestamp(item.userState.savedAt, delta),
      seenSyncedAt: shiftTimestamp(item.userState.seenSyncedAt, delta),
    },
  };
}

function visibleTimelineOrder(left: FeedItem, right: FeedItem): number {
  return right.publishedAt - left.publishedAt || left.globalId.localeCompare(right.globalId);
}

function randomizeSampleItemTimeline(
  items: readonly FeedItem[],
  presentationSeed: number,
  previousTopItemId: string | undefined,
): FeedItem[] {
  const rand = mulberry32(presentationSeed);
  const assignedTimes = new Map<string, number>();
  const buckets = [
    items.filter((item) => item.contentType === "story"),
    items.filter((item) => item.contentType !== "story"),
  ];

  for (const bucket of buckets) {
    const timestamps = bucket.map((item) => item.publishedAt).sort((left, right) => right - left);
    const characterGroups = new Map<string, FeedItem[]>();
    for (const item of bucket) {
      const group = characterGroups.get(item.author.id) ?? [];
      group.push(item);
      characterGroups.set(item.author.id, group);
    }
    const groups = shuffleArray([...characterGroups.values()], rand).map((group) =>
      group.sort((left, right) => {
        const leftSequence = Number(left.globalId.match(/:(\d+)$/)?.[1] ?? 0);
        const rightSequence = Number(right.globalId.match(/:(\d+)$/)?.[1] ?? 0);
        return rightSequence - leftSequence;
      })
    );
    const presentationOrder: FeedItem[] = [];
    for (let round = 0; groups.some((group) => round < group.length); round += 1) {
      for (const group of shuffleArray(groups.filter((candidate) => round < candidate.length), rand)) {
        presentationOrder.push(group[round]!);
      }
    }
    presentationOrder.forEach((item, index) => assignedTimes.set(item.globalId, timestamps[index]!));
  }

  let randomized = items.map((item) => {
    const publishedAt = assignedTimes.get(item.globalId);
    return publishedAt === undefined ? item : shiftSampleItemTimeline(item, publishedAt);
  });
  const visible = randomized
    .filter((item) =>
      item.contentType !== "story" &&
      !item.userState.archived &&
      !item.userState.hidden
    )
    .sort(visibleTimelineOrder);
  if (visible.length > 1 && visible[0]?.globalId === previousTopItemId) {
    const replacement = visible.find((candidate) => candidate.author.id !== visible[0]!.author.id) ?? visible[1]!;
    const previousTop = visible[0];
    const previousTopTime = previousTop.publishedAt;
    const replacementTime = replacement.publishedAt;
    randomized = randomized.map((item) => {
      if (item.globalId === previousTop.globalId) {
        return shiftSampleItemTimeline(item, replacementTime);
      }
      if (item.globalId === replacement.globalId) {
        return shiftSampleItemTimeline(item, previousTopTime);
      }
      return item;
    });
  }
  return randomized;
}

function namespaceId(batchId: string, value: string): string {
  return `${batchId}:${value}`;
}

const SOURCE_PROVIDERS = ["instagram", "x", "facebook", "linkedin", "rss"] as const;
type SampleSourceProvider = typeof SOURCE_PROVIDERS[number];
type SampleUnlinkedAccount = Account & { provider: SampleSourceProvider };

function sourceHandle(name: string, provider: SampleSourceProvider, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  if (provider === "linkedin") return `${slug}-${index}`;
  if (provider === "rss") return `${slug}.notes`;
  return `${slug}.${index}`;
}

function samplePostMedia(index: number, portrait = false): {
  asset: ReturnType<typeof sampleCorpusMedia>;
  mediaTypes: ["image"];
  mediaUrls: [string];
} {
  const asset = sampleCorpusMedia(index);
  return {
    asset,
    mediaTypes: ["image"],
    mediaUrls: [sampleCorpusMediaUrl(asset, portrait
      ? { width: 900, height: 1_350 }
      : { width: 1_440, height: 960 })],
  };
}

function sampleInstagramCaption(
  asset: ReturnType<typeof sampleCorpusMedia>,
  index: number,
): string {
  const corpusCycle = Math.floor(index / SAMPLE_CORPUS_MEDIA.length);
  const reflectionIndex = positiveModulo(
    index + corpusCycle,
    INSTAGRAM_REPEAT_REFLECTIONS.length,
  );
  return `${asset.fieldNote} ${INSTAGRAM_REPEAT_REFLECTIONS[reflectionIndex]}`;
}

function sampleInstagramPost(index: number): ReturnType<typeof samplePostMedia> & { text: string } {
  const media = samplePostMedia(index);
  return {
    ...media,
    text: sampleInstagramCaption(media.asset, index),
  };
}

function sampleNarrativePlatform(item: FeedItem): SampleCorpusPlatform {
  if (item.platform !== "rss") return item.platform as SampleCorpusPlatform;
  const feedTitle = item.rssSource?.feedTitle?.toLowerCase() ?? "";
  if (feedTitle.includes("substack")) return "substack";
  if (feedTitle.includes("medium")) return "medium";
  if (feedTitle.includes("youtube")) return "youtube";
  return "rss";
}

function sampleSourceProvider(platform: FeedItem["platform"]): SampleSourceProvider {
  return SOURCE_PROVIDERS.includes(platform as SampleSourceProvider)
    ? platform as SampleSourceProvider
    : "rss";
}

function authorEntireSampleCorpus(items: readonly FeedItem[]): FeedItem[] {
  const usedText = new Set<string>();
  const locatedAssets = SAMPLE_CORPUS_MEDIA.filter((asset) => asset.coordinates);
  const locatedItemIds = new Set(
    items
      .filter((item, index) => item.location !== undefined || index < 96)
      .map((item) => item.globalId),
  );
  const locatedItemCount = locatedItemIds.size;
  const reservedLocatedAssetIds = new Set(
    locatedAssets.slice(0, locatedItemCount).map((asset) => asset.id),
  );
  const remainingAssets = SAMPLE_CORPUS_MEDIA.filter((asset) => !reservedLocatedAssetIds.has(asset.id));
  const assetsByItemId = new Map<string, ReturnType<typeof sampleCorpusMedia>>();
  let locatedIndex = 0;
  let unlocatedIndex = 0;
  for (const item of items) {
    if (locatedItemIds.has(item.globalId) && locatedIndex < locatedAssets.length) {
      assetsByItemId.set(item.globalId, locatedAssets[locatedIndex++]!);
    } else {
      assetsByItemId.set(item.globalId, remainingAssets[unlocatedIndex++]!);
    }
  }

  return items.map((item, index) => {
    const asset = assetsByItemId.get(item.globalId) ?? sampleCorpusMedia(index);
    const platform = sampleNarrativePlatform(item);
    let variant = 0;
    let text = sampleCorpusGeneratedText(asset, platform, index, variant);
    while (usedText.has(text)) {
      variant += 1;
      text = sampleCorpusGeneratedText(asset, platform, index, variant);
    }
    usedText.add(text);
    const displayName = sampleCorpusIdentityName(asset, index);
    const portrait = item.contentType === "story";
    const displayTitle = sampleCorpusDisplayTitle(asset, platform, index);
    const mediaUrl = sampleCorpusMediaUrl(asset, portrait
      ? { width: 900, height: 1_600 }
      : { width: 1_600, height: 1_000 });
    const linkPreview = {
      ...item.content.linkPreview,
      url: sampleCorpusSourceUrl(asset),
      title: displayTitle,
      description: sampleCorpusAttribution(asset),
    };
    const preservedContent = item.preservedContent
      ? { ...item.preservedContent, text }
      : undefined;

    return {
      ...item,
      sourceUrl: sampleCorpusSourceUrl(asset),
      author: {
        ...item.author,
        displayName,
        handle: sourceHandle(displayName, sampleSourceProvider(item.platform), index),
        avatarUrl: sampleCorpusMediaUrl(asset, { width: 256, height: 256 }),
      },
      content: {
        ...item.content,
        text,
        mediaUrls: [mediaUrl],
        mediaTypes: ["image"],
        linkPreview,
      },
      ...(locatedItemIds.has(item.globalId) && asset.coordinates
        ? {
            location: {
              ...(item.location ?? { source: "text_extraction" as const }),
              name: displayTitle,
              coordinates: asset.coordinates,
            },
          }
        : {}),
      ...(preservedContent ? { preservedContent } : {}),
    };
  });
}

function buildSamplePersonDefs(options?: SampleDataOptions): SamplePersonDef[] {
  const { batchId, seed, friendCount, identitiesPerFriend } = resolveSampleDataOptions(options);

  return Array.from({ length: friendCount }, (_, rawIndex) => {
    const index = positiveModulo(rawIndex + seed, friendCount);
    const identityAsset = sampleCorpusMedia(index);
    const identityName = sampleCorpusIdentityName(identityAsset, rawIndex);
    const identitySlug = `${identityName}-${rawIndex}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const avatarUrl = sampleCorpusMediaUrl(identityAsset, { width: 256, height: 256 });
    const sources = Array.from({ length: identitiesPerFriend }, (_, sourceIndex) => {
      const provider = SOURCE_PROVIDERS[(index + sourceIndex) % SOURCE_PROVIDERS.length]!;
      const providerSlug = provider === "rss" ? "rss" : provider;
      const externalId = `${identitySlug}-${providerSlug}-${sourceIndex}`;
      const handle = sourceHandle(identityName, provider, sourceIndex);
      return {
        platform: provider,
        authorId: namespaceId(batchId, externalId),
        handle,
        displayName: provider === "rss" ? `${identityName} Field Notes` : identityName,
        avatarUrl,
      };
    });

    return {
      id: namespaceId(batchId, `sample-friend-${identitySlug}`),
      name: identityName,
      careLevel: sampleCareLevel(rawIndex, friendCount),
      bio: sampleCorpusIdentityBio(identityAsset),
      avatarUrl,
      ...(rawIndex < sampleInnerCircleCount(friendCount)
        ? { notes: "Inner circle. The person you call when the tide turns, the cave narrows, or the mantis looks judgmental." }
        : {}),
      sources,
    };
  });
}

function sampleInnerCircleCount(friendCount: number): number {
  return Math.min(friendCount, Math.max(5, Math.min(10, Math.round(friendCount * 0.05))));
}

function sampleCareLevel(index: number, friendCount: number): Person["careLevel"] {
  const innerCircleCount = sampleInnerCircleCount(friendCount);
  const closeCircleEnd = Math.max(innerCircleCount, Math.round(friendCount * 0.18));
  const trustedCircleEnd = Math.max(closeCircleEnd, Math.round(friendCount * 0.52));
  if (index < innerCircleCount) return 5;
  if (index < closeCircleEnd) return 4;
  if (index < trustedCircleEnd) return 3;
  return index % 4 === 0 ? 1 : 2;
}

function unlinkedIdentityCount(options: ResolvedSampleDataOptions): number {
  const linkedIdentityCount = options.friendCount * options.identitiesPerFriend;
  return linkedIdentityCount > 0
    ? Math.max(1, Math.round(linkedIdentityCount * options.unlinkedIdentityRatio))
    : 0;
}

function buildSampleUnlinkedAccounts(options: ResolvedSampleDataOptions): SampleUnlinkedAccount[] {
  const fingerprint = sampleDataFingerprint(options);
  const count = unlinkedIdentityCount(options);

  return Array.from({ length: count }, (_, index) => {
    const provider = SOURCE_PROVIDERS[positiveModulo(options.seed + index, SOURCE_PROVIDERS.length)]!;
    const identityAsset = sampleCorpusMedia(options.friendCount + index);
    const displayName = sampleCorpusIdentityName(identityAsset, options.friendCount + index);
    const externalId = namespaceId(options.batchId, `sample-unlinked-${provider}-${index}`);
    const handle = sourceHandle(displayName, provider, index);
    const seenAt = options.generatedAt - index * DAY;

    return {
      id: `social:${provider}:${externalId}`,
      kind: "social",
      provider,
      externalId,
      handle,
      displayName: provider === "rss" ? `${displayName} Field Notes` : displayName,
      avatarUrl: sampleCorpusMediaUrl(identityAsset, { width: 256, height: 256 }),
      sampleDataFingerprint: fingerprint,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      discoveredFrom: "captured_item",
      createdAt: seenAt,
      updatedAt: seenAt,
    };
  });
}

// ── Generators ──────────────────────────────────────────────────────────────

const SAMPLE_FEED_URL_PREFIX = "https://sample.freed.wtf/";

/**
 * Generate 15 sample RSS feed subscriptions.
 *
 * All URLs use the `sample.freed.wtf` prefix so they can never
 * collide with real feeds or trigger network fetches.
 */
export function generateSampleFeeds(options?: SampleDataOptions): RssFeed[] {
  const resolvedOptions = resolveSampleDataOptions(options);
  const { batchId, seed } = resolvedOptions;
  const fingerprint = sampleDataFingerprint(resolvedOptions);
  const batchLabel = batchId.slice(-4).toUpperCase();
  return rotateArray(FEED_DEFS, seed % FEED_DEFS.length).map((def) => ({
    url: `${SAMPLE_FEED_URL_PREFIX}${batchId}/${def.slug}`,
    title: `${def.title} (Sample ${batchLabel})`,
    siteUrl: def.siteUrl,
    enabled: true,
    trackUnread: true,
    folder: `Sample Feeds ${batchLabel}`,
    sampleDataFingerprint: fingerprint,
  }));
}

function generateSamplePeopleGraph(
  resolvedOptions: ResolvedSampleDataOptions,
): Readonly<{ accounts: Account[]; persons: Person[] }> {
  const { seed } = resolvedOptions;
  const fingerprint = sampleDataFingerprint(resolvedOptions);
  const samplePersonDefs = buildSamplePersonDefs(resolvedOptions);
  const now = resolvedOptions.generatedAt;
  const persons = samplePersonDefs.map((person, index) => ({
    id: person.id,
    name: person.name,
    relationshipStatus: "friend",
    careLevel: person.careLevel,
    bio: person.bio,
    avatarUrl: person.avatarUrl,
    ...(person.notes ? { notes: person.notes } : {}),
    tags: ["sample", "social"],
    sampleDataFingerprint: fingerprint,
    createdAt: now - (index + 1) * 7 * DAY - (seed % DAY),
    updatedAt: now - index * DAY,
  })) satisfies Person[];
  const linkedAccounts: Account[] = samplePersonDefs.flatMap((person, index) =>
    person.sources.map((source) => ({
      id: `social:${source.platform}:${source.authorId}`,
      personId: person.id,
      kind: "social" as const,
      provider: source.platform,
      externalId: source.authorId,
      handle: source.handle,
      displayName: source.displayName,
      avatarUrl: source.avatarUrl,
      sampleDataFingerprint: fingerprint,
      firstSeenAt: persons[index]!.createdAt,
      lastSeenAt: persons[index]!.updatedAt,
      discoveredFrom: "captured_item" as const,
      createdAt: persons[index]!.createdAt,
      updatedAt: persons[index]!.updatedAt,
    })),
  );
  return {
    accounts: linkedAccounts.concat(buildSampleUnlinkedAccounts(resolvedOptions)),
    persons,
  };
}

export function generateSampleAccounts(options?: SampleDataOptions): Account[] {
  return generateSamplePeopleGraph(resolveSampleDataOptions(options)).accounts;
}

export interface SampleLibraryData {
  feeds: RssFeed[];
  items: FeedItem[];
  persons: Person[];
  accounts: Account[];
}

export function generateSampleLibraryData(options?: SampleDataOptions): SampleLibraryData {
  const resolvedOptions = resolveSampleDataOptions(options);
  const people = generateSamplePeopleGraph(resolvedOptions);
  return {
    feeds: generateSampleFeeds(resolvedOptions),
    items: generateSampleItems(resolvedOptions),
    persons: people.persons,
    accounts: people.accounts,
  };
}

/**
 * Generate showcase sample feed items: 120 RSS articles (8 per feed) +
 * 20 saved bookmarks + 10 X posts + 10 Facebook posts + 10 Instagram posts +
 * 10 LinkedIn posts + 8 Instagram stories + 7 Facebook stories, six
 * location time-window items, and one item per social identity.
 *
 * Stories use contentType:"story", portrait corpus images, and are spread
 * across the last 22 hours (reflecting the ephemeral nature of real stories).
 * Items are spread across the last 14 days with varied user states (read,
 * saved, archived) to exercise all UI views. All IDs are deterministic so
 * repeated calls are idempotent against normalized SQLite identity constraints.
 */
export function generateSampleItems(options?: SampleDataOptions): FeedItem[] {
  const resolvedOptions = resolveSampleDataOptions(options);
  const { batchId, seed } = resolvedOptions;
  const fingerprint = sampleDataFingerprint(resolvedOptions);
  const rand = mulberry32(seed);
  const now = resolvedOptions.generatedAt;
  const items: FeedItem[] = [];
  const sampleFriendDefs = buildSamplePersonDefs(resolvedOptions);
  const sampleUnlinkedAccounts = buildSampleUnlinkedAccounts(resolvedOptions);
  const feedDefs = rotateArray(FEED_DEFS, seed % FEED_DEFS.length);
  const corpusHeadlines = SAMPLE_CORPUS_MEDIA.map((asset) => asset.fieldNote);
  const rssHeadlinePool = corpusHeadlines.length > 0 ? corpusHeadlines : RSS_HEADLINES;
  const rssHeadlines = rotateArray(rssHeadlinePool, seed % rssHeadlinePool.length);
  const savedHeadlines = rotateArray(SAVED_HEADLINES, seed % SAVED_HEADLINES.length);
  const savedDomains = rotateArray(SAVED_DOMAINS, seed % SAVED_DOMAINS.length);
  const xAuthors = rotateArray(X_AUTHORS, seed % X_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const facebookAuthors = rotateArray(FACEBOOK_AUTHORS, seed % FACEBOOK_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const instagramAuthors = rotateArray(INSTAGRAM_AUTHORS, seed % INSTAGRAM_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const linkedInAuthors = rotateArray(LINKEDIN_AUTHORS, seed % LINKEDIN_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const igStoryAuthors = rotateArray(IG_STORY_AUTHORS, seed % IG_STORY_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const fbStoryAuthors = rotateArray(FB_STORY_AUTHORS, seed % FB_STORY_AUTHORS.length).map((author) => ({
    ...author,
    id: namespaceId(batchId, author.id),
  }));
  const locatedCorpusMedia = SAMPLE_CORPUS_MEDIA.filter((asset) => asset.placeId);
  let instagramPostIndex = 0;
  const locationWindows = rotateArray(
    [
      {
        platform: "instagram" as const,
        locationSource: "geo_tag" as const,
        startOffset: -9 * DAY,
        endOffset: -7 * DAY,
        kind: "travel" as const,
      },
      {
        platform: "facebook" as const,
        locationSource: "check_in" as const,
        startOffset: -3 * DAY,
        endOffset: 2 * DAY,
        kind: "overlap" as const,
      },
      {
        platform: "linkedin" as const,
        locationSource: "text_extraction" as const,
        startOffset: 2 * DAY,
        endOffset: 4 * DAY,
        kind: "event" as const,
      },
      {
        platform: "x" as const,
        locationSource: "text_extraction" as const,
        startOffset: 8 * DAY,
        endOffset: 12 * DAY,
        kind: "travel" as const,
      },
      {
        platform: "instagram" as const,
        locationSource: "geo_tag" as const,
        startOffset: 18 * DAY,
        endOffset: 22 * DAY,
        kind: "travel" as const,
      },
      {
        platform: "facebook" as const,
        locationSource: "check_in" as const,
        startOffset: 36 * DAY,
        endOffset: 41 * DAY,
        kind: "travel" as const,
      },
    ],
    seed % SAMPLE_LOCATION_WINDOW_ITEM_COUNT,
  );

  // 120 RSS articles: 8 per feed
  for (let fi = 0; fi < feedDefs.length; fi++) {
    const feed = feedDefs[fi];
    const feedUrl = `${SAMPLE_FEED_URL_PREFIX}${batchId}/${feed.slug}`;
    for (let ai = 0; ai < 8; ai++) {
      const idx = fi * 8 + ai;
      const age = (idx / 80) * 14 * DAY + rand() * DAY;
      const publishedAt = Math.round(now - age);
      const r = rand();
      const isSaved = r > 0.85;
      // Saved items can never be archived -- the ranges don't overlap here
      // anyway (>0.85 vs <0.1), but guard explicitly to enforce the invariant.
      const isArchived = !isSaved && r < 0.1;
      const media = idx % 3 === 0 ? samplePostMedia(idx) : null;

      items.push({
        globalId: namespaceId(batchId, `sample-rss:${feed.slug}:${ai}`),
        platform: "rss",
        contentType: "article",
        capturedAt: publishedAt + 60_000,
        publishedAt,
        ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
        author: {
          id: namespaceId(batchId, `sample-${feed.slug}`),
          handle: feed.slug,
          displayName: feed.title,
        },
        content: {
          text: media?.asset.fieldNote ?? rssHeadlines[idx % rssHeadlines.length],
          mediaUrls: media?.mediaUrls ?? [],
          mediaTypes: media?.mediaTypes ?? [],
        },
        rssSource: {
          feedUrl,
          feedTitle: `${feed.title} (Sample ${batchId.slice(-4).toUpperCase()})`,
          siteUrl: feed.siteUrl,
        },
        userState: {
          hidden: false,
          saved: isSaved,
          savedAt: isSaved ? publishedAt + 120_000 : undefined,
          archived: isArchived,
          archivedAt: isArchived ? publishedAt + 300_000 : undefined,
          readAt: r < 0.3 ? publishedAt + 90_000 : undefined,
          tags: [],
        },
        topics: pickTopics(rand, idx),
      });
    }
  }

  // 20 saved bookmarks -- always saved, never archived (saved wins).
  for (let si = 0; si < 20; si++) {
    const age = (si / 20) * 14 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const domain = savedDomains[si % savedDomains.length];
    const r = rand();
    const wordCount = 800 + Math.round(rand() * 3200);
    const media = si % 2 === 0 ? samplePostMedia(16 + si) : null;
    const articleText = media?.asset.fieldNote ?? savedHeadlines[si % savedHeadlines.length];

    items.push({
      globalId: namespaceId(batchId, `sample-saved:${si}`),
      platform: "saved",
      contentType: "article",
      capturedAt: publishedAt + 30_000,
      publishedAt,
      ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
      author: {
        id: namespaceId(batchId, `sample-saved-author-${si}`),
        handle: domain,
        displayName: domain.split(".")[0],
      },
      content: {
        text: articleText,
        mediaUrls: media?.mediaUrls ?? [],
        mediaTypes: media?.mediaTypes ?? [],
        linkPreview: {
          url: `https://${domain}/sample-article-${batchId}-${si}`,
          title: articleText,
        },
      },
      preservedContent: {
        text: articleText,
        wordCount,
        readingTime: Math.ceil(wordCount / 250),
        preservedAt: publishedAt + 60_000,
      },
      userState: {
        hidden: false,
        saved: true,
        savedAt: publishedAt + 30_000,
        archived: false,
        archivedAt: undefined,
        readAt: r < 0.4 ? publishedAt + 120_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 80 + si),
    });
  }

  // 10 X posts
  for (let xi = 0; xi < 10; xi++) {
    const age = (xi / 10) * 7 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const r = rand();
    const author = xAuthors[xi % xAuthors.length];
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;
    const media = xi % 2 === 0 ? samplePostMedia(24 + xi) : null;
    const mediaPlace = sampleCorpusPlace(media?.asset.placeId);

    items.push({
      globalId: namespaceId(batchId, `sample-x:${xi}`),
      platform: "x",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
      author,
      content: {
        text: media?.asset.fieldNote ?? X_POSTS[xi % X_POSTS.length],
        mediaUrls: media?.mediaUrls ?? [],
        mediaTypes: media?.mediaTypes ?? [],
      },
      engagement: {
        likes: Math.round(rand() * 2000),
        reposts: Math.round(rand() * 400),
        comments: Math.round(rand() * 150),
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "text_extraction",
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: isSaved,
        savedAt: isSaved ? publishedAt + 10_000 : undefined,
        archived: isArchived,
        archivedAt: isArchived ? publishedAt + 60_000 : undefined,
        readAt: r < 0.5 ? publishedAt + 8_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 100 + xi),
    });
  }

  // 10 Facebook posts
  for (let fi = 0; fi < 10; fi++) {
    const age = (fi / 10) * 7 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const r = rand();
    const author = facebookAuthors[fi % facebookAuthors.length];
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;
    const media = fi % 2 === 0 ? samplePostMedia(32 + fi) : null;
    const mediaPlace = sampleCorpusPlace(media?.asset.placeId);

    items.push({
      globalId: namespaceId(batchId, `sample-facebook:${fi}`),
      platform: "facebook",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
      author,
      content: {
        text: media?.asset.fieldNote ?? FACEBOOK_POSTS[fi % FACEBOOK_POSTS.length],
        mediaUrls: media?.mediaUrls ?? [],
        mediaTypes: media?.mediaTypes ?? [],
      },
      engagement: {
        likes: Math.round(rand() * 800),
        comments: Math.round(rand() * 60),
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "check_in",
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: isSaved,
        savedAt: isSaved ? publishedAt + 10_000 : undefined,
        archived: isArchived,
        archivedAt: isArchived ? publishedAt + 60_000 : undefined,
        readAt: r < 0.5 ? publishedAt + 8_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 110 + fi),
    });
  }

  // 10 Instagram posts
  for (let ii = 0; ii < 10; ii++) {
    const age = (ii / 10) * 7 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const r = rand();
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;

    const author = instagramAuthors[ii % instagramAuthors.length];
    const media = sampleInstagramPost(instagramPostIndex++);
    const mediaPlace = sampleCorpusPlace(media.asset.placeId);
    items.push({
      globalId: namespaceId(batchId, `sample-instagram:${ii}`),
      platform: "instagram",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      sourceUrl: sampleCorpusSourceUrl(media.asset),
      author,
      content: {
        text: media.text,
        mediaUrls: media.mediaUrls,
        mediaTypes: media.mediaTypes,
      },
      engagement: {
        likes: Math.round(rand() * 1500),
        comments: Math.round(rand() * 80),
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "geo_tag",
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: isSaved,
        savedAt: isSaved ? publishedAt + 10_000 : undefined,
        archived: isArchived,
        archivedAt: isArchived ? publishedAt + 60_000 : undefined,
        readAt: r < 0.5 ? publishedAt + 8_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 120 + ii),
    });
  }

  // 10 LinkedIn posts
  for (let li = 0; li < 10; li++) {
    const age = (li / 10) * 7 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const r = rand();
    const isSaved = r > 0.88;
    const isArchived = !isSaved && r < 0.08;
    const author = linkedInAuthors[li % linkedInAuthors.length];
    const media = li % 2 === 0 ? samplePostMedia(40 + li) : null;
    const mediaPlace = sampleCorpusPlace(media?.asset.placeId);

    items.push({
      globalId: namespaceId(batchId, `sample-linkedin:${li}`),
      platform: "linkedin",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
      author,
      content: {
        text: media?.asset.fieldNote ?? LINKEDIN_POSTS[li % LINKEDIN_POSTS.length],
        mediaUrls: media?.mediaUrls ?? [],
        mediaTypes: media?.mediaTypes ?? [],
      },
      engagement: {
        likes: Math.round(rand() * 1_800),
        comments: Math.round(rand() * 120),
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "text_extraction",
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: isSaved,
        savedAt: isSaved ? publishedAt + 10_000 : undefined,
        archived: isArchived,
        archivedAt: isArchived ? publishedAt + 60_000 : undefined,
        readAt: r < 0.55 ? publishedAt + 8_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 130 + li),
    });
  }

  // 8 Instagram stories, ephemeral and spread over the last 22 hours.
  for (let si = 0; si < 8; si++) {
    const age = (si / 8) * 22 * HOUR + rand() * HOUR;
    const publishedAt = Math.round(now - age);
    const author = igStoryAuthors[si % igStoryAuthors.length];
    const media = samplePostMedia(8 + si, true);
    const mediaPlace = sampleCorpusPlace(media.asset.placeId);

    items.push({
      globalId: namespaceId(batchId, `sample-ig-story:${si}`),
      platform: "instagram",
      contentType: "story",
      capturedAt: publishedAt + 2_000,
      publishedAt,
      sourceUrl: sampleCorpusSourceUrl(media.asset),
      author,
      content: {
        text: media.asset.fieldNote,
        mediaUrls: media.mediaUrls,
        mediaTypes: media.mediaTypes,
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "sticker" as const,
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: pickTopics(rand, 140 + si),
    });
  }

  // 7 Facebook stories — same ephemeral window.
  for (let si = 0; si < 7; si++) {
    const age = (si / 7) * 22 * HOUR + rand() * HOUR;
    const publishedAt = Math.round(now - age);
    const author = fbStoryAuthors[si % fbStoryAuthors.length];
    const media = samplePostMedia(16 + si, true);
    const mediaPlace = sampleCorpusPlace(media.asset.placeId);

    items.push({
      globalId: namespaceId(batchId, `sample-fb-story:${si}`),
      platform: "facebook",
      contentType: "story",
      capturedAt: publishedAt + 2_000,
      publishedAt,
      sourceUrl: sampleCorpusSourceUrl(media.asset),
      author,
      content: {
        text: media.asset.fieldNote,
        mediaUrls: media.mediaUrls,
        mediaTypes: media.mediaTypes,
      },
      ...(mediaPlace
        ? {
            location: {
              name: mediaPlace.name,
              coordinates: mediaPlace.coordinates,
              source: "check_in" as const,
            },
          }
        : {}),
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: pickTopics(rand, 148 + si),
    });
  }

  for (let wi = 0; wi < locationWindows.length; wi++) {
    const windowDef = locationWindows[wi];
    const friend = sampleFriendDefs[wi % sampleFriendDefs.length];
    if (!friend) continue;
    const source =
      friend.sources.find((candidate) => candidate.platform === windowDef.platform) ??
      friend.sources.find((candidate) => candidate.platform !== "rss") ??
      friend.sources[0];
    if (!source) continue;
    const startsAt = Math.round(now + windowDef.startOffset);
    const endsAt = Math.round(now + windowDef.endOffset);
    const publishedAt = Math.round(Math.min(now - (wi + 1) * HOUR, startsAt - HOUR));
    const locatedAsset = locatedCorpusMedia[wi % locatedCorpusMedia.length]!;
    const media = samplePostMedia(SAMPLE_CORPUS_MEDIA.indexOf(locatedAsset));
    const mediaPlace = sampleCorpusPlace(locatedAsset.placeId)!;

    items.push({
      globalId: namespaceId(batchId, `sample-location-window:${wi}`),
      platform: source.platform,
      contentType: source.platform === "rss" ? "article" : "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      sourceUrl: sampleCorpusSourceUrl(media.asset),
      author: {
        id: source.authorId,
        handle: source.handle ?? source.authorId,
        displayName: source.displayName ?? source.handle ?? friend.name,
        avatarUrl: source.avatarUrl,
      },
      content: {
        text: source.platform === "instagram"
          ? `${sampleInstagramCaption(media.asset, instagramPostIndex++)} Field note from ${mediaPlace.name}.`
          : media.asset.fieldNote,
        mediaUrls: media.mediaUrls,
        mediaTypes: media.mediaTypes,
      },
      ...(source.platform === "rss"
        ? {
            rssSource: {
              feedUrl: `${SAMPLE_FEED_URL_PREFIX}${batchId}/people/${source.authorId}`,
              feedTitle: source.displayName ?? source.handle ?? friend.name,
              siteUrl: "https://sample.freed.wtf",
            },
          }
        : {}),
      location: {
        name: mediaPlace.name,
        coordinates: mediaPlace.coordinates,
        source: windowDef.locationSource,
      },
      timeRange: {
        startsAt,
        endsAt,
        kind: windowDef.kind,
      },
      engagement: source.platform === "rss"
        ? undefined
        : {
            likes: Math.round(90 + rand() * 1_400),
            comments: Math.round(8 + rand() * 160),
          },
      userState: {
        hidden: false,
        saved: wi % 3 === 0,
        archived: false,
        tags: [],
      },
      topics: pickTopics(rand, 155 + wi),
    });
  }

  let graphItemIndex = 0;
  for (const friend of sampleFriendDefs) {
    for (const source of friend.sources) {
      const age = ((graphItemIndex % 90) / 90) * 21 * DAY + rand() * DAY;
      const publishedAt = Math.round(now - age);
      const contentType = source.platform === "rss" ? "article" : "post";
      const instagramPost = source.platform === "instagram"
        ? sampleInstagramPost(instagramPostIndex++)
        : null;
      const media = instagramPost ?? (graphItemIndex % 4 === 0 ? samplePostMedia(graphItemIndex) : null);
      const text = instagramPost?.text ?? media?.asset.fieldNote ?? (
        source.platform === "linkedin"
          ? LINKEDIN_POSTS[graphItemIndex % LINKEDIN_POSTS.length]
          : source.platform === "instagram"
            ? INSTAGRAM_POSTS[graphItemIndex % INSTAGRAM_POSTS.length]
            : source.platform === "facebook"
              ? FACEBOOK_POSTS[graphItemIndex % FACEBOOK_POSTS.length]
              : source.platform === "rss"
                ? rssHeadlines[graphItemIndex % rssHeadlines.length]
                : X_POSTS[graphItemIndex % X_POSTS.length]
      );
      items.push({
        globalId: namespaceId(batchId, `sample-graph:${source.platform}:${graphItemIndex}`),
        platform: source.platform,
        contentType,
        capturedAt: publishedAt + 5_000,
        publishedAt,
        ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
        author: {
          id: source.authorId,
          handle: source.handle ?? source.authorId,
          displayName: source.displayName ?? source.handle ?? friend.name,
          avatarUrl: source.avatarUrl,
        },
        content: {
          text,
          mediaUrls: media?.mediaUrls ?? [],
          mediaTypes: media?.mediaTypes ?? [],
        },
        ...(source.platform === "rss"
          ? {
              rssSource: {
                feedUrl: `${SAMPLE_FEED_URL_PREFIX}${batchId}/people/${source.authorId}`,
                feedTitle: source.displayName ?? source.handle ?? friend.name,
                siteUrl: "https://sample.freed.wtf",
              },
            }
          : {}),
        engagement: source.platform === "rss"
          ? undefined
          : {
              likes: Math.round(rand() * 1_200),
              comments: Math.round(rand() * 90),
            },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          readAt: graphItemIndex % 3 === 0 ? publishedAt + 12_000 : undefined,
          tags: [],
        },
        topics: pickTopics(rand, 160 + graphItemIndex),
      });
      graphItemIndex += 1;
    }
  }

  for (const account of sampleUnlinkedAccounts) {
    const age = ((graphItemIndex % 90) / 90) * 21 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const contentType = account.provider === "rss" ? "article" : "post";
    const instagramPost = account.provider === "instagram"
      ? sampleInstagramPost(instagramPostIndex++)
      : null;
    const media = instagramPost ?? (graphItemIndex % 4 === 0 ? samplePostMedia(graphItemIndex) : null);
    const text = instagramPost?.text ?? media?.asset.fieldNote ?? (
      account.provider === "linkedin"
        ? LINKEDIN_POSTS[graphItemIndex % LINKEDIN_POSTS.length]
        : account.provider === "instagram"
          ? INSTAGRAM_POSTS[graphItemIndex % INSTAGRAM_POSTS.length]
          : account.provider === "facebook"
            ? FACEBOOK_POSTS[graphItemIndex % FACEBOOK_POSTS.length]
            : account.provider === "rss"
              ? rssHeadlines[graphItemIndex % rssHeadlines.length]
              : X_POSTS[graphItemIndex % X_POSTS.length]
    );

    items.push({
      globalId: namespaceId(batchId, `sample-unlinked-graph:${account.provider}:${graphItemIndex}`),
      platform: account.provider,
      contentType,
      capturedAt: publishedAt + 5_000,
      publishedAt,
      ...(media ? { sourceUrl: sampleCorpusSourceUrl(media.asset) } : {}),
      author: {
        id: account.externalId,
        handle: account.handle ?? account.externalId,
        displayName: account.displayName ?? account.handle ?? account.externalId,
        avatarUrl: account.avatarUrl,
      },
      content: {
        text,
        mediaUrls: media?.mediaUrls ?? [],
        mediaTypes: media?.mediaTypes ?? [],
      },
      ...(account.provider === "rss"
        ? {
            rssSource: {
              feedUrl: `${SAMPLE_FEED_URL_PREFIX}${resolvedOptions.batchId}/unlinked/${account.externalId}`,
              feedTitle: account.displayName ?? account.handle ?? account.externalId,
              siteUrl: "https://sample.freed.wtf",
            },
          }
        : {}),
      engagement: account.provider === "rss"
        ? undefined
        : {
            likes: Math.round(rand() * 1_200),
            comments: Math.round(rand() * 90),
          },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        readAt: graphItemIndex % 3 === 0 ? publishedAt + 12_000 : undefined,
        tags: [],
      },
      topics: pickTopics(rand, 160 + graphItemIndex),
    });
    graphItemIndex += 1;
  }

  const authoredItems = authorEntireSampleCorpus(items).map((item) => ({
    ...item,
    sampleDataFingerprint: fingerprint,
  }));
  return resolvedOptions.presentationSeed === undefined
    ? authoredItems
    : randomizeSampleItemTimeline(
        authoredItems,
        resolvedOptions.presentationSeed,
        resolvedOptions.previousTopItemId,
      );
}

/** Pick 1-3 topics deterministically for a given item index. */
function pickTopics(rand: () => number, idx: number): string[] {
  const count = 1 + Math.floor(rand() * 3);
  const start = idx % TOPICS.length;
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(TOPICS[(start + i) % TOPICS.length]);
  }
  return result;
}
