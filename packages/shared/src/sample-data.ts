/**
 * Sample data generator for regression testing.
 *
 * Produces a showcase-scale local library with deterministic IDs so
 * repeated calls are idempotent
 * against the existing duplicate guard in Automerge mutations.
 *
 * All feed URLs use the `https://sample.freed.wtf/` prefix to avoid
 * colliding with real subscriptions and to prevent actual fetch attempts.
 */

import type { FeedItem, Friend, RssFeed } from "./types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── Feed definitions ────────────────────────────────────────────────────────

interface FeedDef {
  slug: string;
  title: string;
  siteUrl: string;
}

const FEED_DEFS: FeedDef[] = [
  { slug: "hacker-news", title: "Hacker News", siteUrl: "https://news.ycombinator.com" },
  { slug: "ars-technica", title: "Ars Technica", siteUrl: "https://arstechnica.com" },
  { slug: "the-verge", title: "The Verge", siteUrl: "https://theverge.com" },
  { slug: "techcrunch", title: "TechCrunch", siteUrl: "https://techcrunch.com" },
  { slug: "wired", title: "Wired", siteUrl: "https://wired.com" },
  { slug: "daring-fireball", title: "Daring Fireball", siteUrl: "https://daringfireball.net" },
  { slug: "kottke", title: "Kottke.org", siteUrl: "https://kottke.org" },
  { slug: "the-marginalian", title: "The Marginalian", siteUrl: "https://themarginalian.org" },
  { slug: "lwn", title: "LWN.net", siteUrl: "https://lwn.net" },
  { slug: "xkcd", title: "xkcd", siteUrl: "https://xkcd.com" },
  { slug: "stratechery", title: "Stratechery", siteUrl: "https://stratechery.com" },
  { slug: "ben-evans", title: "Ben Evans", siteUrl: "https://www.ben-evans.com" },
  { slug: "404-media", title: "404 Media", siteUrl: "https://www.404media.co" },
  { slug: "platformer", title: "Platformer", siteUrl: "https://www.platformer.news" },
  { slug: "rest-of-world", title: "Rest of World", siteUrl: "https://restofworld.org" },
];

// ── Topic + headline pools ──────────────────────────────────────────────────

const TOPICS = [
  "technology", "science", "programming", "design", "security",
  "ai", "open-source", "privacy", "web", "culture",
  "hardware", "networking", "databases", "mobile", "devops",
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
  "How to build a reading habit that sticks",
  "The best ergonomic keyboard setups for programmers",
  "A beginner's guide to indoor climbing",
  "Understanding your credit score in plain English",
  "The 20 best science fiction novels of the last decade",
  "How to set up a home espresso station on a budget",
  "Trail running gear guide for your first ultramarathon",
  "Learning to cook Thai food from a Bangkok street vendor",
  "A visual guide to knot tying for camping",
  "How to negotiate a raise without making it awkward",
  "The best free resources for learning music theory",
  "Minimalist packing for a two-week trip",
  "Understanding wine labels: a no-nonsense primer",
  "A complete guide to maintaining a bicycle at home",
  "How journaling changed my relationship with anxiety",
  "The surprisingly rich history of board game design",
  "Practical tips for reducing screen time without FOMO",
  "How to read a topographic map",
  "Building a small workshop in a one-car garage",
  "Choosing the right houseplants for low-light apartments",
];

const SAVED_DOMAINS = [
  "medium.com", "longreads.com", "nautil.us", "aeon.co", "lithub.com",
  "outsideonline.com", "seriouseats.com", "wirecutter.com", "putnam.blog",
  "thekitchn.com", "runnersworld.com", "gearjunkie.com", "theverge.com",
  "notion.so", "every.to", "worksinprogress.co", "restofworld.org",
  "atlasobscura.com", "makersguide.io", "indoorgardens.net",
];

// ── Social post pools ────────────────────────────────────────────────────────

