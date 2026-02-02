/**
 * capture-rss OpenClaw skill
 *
 * Background RSS/Atom feed capture for FREED
 */

import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as A from "@automerge/automerge";
import {
  fetchFeed,
  fetchFeeds,
  discoverFeed,
  parseOPML,
  generateOPML,
  opmlFeedsToRssFeeds,
  feedToFeedItems,
  feedToRssFeed,
  deduplicateFeedItems,
  type FetchResult,
  type ParsedFeed,
} from "@freed/capture-rss";
import {
  type FreedDoc,
  type FeedItem,
  type RssFeed,
  createEmptyDoc,
  addFeedItem,
  addRssFeed,
  updateRssFeed,
  removeRssFeed,
  hasFeedItem,
  getEnabledFeeds,
  getFeedItemsSorted,
} from "@freed/shared";

// =============================================================================
// Configuration
// =============================================================================

interface Config {
  "capture-rss": {
    pollInterval: number;
    maxItemsPerFeed: number;
    concurrency: number;
  };
}

interface State {
  running: boolean;
  lastSync: number | null;
  itemsCaptured: number;
  errors: string[];
}

const FREED_DIR = join(homedir(), ".freed");
const CONFIG_PATH = join(FREED_DIR, "config.json");
const DATA_DIR = join(FREED_DIR, "data");
const DOC_PATH = join(DATA_DIR, "feed.automerge");
const STATE_PATH = join(DATA_DIR, "capture-rss-state.json");

// =============================================================================
// Helpers
// =============================================================================

function ensureDirs(): void {
  if (!existsSync(FREED_DIR)) mkdirSync(FREED_DIR, { recursive: true });
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig(): Config {
  ensureDirs();

  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return {
        ...config,
        "capture-rss": {
          pollInterval: 30,
          maxItemsPerFeed: 50,
          concurrency: 5,
          ...config["capture-rss"],
        },
      };
    } catch {
      // Fall through
    }
  }

  return {
    "capture-rss": {
      pollInterval: 30,
      maxItemsPerFeed: 50,
      concurrency: 5,
    },
  };
}

function loadState(): State {
  ensureDirs();

  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {
      // Fall through
    }
  }

  return {
    running: false,
    lastSync: null,
    itemsCaptured: 0,
    errors: [],
  };
}

