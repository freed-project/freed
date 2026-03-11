/**
 * Sample data generator for regression testing.
 *
 * Produces 10 RSS feeds and 100 feed items (80 RSS articles + 20 saved
 * bookmarks) with deterministic IDs so repeated calls are idempotent
 * against the existing duplicate guard in Automerge mutations.
 *
 * All feed URLs use the `https://sample.freed.wtf/` prefix to avoid
 * colliding with real subscriptions and to prevent actual fetch attempts.
 */

import type { FeedItem, RssFeed } from "./types.js";

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

// ── Generators ──────────────────────────────────────────────────────────────

const SAMPLE_FEED_URL_PREFIX = "https://sample.freed.wtf/";

/**
 * Generate 10 sample RSS feed subscriptions.
 *
 * All URLs use the `sample.freed.wtf` prefix so they can never
 * collide with real feeds or trigger network fetches.
 */
export function generateSampleFeeds(): RssFeed[] {
  return FEED_DEFS.map((def) => ({
    url: `${SAMPLE_FEED_URL_PREFIX}${def.slug}`,
    title: `${def.title} (Sample)`,
    siteUrl: def.siteUrl,
    enabled: true,
    trackUnread: true,
    folder: "Sample Feeds",
  }));
}

/**
 * Generate 130 sample feed items: 80 RSS articles (8 per feed) +
 * 20 saved bookmarks + 10 X posts + 10 Facebook posts + 10 Instagram posts.
 * Items are spread across the last 14 days with varied user states (read,
 * saved, archived) to exercise all UI views. All IDs are deterministic so
 * repeated calls are idempotent against the Automerge duplicate guard.
 */
export function generateSampleItems(): FeedItem[] {
  const rand = mulberry32(42);
  const now = Date.now();
  const DAY = 86_400_000;
  const items: FeedItem[] = [];

  // 80 RSS articles: 8 per feed
  for (let fi = 0; fi < FEED_DEFS.length; fi++) {
    const feed = FEED_DEFS[fi];
    const feedUrl = `${SAMPLE_FEED_URL_PREFIX}${feed.slug}`;
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
        globalId: `sample-rss:${feed.slug}:${ai}`,
        platform: "rss",
        contentType: "article",
        capturedAt: publishedAt + 60_000,
        publishedAt,
        author: {
          id: `sample-${feed.slug}`,
          handle: feed.slug,
          displayName: feed.title,
        },
        content: {
          text: RSS_HEADLINES[idx % RSS_HEADLINES.length],
          mediaUrls: [],
          mediaTypes: [],
        },
        rssSource: {
          feedUrl,
          feedTitle: `${feed.title} (Sample)`,
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
    const domain = SAVED_DOMAINS[si % SAVED_DOMAINS.length];
    const r = rand();
    const wordCount = 800 + Math.round(rand() * 3200);

    items.push({
      globalId: `sample-saved:${si}`,
      platform: "saved",
      contentType: "article",
      capturedAt: publishedAt + 30_000,
      publishedAt,
      author: {
        id: `sample-saved-author-${si}`,
        handle: domain,
        displayName: domain.split(".")[0],
      },
      content: {
        text: SAVED_HEADLINES[si % SAVED_HEADLINES.length],
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: `https://${domain}/sample-article-${si}`,
          title: SAVED_HEADLINES[si % SAVED_HEADLINES.length],
        },
      },
      preservedContent: {
        text: SAVED_HEADLINES[si % SAVED_HEADLINES.length],
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
    const author = X_AUTHORS[xi % X_AUTHORS.length];
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;

    items.push({
      globalId: `sample-x:${xi}`,
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
    const author = FACEBOOK_AUTHORS[fi % FACEBOOK_AUTHORS.length];
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;

    items.push({
      globalId: `sample-facebook:${fi}`,
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
  const IG_AUTHOR = { id: "sample-ig-1", handle: "@freed.desk", displayName: "Freed Desk" };
  for (let ii = 0; ii < 10; ii++) {
    const age = (ii / 10) * 7 * DAY + rand() * DAY;
    const publishedAt = Math.round(now - age);
    const r = rand();
    const isSaved = r > 0.85;
    const isArchived = !isSaved && r < 0.1;

    items.push({
      globalId: `sample-instagram:${ii}`,
      platform: "instagram",
      contentType: "post",
      capturedAt: publishedAt + 5_000,
      publishedAt,
      author: IG_AUTHOR,
      content: {
        text: INSTAGRAM_POSTS[ii % INSTAGRAM_POSTS.length],
        mediaUrls: [],
        mediaTypes: [],
      },
      engagement: {
        likes: Math.round(rand() * 1500),
        comments: Math.round(rand() * 80),
      },
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