const X_POSTS: string[] = [
  "Hot take: the best documentation is the kind that fits in a tweet. Prove me wrong.",
  "Spent the morning reading CRDT papers. My brain is now a conflict-free replicated data type.",
  "The best debugging tool is still a good night's sleep. Change my mind.",
  "Local-first software isn't just a pattern. It's a philosophy about who owns your data.",
  "Reminder that `git blame` is a feature, not a slur.",
  "Every abstraction is a lie we agree to believe for long enough to ship.",
  "The real LLM alignment problem is getting it to stop explaining what a hash map is.",
  "Compilers are just very confident editors with zero social skills.",
  "New blog post: why I rewrote my side project in six languages and learned nothing.",
  "Unpopular opinion: the README is the product. Everything else is implementation detail.",
];

const X_AUTHORS = [
  { id: "sample-x-1", handle: "@devposts", displayName: "Dev Posts" },
  { id: "sample-x-2", handle: "@nullpointer", displayName: "Null Pointer" },
  { id: "sample-x-3", handle: "@bytewatcher", displayName: "Byte Watcher" },
  { id: "sample-x-4", handle: "@tessellated", displayName: "Tess Ellated" },
  { id: "sample-x-5", handle: "@orbitmanual", displayName: "Orbit Manual" },
];

const FACEBOOK_POSTS: string[] = [
  "Just shipped a feature I've been sitting on for three weeks. Feels good. Grabbed a coffee to celebrate.",
  "Does anyone else get unreasonably excited when a PR comes back with zero comments?",
  "Reminder: your coworkers are not trying to frustrate you. They just have different context than you do.",
  "Took a long walk today. Came back with the solution to a bug I've been fighting for two days.",
  "Hot desk tip: find the chair with the best lumbar support and defend it with your life.",
  "Running retrospectives is basically group therapy for people who refuse to go to therapy.",
  "Anyone else have a folder called 'temp' that's been around since 2019?",
  "Finished the book. Would recommend. No spoilers but: the architecture holds.",
  "Our standup ran exactly 12 minutes today. A personal record.",
  "The sprint ended. No one died. Ship it.",
];

const FACEBOOK_AUTHORS = [
  { id: "sample-fb-1", handle: "Engineering Thoughts", displayName: "Engineering Thoughts" },
  { id: "sample-fb-2", handle: "The Dev Desk", displayName: "The Dev Desk" },
  { id: "sample-fb-3", handle: "Ship It Culture", displayName: "Ship It Culture" },
  { id: "sample-fb-4", handle: "Night Shift Notes", displayName: "Night Shift Notes" },
  { id: "sample-fb-5", handle: "Field Notes Lab", displayName: "Field Notes Lab" },
];

const INSTAGRAM_POSTS: string[] = [
  "Morning light, cold brew, and a diff that's finally green ☀️",
  "The office at 7am hits different. Nobody here yet. Just me and the compiler.",
  "Mechanical keyboard + good headphones = flow state in 3 minutes flat.",
  "Whiteboard session went long but the diagram finally makes sense.",
  "Setup tour coming soon. Spoiler: it's mostly cables.",
  "Found a two-line fix for a week-old bug. Framing this diff.",
  "First deploy of the week. Clean. Fast. Going back to bed.",
  "Documenting is an act of kindness for your future self.",
  "Pair programming session: we argued for 40 minutes and then agreed I was right.",
  "New desk plant. It will outlive this codebase.",
];

const INSTAGRAM_AUTHORS = [
  { id: "sample-ig-1", handle: "@freed.desk", displayName: "Freed Desk" },
  { id: "sample-ig-2", handle: "@circuit.garden", displayName: "Circuit Garden" },
  { id: "sample-ig-3", handle: "@midnight.sprint", displayName: "Midnight Sprint" },
  { id: "sample-ig-4", handle: "@between.trains", displayName: "Between Trains" },
  { id: "sample-ig-5", handle: "@analog.workspace", displayName: "Analog Workspace" },
];