function saveState(state: State): void {
  ensureDirs();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadDoc(): FreedDoc {
  ensureDirs();

  if (existsSync(DOC_PATH)) {
    try {
      const binary = readFileSync(DOC_PATH);
      return A.load<FreedDoc>(binary);
    } catch {
      console.log("Creating new document...");
    }
  }

  return createEmptyDoc();
}

function saveDoc(doc: FreedDoc): void {
  ensureDirs();
  const binary = A.save(doc);
  writeFileSync(DOC_PATH, binary);
}

// =============================================================================
// Feed Operations
// =============================================================================

async function addFeedByUrl(url: string): Promise<void> {
  let doc = loadDoc();

  // Check if already subscribed
  if (doc.rssFeeds[url]) {
    console.log(`Already subscribed to: ${url}`);
    return;
  }

  // Try to discover feed URL
  console.log(`Discovering feed for: ${url}`);
  const feedUrl = await discoverFeed(url);

  if (!feedUrl) {
    console.error(
      "Could not find RSS feed. Try providing the direct feed URL.",
    );
    process.exit(1);
  }

  console.log(`Found feed: ${feedUrl}`);

  // Fetch feed to get metadata
  const result = await fetchFeed(feedUrl);

  if (result.unchanged || !result.feed) {
    console.error("Could not fetch feed.");
    process.exit(1);
  }

  // Add feed subscription
  const rssFeed = feedToRssFeed(result.feed, true);
  rssFeed.etag = result.etag;
  rssFeed.lastModified = result.lastModified;

  doc = A.change(doc, (d) => addRssFeed(d, rssFeed));

  // Add initial items
  const items = feedToFeedItems(result.feed);
  let added = 0;
  for (const item of items) {
    if (!hasFeedItem(doc, item.globalId)) {
      doc = A.change(doc, (d) => addFeedItem(d, item));
      added++;
    }
  }

  saveDoc(doc);
  console.log(`Added feed: ${result.feed.title}`);
  console.log(`Captured ${added} items.`);
}

async function importOPML(filePath: string): Promise<void> {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const xml = readFileSync(filePath, "utf-8");
  const opmlFeeds = parseOPML(xml);

  if (opmlFeeds.length === 0) {
    console.error("No feeds found in OPML file.");
    process.exit(1);
  }

  console.log(`Found ${opmlFeeds.length} feeds in OPML.`);

  let doc = loadDoc();
  let added = 0;
  let skipped = 0;

  for (const feed of opmlFeeds) {
    if (doc.rssFeeds[feed.url]) {
      skipped++;
      continue;
    }

    const rssFeed: RssFeed = {
      url: feed.url,
      title: feed.title,
      siteUrl: feed.siteUrl,
      enabled: true,
    };

    doc = A.change(doc, (d) => addRssFeed(d, rssFeed));
    added++;
  }

  saveDoc(doc);
  console.log(`Imported ${added} feeds (${skipped} already subscribed).`);
  console.log("Run `capture-rss sync` to fetch content.");
}

function listFeeds(): void {
  const doc = loadDoc();
  const feeds = Object.values(doc.rssFeeds);

  if (feeds.length === 0) {
    console.log("No feeds subscribed.");
    console.log("Add feeds with: capture-rss add <url>");
    return;
  }

  console.log(`\n=== ${feeds.length} Subscribed Feeds ===\n`);

  for (const feed of feeds) {
    const status = feed.enabled ? "✓" : "○";
    const lastFetch = feed.lastFetched
      ? new Date(feed.lastFetched).toLocaleString()
      : "Never";

    console.log(`${status} ${feed.title}`);
    console.log(`  URL: ${feed.url}`);
    console.log(`  Last fetched: ${lastFetch}`);
    console.log();
  }
}

function removeFeedByUrl(url: string): void {
  let doc = loadDoc();

  // Try exact match first
  if (!doc.rssFeeds[url]) {
    // Try partial match
    const match = Object.keys(doc.rssFeeds).find((u) => u.includes(url));
    if (match) {
      url = match;
    } else {
      console.error(`Feed not found: ${url}`);
      process.exit(1);
    }
  }

  const feed = doc.rssFeeds[url];
  doc = A.change(doc, (d) => removeRssFeed(d, url));

  saveDoc(doc);
  console.log(`Removed: ${feed.title}`);
}

async function syncAllFeeds(): Promise<void> {
  const config = loadConfig();
  const state = loadState();
  let doc = loadDoc();

  const feeds = getEnabledFeeds(doc);

  if (feeds.length === 0) {
    console.log("No feeds to sync.");
    return;
  }

  console.log(`Syncing ${feeds.length} feeds...`);

  // Prepare feed list with caching info
  const feedRequests = feeds.map((feed) => ({
    url: feed.url,
    etag: feed.etag,
    lastModified: feed.lastModified,
  }));

  // Fetch all feeds
  const results = await fetchFeeds(
    feedRequests,
    config["capture-rss"].concurrency,
  );

  let totalAdded = 0;
  let unchanged = 0;
  let errors = 0;

  for (const { url, result } of results) {
    if ("error" in result) {
      console.error(`  Error fetching ${url}: ${result.error}`);
      errors++;
      continue;
    }

    if (result.unchanged) {
      unchanged++;
      continue;
    }

    if (!result.feed) continue;

    // Update feed metadata
    doc = A.change(doc, (d) => {
      updateRssFeed(d, url, {
        title: result.feed!.title,
        lastFetched: Date.now(),
        etag: result.etag,
        lastModified: result.lastModified,
      });
    });

    // Add new items
    const items = feedToFeedItems(result.feed);
    let added = 0;
    for (const item of items) {
      if (!hasFeedItem(doc, item.globalId)) {
        doc = A.change(doc, (d) => addFeedItem(d, item));
        added++;
      }
    }

    if (added > 0) {
      console.log(`  ${result.feed.title}: +${added} items`);
    }

    totalAdded += added;
  }

  saveDoc(doc);

  // Update state
  state.lastSync = Date.now();
  state.itemsCaptured += totalAdded;
  saveState(state);

  console.log(`\nSync complete:`);
  console.log(`  New items: ${totalAdded}`);
  console.log(`  Unchanged: ${unchanged}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  console.log(`  Total items: ${Object.keys(doc.feedItems).length}`);
}

function exportOPML(filePath: string): void {
  const doc = loadDoc();
  const feeds = Object.values(doc.rssFeeds);

  if (feeds.length === 0) {
    console.error("No feeds to export.");
    process.exit(1);
  }

  const opml = generateOPML(feeds, "FREED Feed Subscriptions");
  writeFileSync(filePath, opml);

  console.log(`Exported ${feeds.length} feeds to: ${filePath}`);
}

function showRecent(count: number = 10): void {
  const doc = loadDoc();
  const items = getFeedItemsSorted(doc)
    .filter((item) => item.platform !== "x") // Only RSS items
    .slice(0, count);

  console.log(`\n=== ${items.length} Most Recent RSS Items ===\n`);

  for (const item of items) {
    const date = new Date(item.publishedAt).toLocaleString();
    const text =
      item.content.text?.slice(0, 100) ||
      item.content.linkPreview?.title ||
      "(no text)";
    const source = item.rssSource?.feedTitle || item.author.displayName;

    console.log(`[${source}] ${date}`);
    console.log(`  ${text}${text.length >= 100 ? "..." : ""}`);
    if (item.content.linkPreview?.url) {
      console.log(`  ${item.content.linkPreview.url}`);
    }
    console.log();
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "add":
      if (!args[1]) {
        console.error("Usage: capture-rss add <url>");
        process.exit(1);
      }
      await addFeedByUrl(args[1]);
      break;

    case "import":
      if (!args[1]) {
        console.error("Usage: capture-rss import <opml-file>");
        process.exit(1);
      }
      await importOPML(args[1]);
      break;

    case "list":
      listFeeds();
      break;

    case "remove":
      if (!args[1]) {
        console.error("Usage: capture-rss remove <url>");
        process.exit(1);
      }
      removeFeedByUrl(args[1]);
      break;

    case "sync":
      await syncAllFeeds();
      break;

    case "export":
      if (!args[1]) {
        console.error("Usage: capture-rss export <opml-file>");
        process.exit(1);
      }
      exportOPML(args[1]);
      break;

    case "recent":
      showRecent(parseInt(args[1]) || 10);
      break;

    default:
      console.log(`
capture-rss - RSS/Atom feed capture for FREED

Commands:
  add <url>           Add a feed (auto-discovers RSS URL)
  import <file>       Import feeds from OPML file
  list                List subscribed feeds
  remove <url>        Remove a feed
  sync                Sync all feeds now
  export <file>       Export feeds to OPML
  recent [n]          Show n most recent items (default: 10)

Examples:
  capture-rss add https://example.com/blog
  capture-rss import feedly-export.opml
  capture-rss sync
  capture-rss export my-feeds.opml
`);
  }
}

main().catch(console.error);
