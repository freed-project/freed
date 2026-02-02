#!/usr/bin/env bun
/**
 * Test script for @freed/capture-rss
 *
 * Run with: bun run packages/capture-rss/test-capture.ts
 */

import {
  fetchFeed,
  discoverFeed,
  parseOPML,
  feedToFeedItems,
  feedToRssFeed,
} from "./dist/index.js";

// Test feeds
const TEST_FEEDS = [
  "https://daringfireball.net/feeds/main", // Classic RSS
  "https://blog.rust-lang.org/feed.xml", // Atom
  "https://simonwillison.net/atom/everything/", // Atom
];

// Test discovery URLs (website -> find RSS)
const TEST_DISCOVERY = [
  "https://www.youtube.com/channel/UC2eYFnH61tmytImy1mTYvhA", // YouTube channel
  "https://paulgraham.com", // Blog
];

async function testFeedFetching() {
  console.log("\n═══ Testing Feed Fetching ═══\n");

  for (const url of TEST_FEEDS) {
    console.log(`Fetching: ${url}`);
    try {
      const result = await fetchFeed(url);

      if (result.unchanged) {
        console.log("  → 304 Not Modified (cached)");
      } else if (result.feed) {
        console.log(`  → ${result.feed.title}`);
        console.log(`  → ${result.feed.items.length} items`);
        console.log(`  → ETag: ${result.etag || "none"}`);

        // Show first item
        const first = result.feed.items[0];
        if (first) {
          console.log(`  → Latest: "${first.title?.slice(0, 50)}..."`);
        }
      }
    } catch (err) {
      console.log(`  → Error: ${err}`);
    }
    console.log();
  }
}

async function testFeedDiscovery() {
  console.log("\n═══ Testing Feed Discovery ═══\n");

  for (const url of TEST_DISCOVERY) {
    console.log(`Discovering: ${url}`);
    try {
      const feedUrl = await discoverFeed(url);
      if (feedUrl) {
        console.log(`  → Found: ${feedUrl}`);
      } else {
        console.log(`  → No feed found`);
      }
    } catch (err) {
      console.log(`  → Error: ${err}`);
    }
    console.log();
  }
}

async function testNormalization() {
  console.log("\n═══ Testing Normalization ═══\n");

  const result = await fetchFeed(TEST_FEEDS[0]);
  if (!result.feed) {
    console.log("Failed to fetch feed");
    return;
  }

  const feedItems = feedToFeedItems(result.feed);
  const rssFeed = feedToRssFeed(result.feed);

  console.log(`RssFeed subscription:`);
  console.log(`  url: ${rssFeed.url}`);
  console.log(`  title: ${rssFeed.title}`);
  console.log(`  enabled: ${rssFeed.enabled}`);
  console.log();

  console.log(`First 3 FeedItems:`);
  for (const item of feedItems.slice(0, 3)) {
    console.log(`  ─────────────────────────`);
    console.log(`  globalId: ${item.globalId.slice(0, 60)}...`);
    console.log(`  platform: ${item.platform}`);
    console.log(`  author: ${item.author.handle}`);
    console.log(`  published: ${new Date(item.publishedAt).toISOString()}`);
    console.log(`  text: ${item.content.text?.slice(0, 80)}...`);
    console.log(`  topics: ${item.topics.join(", ") || "(none)"}`);
  }
}

async function testOPML() {
  console.log("\n═══ Testing OPML Parsing ═══\n");

  const sampleOPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test Feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Daring Fireball" 
               xmlUrl="https://daringfireball.net/feeds/main" 
               htmlUrl="https://daringfireball.net"/>
      <outline type="rss" text="Rust Blog" 
               xmlUrl="https://blog.rust-lang.org/feed.xml"/>
    </outline>
    <outline type="rss" text="Simon Willison" 
             xmlUrl="https://simonwillison.net/atom/everything/"/>
  </body>
</opml>`;

  try {
    const feeds = parseOPML(sampleOPML);
    console.log(`Parsed ${feeds.length} feeds from OPML:`);
    for (const feed of feeds) {
      console.log(`  • ${feed.title} (${feed.category || "uncategorized"})`);
      console.log(`    ${feed.url}`);
    }
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

async function testConditionalGet() {
  console.log("\n═══ Testing Conditional GET ═══\n");

  const url = TEST_FEEDS[0];

  // First fetch
  console.log("First fetch (no cache headers):");
  const first = await fetchFeed(url);
  console.log(`  → ${first.feed?.items.length} items`);
  console.log(`  → ETag: ${first.etag}`);
  console.log(`  → Last-Modified: ${first.lastModified}`);

  // Second fetch with cache headers
  console.log("\nSecond fetch (with cache headers):");
  const second = await fetchFeed(url, {
    etag: first.etag,
    lastModified: first.lastModified,
  });

  if (second.unchanged) {
    console.log("  → 304 Not Modified ✓ (bandwidth saved!)");
  } else {
    console.log("  → Feed was updated (or server ignores cache headers)");
  }
}

// Run all tests
async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║       @freed/capture-rss Test Suite            ║");
  console.log("╚════════════════════════════════════════════════╝");

  await testFeedFetching();
  await testFeedDiscovery();
  await testNormalization();
  await testOPML();
  await testConditionalGet();

  console.log("\n✓ All tests complete\n");
}

main().catch(console.error);