const LINKEDIN_POSTS: string[] = [
  "Wrapped a customer research sprint with three clear product bets. The boring answer was the right answer.",
  "A calm ops week is still a win. Stability is a feature, not an absence of ambition.",
  "Hiring note: the best collaborators leave documents better than they found them.",
  "Spent today turning a heroic workaround into a repeatable process. Much less cinematic, much more useful.",
  "Presented the roadmap without twenty backup slides. Miraculously, everyone survived.",
  "Quietly proud of the release notes this week. Clear writing saves real support time.",
  "Visited a client team on-site and learned more in one hallway conversation than in six dashboards.",
  "Product lesson of the month: if users export it every week, they probably want it on the main screen.",
  "Closed the loop on a pilot program today. Small, steady adoption beats loud vanity metrics.",
  "Teams move faster when status updates sound like people talking to each other instead of investor karaoke.",
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
  { id: "sample-ig-sa-1", handle: "@maya.films", displayName: "Maya Films" },
  { id: "sample-ig-sa-2", handle: "@lunchbreak.eats", displayName: "Lunchbreak Eats" },
  { id: "sample-ig-sa-3", handle: "@the.alpine.life", displayName: "The Alpine Life" },
  { id: "sample-ig-sa-4", handle: "@neon.workshop", displayName: "Neon Workshop" },
  { id: "sample-ig-sa-5", handle: "@skyline.daily", displayName: "Skyline Daily" },
  { id: "sample-ig-sa-6", handle: "@quiet.kitchen", displayName: "Quiet Kitchen" },
  { id: "sample-ig-sa-7", handle: "@trailhead.co", displayName: "Trailhead Co" },
  { id: "sample-ig-sa-8", handle: "@desksetup.wtf", displayName: "Desk Setup WTF" },
];

const FB_STORY_AUTHORS = [
  { id: "sample-fb-sa-1", handle: "City Cycling Co.", displayName: "City Cycling Co." },
  { id: "sample-fb-sa-2", handle: "Weekend Escapes", displayName: "Weekend Escapes" },
  { id: "sample-fb-sa-3", handle: "Foodie Finds", displayName: "Foodie Finds" },
  { id: "sample-fb-sa-4", handle: "Maker Collective", displayName: "Maker Collective" },
  { id: "sample-fb-sa-5", handle: "Morning Commute", displayName: "Morning Commute" },
  { id: "sample-fb-sa-6", handle: "Backyard Builds", displayName: "Backyard Builds" },
  { id: "sample-fb-sa-7", handle: "The Late Shift", displayName: "The Late Shift" },
];

// Short captions for stories — most are null (photo-only), a few have text.
const IG_STORY_CAPTIONS: (string | null)[] = [
  null,
  "golden hour 🌅",
  null,
  "today's vibe",
  null,
  null,
  "3am energy",
  null,
];

const FB_STORY_CAPTIONS: (string | null)[] = [
  null,
  "good morning 👋",
  null,
  null,
  "finally out here",
  null,
  null,
];

// Optional location stickers — index matches the story index, null = no location.
const IG_STORY_LOCATIONS: (string | null)[] = [
  null, null, "Yosemite National Park", null, "Tokyo, Japan", null, null, "Brooklyn, NY",
];

const FB_STORY_LOCATIONS: (string | null)[] = [
  "Portland, OR", null, null, null, "Joshua Tree", null, null,
];

interface SampleFriendDef {
  id: string;
  name: string;
  careLevel: Friend["careLevel"];
  bio: string;
  avatarUrl: string;
  notes?: string;
  sources: Friend["sources"];
}

export interface SampleDataOptions {
  batchId?: string;
  seed?: number;
  scale?: "showcase" | "stress";
  friendCount?: number;
  identitiesPerFriend?: number;
}

export const SAMPLE_SHOWCASE_FEED_COUNT = 15;
export const SAMPLE_SHOWCASE_FRIEND_COUNT = 250;
export const SAMPLE_SHOWCASE_IDENTITIES_PER_FRIEND = 5;
export const SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT =
  SAMPLE_SHOWCASE_FRIEND_COUNT * SAMPLE_SHOWCASE_IDENTITIES_PER_FRIEND;
export const SAMPLE_SHOWCASE_ITEM_COUNT =
  SAMPLE_SHOWCASE_FEED_COUNT * 8 + 20 + 10 + 10 + 10 + 10 + 8 + 7 + SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT;
export const SAMPLE_STRESS_FRIEND_COUNT = 1_000;
export const SAMPLE_STRESS_IDENTITIES_PER_FRIEND = 5;
export const SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT =
  SAMPLE_STRESS_FRIEND_COUNT * SAMPLE_STRESS_IDENTITIES_PER_FRIEND;

interface ResolvedSampleDataOptions {
  batchId: string;
  seed: number;
  friendCount: number;
  identitiesPerFriend: number;
}

const SAMPLE_FRIEND_PERSONAS: Array<{
  slug: string;
  name: string;
  careLevel: Friend["careLevel"];
  bio: string;
  notes?: string;
}> = [
  { slug: "ada", name: "Ada Lovelace", careLevel: 5, bio: "Builds humane developer tools and posts from cafes with suspiciously good natural light.", notes: "Met through the local-first software crowd." },
  { slug: "maya", name: "Maya Chen", careLevel: 4, bio: "Shoots film, hikes often, and treats location stickers like a sacred art form." },
  { slug: "jules", name: "Jules Rivera", careLevel: 3, bio: "Runs a hardware lab, lives in airports, and still answers texts faster than email." },
  { slug: "nina", name: "Nina Patel", careLevel: 4, bio: "Designer with a brutal eye for spacing and a soft spot for weird museums." },
  { slug: "omar", name: "Omar Hassan", careLevel: 5, bio: "Travels with one backpack, three chargers, and too many field notes." },
  { slug: "lena", name: "Lena Brooks", careLevel: 3, bio: "Makes espresso, prototypes interfaces, and disappears into bookstores." },
  { slug: "marco", name: "Marco Silva", careLevel: 2, bio: "Half data viz nerd, half mountain weather oracle." },
  { slug: "ivy", name: "Ivy Nguyen", careLevel: 4, bio: "Keeps a flawless train itinerary and posts exactly when the light is good." },
  { slug: "sofia", name: "Sofia Alvarez", careLevel: 3, bio: "City walker, recipe hoarder, and defender of messy sketchbooks." },
  { slug: "devon", name: "Devon Reed", careLevel: 2, bio: "Writes release notes like tiny poems and always has a charging cable." },
  { slug: "ezra", name: "Ezra Kim", careLevel: 4, bio: "Hardware photographer with a suspicious number of Pelican cases." },
  { slug: "rhea", name: "Rhea Banerjee", careLevel: 5, bio: "Builds community events and knows where to find the quiet table." },
  { slug: "felix", name: "Felix Turner", careLevel: 3, bio: "Posts from bike lanes, coffee counters, and late-night train platforms." },
  { slug: "talia", name: "Talia Morgan", careLevel: 4, bio: "Creative producer with a calendar full of impossible logistics." },
  { slug: "kai", name: "Kai Okafor", careLevel: 3, bio: "Maps every trip, annotates everything, forgets nothing." },
  { slug: "mira", name: "Mira Kostov", careLevel: 2, bio: "Architectural photographer who can find composition in a parking garage." },
  { slug: "leo", name: "Leo Park", careLevel: 4, bio: "Moves between prototyping sessions and ramen shops at irresponsible speed." },
  { slug: "piper", name: "Piper Shah", careLevel: 2, bio: "Collects studio playlists, analog cameras, and overcomplicated packing systems." },
  { slug: "arden", name: "Arden Flores", careLevel: 3, bio: "Curates tiny adventures and writes long captions about weather." },
  { slug: "bianca", name: "Bianca Rossi", careLevel: 5, bio: "Can turn a rough venue, a bad projector, and no sleep into a flawless event." },
  { slug: "samir", name: "Samir Dutta", careLevel: 3, bio: "Field researcher with a camera roll full of signage and clouds." },
  { slug: "hazel", name: "Hazel Cooper", careLevel: 4, bio: "Knows every corner bakery and somehow also every hidden coworking loft." },
  { slug: "terry", name: "Terry Lin", careLevel: 2, bio: "Logistics brain, soft voice, excellent maps." },
  { slug: "cleo", name: "Cleo March", careLevel: 3, bio: "Lives between demo days, ferry terminals, and improbably good sandwiches." },
  { slug: "wes", name: "Wes Calder", careLevel: 4, bio: "Builds outdoor rigs, runs late, posts great photos anyway." },
];

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
  return {
    batchId,
    seed: options?.seed ?? hashSeed(batchId),
    friendCount,
    identitiesPerFriend,
  };
}

function rotateArray<T>(values: T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalizedOffset = ((offset % values.length) + values.length) % values.length;
  return values.slice(normalizedOffset).concat(values.slice(0, normalizedOffset));
}

function namespaceId(batchId: string, value: string): string {
  return `${batchId}:${value}`;
}

const GENERATED_FIRST_NAMES = [
  "Ari", "Blair", "Camille", "Drew", "Elliot", "Finley", "Greer", "Hollis",
  "Indra", "Joss", "Keira", "Luca", "Marin", "Noor", "Orion", "Paz",
  "Quinn", "Remy", "Sage", "Tobin", "Uma", "Vale", "Wren", "Xavi",
  "Yael", "Zadie",
];

const GENERATED_LAST_NAMES = [
  "Adler", "Bennett", "Caro", "Davenport", "Ellis", "Frost", "Ghosh",
  "Hayes", "Ibarra", "Jain", "Keller", "Lopez", "Mori", "Novak",
  "Okoye", "Price", "Rossi", "Sato", "Tan", "Uriarte", "Vega",
  "Wolfe", "Xu", "Young", "Zaman",
];

const SOURCE_PROVIDERS = ["instagram", "x", "facebook", "linkedin", "rss"] as const;

function generatedPersona(index: number): {
  slug: string;
  name: string;
  careLevel: Friend["careLevel"];
  bio: string;
  notes?: string;
} {
  const existing = SAMPLE_FRIEND_PERSONAS[index % SAMPLE_FRIEND_PERSONAS.length];
  if (index < SAMPLE_FRIEND_PERSONAS.length) {
    return existing;
  }

  const first = GENERATED_FIRST_NAMES[index % GENERATED_FIRST_NAMES.length];
  const last = GENERATED_LAST_NAMES[Math.floor(index / GENERATED_FIRST_NAMES.length) % GENERATED_LAST_NAMES.length];
  const variant = Math.floor(index / (GENERATED_FIRST_NAMES.length * GENERATED_LAST_NAMES.length));
  const name = `${first} ${last}${variant > 0 ? ` ${variant + 1}` : ""}`;
  return {
    slug: `${first}-${last}-${index}`.toLowerCase(),
    name,
    careLevel: ((index % 5) + 1) as Friend["careLevel"],
    bio: "Sample friend with linked channels, recent activity, and enough graph signal to make the workspace worth opening.",
  };
}

function sourceHandle(name: string, provider: typeof SOURCE_PROVIDERS[number], index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  if (provider === "linkedin") return `${slug}-${index}`;
  if (provider === "rss") return `${slug}.notes`;
  return `@${slug}.${index}`;
}

function buildSampleFriendDefs(options?: SampleDataOptions): SampleFriendDef[] {
  const { batchId, seed, friendCount, identitiesPerFriend } = resolveSampleDataOptions(options);

  return Array.from({ length: friendCount }, (_, rawIndex) => {
    const index = (rawIndex + seed) % friendCount;
    const persona = generatedPersona(index);
    const avatarUrl = `https://picsum.photos/seed/friend-${batchId}-${persona.slug}/128/128`;
    const sources = Array.from({ length: identitiesPerFriend }, (_, sourceIndex) => {
      const provider = SOURCE_PROVIDERS[(index + sourceIndex) % SOURCE_PROVIDERS.length]!;
      const providerSlug = provider === "rss" ? "rss" : provider;
      const externalId = `${persona.slug}-${providerSlug}-${sourceIndex}`;
      const handle = sourceHandle(persona.name, provider, sourceIndex);
      return {
        platform: provider,
        authorId: namespaceId(batchId, externalId),
        handle,
        displayName: provider === "rss" ? `${persona.name} Notes` : persona.name,
        avatarUrl,
      };
    });

    return {
      id: namespaceId(batchId, `sample-friend-${persona.slug}`),
      name: persona.name,
      careLevel: persona.careLevel,
      bio: persona.bio,
      avatarUrl,
      ...(persona.notes ? { notes: persona.notes } : {}),
      sources,
    };
  });
}

// ── Generators ──────────────────────────────────────────────────────────────

const SAMPLE_FEED_URL_PREFIX = "https://sample.freed.wtf/";

/**
 * Generate 10 sample RSS feed subscriptions.
 *
 * All URLs use the `sample.freed.wtf` prefix so they can never
 * collide with real feeds or trigger network fetches.
 */
export function generateSampleFeeds(options?: SampleDataOptions): RssFeed[] {
  const { batchId, seed } = resolveSampleDataOptions(options);
  const batchLabel = batchId.slice(-4).toUpperCase();
  return rotateArray(FEED_DEFS, seed % FEED_DEFS.length).map((def) => ({
    url: `${SAMPLE_FEED_URL_PREFIX}${batchId}/${def.slug}`,
    title: `${def.title} (Sample ${batchLabel})`,
    siteUrl: def.siteUrl,
    enabled: true,
    trackUnread: true,
    folder: `Sample Feeds ${batchLabel}`,
  }));
}

export function generateSampleFriends(options?: SampleDataOptions): Friend[] {
  const { seed } = resolveSampleDataOptions(options);
  const sampleFriendDefs = buildSampleFriendDefs(options);
  const now = Date.now();
  return sampleFriendDefs.map((friend, index) => ({
    id: friend.id,
    name: friend.name,
    relationshipStatus: "friend",
    careLevel: friend.careLevel,
    bio: friend.bio,
    avatarUrl: friend.avatarUrl,
    ...(friend.notes ? { notes: friend.notes } : {}),
    tags: ["sample", "social"],
    sources: friend.sources,
    createdAt: now - (index + 1) * 7 * DAY - (seed % DAY),
    updatedAt: now - index * DAY,
    ...(index === 0
      ? {
          reachOutLog: [
            { loggedAt: now - 2 * DAY, channel: "text", notes: "Swapped notes on map styling." },
          ],
        }
      : {}),
  }));
}

export function generateSampleLibraryData(options?: SampleDataOptions): {
  feeds: RssFeed[];
  items: FeedItem[];
  friends: Friend[];
} {
  const resolvedOptions = resolveSampleDataOptions(options);
  return {
    feeds: generateSampleFeeds(resolvedOptions),
    items: generateSampleItems(resolvedOptions),
    friends: generateSampleFriends(resolvedOptions),
  };
}

/**
 * Generate 195 sample feed items: 120 RSS articles (8 per feed) +
 * 20 saved bookmarks + 10 X posts + 10 Facebook posts + 10 Instagram posts +
 * 10 LinkedIn posts + 8 Instagram stories + 7 Facebook stories.
 *
 * Stories use contentType:"story", portrait picsum images, and are spread
 * across the last 22 hours (reflecting the ephemeral nature of real stories).
 * Items are spread across the last 14 days with varied user states (read,
 * saved, archived) to exercise all UI views. All IDs are deterministic so
 * repeated calls are idempotent against the Automerge duplicate guard.
 */
export function generateSampleItems(options?: SampleDataOptions): FeedItem[] {
  const resolvedOptions = resolveSampleDataOptions(options);
  const { batchId, seed } = resolvedOptions;
  const rand = mulberry32(seed);
  const now = Date.now();
  const items: FeedItem[] = [];
  const sampleFriendDefs = buildSampleFriendDefs(resolvedOptions);
  const feedDefs = rotateArray(FEED_DEFS, seed % FEED_DEFS.length);
  const rssHeadlines = rotateArray(RSS_HEADLINES, seed % RSS_HEADLINES.length);
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
  const xLocations = rotateArray(
    ["Lisbon, Portugal", "Seoul, South Korea", "Reykjavik, Iceland", "Osaka, Japan", "Valencia, Spain"],
    seed % 5
  );
  const facebookLocations = rotateArray(
    ["Austin, TX", "Berlin, Germany", "Mexico City", "Portland, OR", "Copenhagen, Denmark"],
    seed % 5
  );
  const instagramLocations = rotateArray(
    [
      { name: "Paris", coordinates: { lat: 48.8566, lng: 2.3522 } },
      { name: "Kyoto, Japan", coordinates: { lat: 35.0116, lng: 135.7681 } },
      { name: "Brooklyn, NY", coordinates: { lat: 40.6782, lng: -73.9442 } },
      { name: "Milan, Italy", coordinates: { lat: 45.4642, lng: 9.19 } },
      { name: "Taipei, Taiwan", coordinates: { lat: 25.033, lng: 121.5654 } },
    ],
    seed % 5
  );
  const linkedInLocations = rotateArray(
    [
      "London, UK",
      "Singapore",
      "New York, NY",
      "Toronto, Canada",
      "Amsterdam, Netherlands",
    ],
    seed % 5
  );
  const igStoryLocations = rotateArray(IG_STORY_LOCATIONS, seed % IG_STORY_LOCATIONS.length);
  const fbStoryLocations = rotateArray(FB_STORY_LOCATIONS, seed % FB_STORY_LOCATIONS.length);
  const igStoryCaptions = rotateArray(IG_STORY_CAPTIONS, seed % IG_STORY_CAPTIONS.length);
  const fbStoryCaptions = rotateArray(FB_STORY_CAPTIONS, seed % FB_STORY_CAPTIONS.length);

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

      items.push({
        globalId: namespaceId(batchId, `sample-rss:${feed.slug}:${ai}`),
        platform: "rss",
        contentType: "article",
        capturedAt: publishedAt + 60_000,
        publishedAt,
        author: {
          id: namespaceId(batchId, `sample-${feed.slug}`),
          handle: feed.slug,
          displayName: feed.title,
        },
        content: {
          text: rssHeadlines[idx % rssHeadlines.length],
          mediaUrls: [],
          mediaTypes: [],
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

    items.push({
      globalId: namespaceId(batchId, `sample-saved:${si}`),
      platform: "saved",
      contentType: "article",
      capturedAt: publishedAt + 30_000,
      publishedAt,
      author: {
        id: namespaceId(batchId, `sample-saved-author-${si}`),
        handle: domain,
        displayName: domain.split(".")[0],
      },
      content: {
        text: savedHeadlines[si % savedHeadlines.length],
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: `https://${domain}/sample-article-${batchId}-${si}`,
          title: savedHeadlines[si % savedHeadlines.length],
        },
      },
      preservedContent: {
        text: savedHeadlines[si % savedHeadlines.length],
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

    items.push({
      globalId: namespaceId(batchId, `sample-x:${xi}`),
      platform: "x",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      author,
      content: {
        text: X_POSTS[xi % X_POSTS.length],
        mediaUrls: [],
        mediaTypes: [],
      },
      engagement: {
        likes: Math.round(rand() * 2000),
        reposts: Math.round(rand() * 400),
        comments: Math.round(rand() * 150),
      },
      ...(xi % 2 === 0
        ? {
            location: {
              name: xLocations[(xi / 2) % xLocations.length],
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

    items.push({
      globalId: namespaceId(batchId, `sample-facebook:${fi}`),
      platform: "facebook",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      author,
      content: {
        text: FACEBOOK_POSTS[fi % FACEBOOK_POSTS.length],
        mediaUrls: [],
        mediaTypes: [],
      },
      engagement: {
        likes: Math.round(rand() * 800),
        comments: Math.round(rand() * 60),
      },
      ...(fi % 2 === 0
        ? {
            location: {
              name: facebookLocations[(fi / 2) % facebookLocations.length],
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
    items.push({
      globalId: namespaceId(batchId, `sample-instagram:${ii}`),
      platform: "instagram",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      author,
      content: {
        text: INSTAGRAM_POSTS[ii % INSTAGRAM_POSTS.length],
        mediaUrls: [],
        mediaTypes: [],
      },
      engagement: {
        likes: Math.round(rand() * 1500),
        comments: Math.round(rand() * 80),
      },
      ...(ii % 2 === 0
        ? {
            location: {
              name: instagramLocations[(ii / 2) % instagramLocations.length].name,
              coordinates: instagramLocations[(ii / 2) % instagramLocations.length].coordinates,
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

    items.push({
      globalId: namespaceId(batchId, `sample-linkedin:${li}`),
      platform: "linkedin",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      author,
      content: {
        text: LINKEDIN_POSTS[li % LINKEDIN_POSTS.length],
        mediaUrls: [],
        mediaTypes: [],
      },
      engagement: {
        likes: Math.round(rand() * 1_800),
        comments: Math.round(rand() * 120),
      },
      ...(li % 2 === 0
        ? {
            location: {
              name: linkedInLocations[(li / 2) % linkedInLocations.length],
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

  // 8 Instagram stories — ephemeral, spread over the last 22 hours.
  // Portrait images use picsum.photos with deterministic seed strings.
  for (let si = 0; si < 8; si++) {
    const age = (si / 8) * 22 * HOUR + rand() * HOUR;
    const publishedAt = Math.round(now - age);
    const author = igStoryAuthors[si % igStoryAuthors.length];
    const caption = igStoryCaptions[si] ?? undefined;
    const locationName = igStoryLocations[si] ?? undefined;

    items.push({
      globalId: namespaceId(batchId, `sample-ig-story:${si}`),
      platform: "instagram",
      contentType: "story",
      capturedAt: publishedAt + 2_000,
      publishedAt,
      author,
      content: {
        text: caption,
        mediaUrls: [`https://picsum.photos/seed/${batchId}-ig-story-${si}/600/900`],
        mediaTypes: ["image"],
      },
      ...(locationName ? { location: { name: locationName, source: "sticker" } } : {}),
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
    const caption = fbStoryCaptions[si] ?? undefined;
    const locationName = fbStoryLocations[si] ?? undefined;

    items.push({
      globalId: namespaceId(batchId, `sample-fb-story:${si}`),
      platform: "facebook",
      contentType: "story",
      capturedAt: publishedAt + 2_000,
      publishedAt,
      author,
      content: {
        text: caption,
        mediaUrls: [`https://picsum.photos/seed/${batchId}-fb-story-${si}/600/900`],
        mediaTypes: ["image"],
      },
      ...(locationName ? { location: { name: locationName, source: "check_in" } } : {}),
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: pickTopics(rand, 148 + si),
    });
  }

  let graphItemIndex = 0;
  for (const friend of sampleFriendDefs) {
    for (const source of friend.sources) {
      const age = ((graphItemIndex % 90) / 90) * 21 * DAY + rand() * DAY;
      const publishedAt = Math.round(now - age);
      const contentType = source.platform === "rss" ? "article" : "post";
      const text =
        source.platform === "linkedin"
          ? LINKEDIN_POSTS[graphItemIndex % LINKEDIN_POSTS.length]
          : source.platform === "instagram"
            ? INSTAGRAM_POSTS[graphItemIndex % INSTAGRAM_POSTS.length]
            : source.platform === "facebook"
              ? FACEBOOK_POSTS[graphItemIndex % FACEBOOK_POSTS.length]
              : source.platform === "rss"
                ? RSS_HEADLINES[graphItemIndex % RSS_HEADLINES.length]
                : X_POSTS[graphItemIndex % X_POSTS.length];
      const location =
        graphItemIndex % 7 === 0
          ? {
              name: xLocations[graphItemIndex % xLocations.length],
              source: "text_extraction" as const,
            }
          : undefined;

      items.push({
        globalId: namespaceId(batchId, `sample-graph:${source.platform}:${graphItemIndex}`),
        platform: source.platform,
        contentType,
        capturedAt: publishedAt + 5_000,
        publishedAt,
        author: {
          id: source.authorId,
          handle: source.handle ?? source.authorId,
          displayName: source.displayName ?? source.handle ?? friend.name,
          avatarUrl: source.avatarUrl,
        },
        content: {
          text,
          mediaUrls: [],
          mediaTypes: [],
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
        ...(location ? { location } : {}),
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

  return items;
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
