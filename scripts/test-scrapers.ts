#!/usr/bin/env npx tsx
/**
 * Scraper integration test harness
 *
 * Fetches real data from X and Facebook, saves raw responses as timestamped
 * fixtures, runs the actual parsers, and reports extraction results.
 *
 * When a platform changes their markup or API shape, run this script, compare
 * the new fixture to the last working one, fix the parser, and commit both.
 *
 * Usage:
 *   # Facebook only
 *   FB_C_USER=xxx FB_XS=yyy npx tsx scripts/test-scrapers.ts --facebook
 *
 *   # X only
 *   X_CT0=xxx X_AUTH_TOKEN=yyy npx tsx scripts/test-scrapers.ts --x
 *
 *   # Both
 *   FB_C_USER=xxx FB_XS=yyy X_CT0=xxx X_AUTH_TOKEN=yyy npx tsx scripts/test-scrapers.ts
 *
 *   # Save fixtures for regression testing
 *   ... npx tsx scripts/test-scrapers.ts --facebook --save
 *
 *   # Run parser against the latest saved fixture (no network)
 *   npx tsx scripts/test-scrapers.ts --facebook --offline
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FB_FIXTURES_DIR = join(ROOT, "packages/capture-facebook/tests/fixtures");
const X_FIXTURES_DIR = join(ROOT, "packages/capture-x/tests/fixtures");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const runFb = args.includes("--facebook") || args.includes("--fb") || (!args.includes("--x"));
const runX = args.includes("--x") || (!args.includes("--facebook") && !args.includes("--fb"));
const saveFixtures = args.includes("--save");
const offline = args.includes("--offline");

// ---------------------------------------------------------------------------
// Facebook scraper test
// ---------------------------------------------------------------------------

async function testFacebook() {
  console.log("\n" + "=".repeat(72));
  console.log("  FACEBOOK SCRAPER TEST");
  console.log("=".repeat(72));

  let html: string;

  if (offline) {
    const latestPath = join(FB_FIXTURES_DIR, "mbasic-feed-latest.html");
    if (!existsSync(latestPath)) {
      console.error("No offline fixture found at", latestPath);
      console.error("Run with real cookies first using --save to create one.");
      return false;
    }
    html = readFileSync(latestPath, "utf-8");
    console.log(`Loaded offline fixture: ${html.length.toLocaleString()} bytes`);
  } else {
    const cUser = process.env.FB_C_USER;
    const xs = process.env.FB_XS;
    if (!cUser || !xs) {
      console.error("Missing cookies. Set FB_C_USER and FB_XS env vars.");
      console.error("Get them from DevTools > Application > Cookies > facebook.com");
      return false;
    }

    console.log("Fetching mbasic.facebook.com...");
    const resp = await fetch("https://mbasic.facebook.com/", {
      headers: {
        cookie: `c_user=${cUser}; xs=${xs}`,
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    html = await resp.text();
    console.log(`Response: ${resp.status} ${resp.statusText} (${html.length.toLocaleString()} bytes)`);

    if (html.includes("/login") && !html.includes("mbasic_logout_button") && html.length < 10_000) {
      console.error("FAIL: Facebook redirected to login. Cookies may be expired.");
      console.error("First 500 chars:");
      console.error(html.slice(0, 500));
      return false;
    }

    if (saveFixtures) {
      mkdirSync(FB_FIXTURES_DIR, { recursive: true });
      const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const fixturePath = join(FB_FIXTURES_DIR, `mbasic-feed-${date}.html`);
      writeFileSync(fixturePath, html, "utf-8");
      console.log(`Fixture saved: ${fixturePath}`);
      const latestPath = join(FB_FIXTURES_DIR, "mbasic-feed-latest.html");
      writeFileSync(latestPath, html, "utf-8");
      console.log(`Latest fixture: ${latestPath}`);
    }
  }

  // --- Analyze raw HTML structure ---
  console.log("\n--- Raw HTML analysis ---");
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const title = doc.querySelector("title")?.textContent ?? "(no title)";
  console.log(`Page title: ${title}`);

  const indicators = {
    "[data-ft]": doc.querySelectorAll("[data-ft]").length,
    "<article>": doc.querySelectorAll("article").length,
    '[role="article"]': doc.querySelectorAll('[role="article"]').length,
    "#recent": !!doc.querySelector("#recent"),
    "#root": !!doc.querySelector("#root"),
    "#m_news_feed_stream": !!doc.querySelector("#m_news_feed_stream"),
    'a[href*="/story.php"]': doc.querySelectorAll('a[href*="/story.php"]').length,
    "<h3>": doc.querySelectorAll("h3").length,
    "<abbr>": doc.querySelectorAll("abbr").length,
    "section": doc.querySelectorAll("section").length,
  };

  console.log("\nDOM indicators:");
  for (const [sel, val] of Object.entries(indicators)) {
    console.log(`  ${sel}: ${val}`);
  }

  // Show top-level structure
  console.log("\nTop-level structure (ids/classes):");
  doc.querySelectorAll("body > *, #root > *, #recent > div, #m_news_feed_stream > div").forEach((el, i) => {
    if (i > 20) return;
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id") ?? "";
    const cls = (el.getAttribute("class") ?? "").slice(0, 80);
    const role = el.getAttribute("role") ?? "";
    const dataFt = el.hasAttribute("data-ft") ? "[data-ft]" : "";
    const children = el.children.length;
    console.log(`  <${tag} id="${id}" class="${cls}" role="${role}" ${dataFt}> (${children} children)`);
  });

  // Show potential post containers
  const storyLinks = doc.querySelectorAll('a[href*="/story.php"]');
  if (storyLinks.length > 0) {
    console.log(`\nStory link contexts (first 5):`);
    Array.from(storyLinks).slice(0, 5).forEach((link, i) => {
      let container = link as Element;
      for (let d = 0; d < 8; d++) {
        if (!container.parentElement) break;
        container = container.parentElement;
        if (container.getAttribute("data-ft") || container.tagName === "ARTICLE" ||
            container.getAttribute("role") === "article" || container.getAttribute("id")) break;
      }
      const text = (container.textContent ?? "").replace(/\s+/g, " ").slice(0, 200);
      console.log(`  [${i}] Container: <${container.tagName.toLowerCase()} id="${container.getAttribute("id") ?? ""}" class="${(container.getAttribute("class") ?? "").slice(0, 40)}">`);
      console.log(`       Text: ${text}`);
    });
  }

  // Show h3 elements (author names)
  const h3s = doc.querySelectorAll("h3");
  if (h3s.length > 0) {
    console.log(`\nH3 elements (first 8):`);
    Array.from(h3s).slice(0, 8).forEach((h3, i) => {
      const link = h3.querySelector("a");
      console.log(`  [${i}] text="${(h3.textContent ?? "").slice(0, 80)}" href="${link?.getAttribute("href")?.slice(0, 60) ?? "none"}"`);
    });
  }

  // --- Run the actual parser ---
  console.log("\n--- Parser results ---");

  // parseMbasicFeed uses DOMParser (browser API). In Node we must polyfill it.
  const { DOMParser: JSDOMParser } = await import("jsdom");
  // @ts-expect-error polyfill for Node
  globalThis.DOMParser = class {
    parseFromString(s: string, type: string) {
      return new JSDOM(s, { contentType: type as "text/html" }).window.document;
    }
  };

  const { parseMbasicFeed } = await import(join(ROOT, "packages/capture-facebook/src/mbasic-parser.ts"));

  let posts;
  try {
    posts = parseMbasicFeed(html);
  } catch (err) {
    console.error("Parser threw:", err);
    return false;
  }

  console.log(`Posts extracted: ${posts.length}`);

  if (posts.length === 0) {
    console.error("FAIL: Parser returned 0 posts from non-empty HTML.");
    console.error("The parser selectors need to be updated to match the current mbasic DOM.");
    return false;
  }

  posts.slice(0, 5).forEach((post: Record<string, unknown>, i: number) => {
    console.log(`\n  Post ${i}:`);
    console.log(`    id: ${post.id ?? "(null)"}`);
    console.log(`    author: ${post.authorName ?? "(null)"}`);
    console.log(`    url: ${(post.url as string)?.slice(0, 80) ?? "(null)"}`);
    console.log(`    text: ${((post.text as string) ?? "").slice(0, 120)}`);
    console.log(`    media: ${(post.mediaUrls as string[])?.length ?? 0} URLs`);
    console.log(`    timestamp: ${post.timestampSeconds ?? post.timestampIso ?? "(null)"}`);
  });

  // Test normalization pipeline
  console.log("\n--- Normalization ---");
  const { fbPostsToFeedItems, deduplicateFeedItems } = await import(
    join(ROOT, "packages/capture-facebook/src/normalize.ts")
  );

  let feedItems;
  try {
    feedItems = fbPostsToFeedItems(posts);
  } catch (err) {
    console.error("Normalization threw:", err);
    return false;
  }

  console.log(`FeedItems produced: ${feedItems.length}`);
  const deduped = deduplicateFeedItems(feedItems);
  console.log(`After dedup: ${deduped.length}`);

  if (deduped.length > 0) {
    console.log(`\n  Sample FeedItem:`);
    const sample = deduped[0];
    console.log(`    globalId: ${sample.globalId}`);
    console.log(`    platform: ${sample.platform}`);
    console.log(`    author: ${sample.author?.displayName ?? "(null)"}`);
    console.log(`    text: ${sample.content?.text?.slice(0, 100) ?? "(null)"}`);
    console.log(`    publishedAt: ${sample.publishedAt ? new Date(sample.publishedAt).toISOString() : "(null)"}`);
  }

  console.log(`\nFACEBOOK: ${deduped.length > 0 ? "PASS" : "FAIL"} (${deduped.length} items)`);
  return deduped.length > 0;
}

// ---------------------------------------------------------------------------
// X scraper test
// ---------------------------------------------------------------------------

async function testX() {
  console.log("\n" + "=".repeat(72));
  console.log("  X/TWITTER SCRAPER TEST");
  console.log("=".repeat(72));

  let rawJson: string;

  if (offline) {
    const latestPath = join(X_FIXTURES_DIR, "timeline-latest.json");
    if (!existsSync(latestPath)) {
      console.error("No offline fixture found at", latestPath);
      console.error("Run with real cookies first using --save to create one.");
      return false;
    }
    rawJson = readFileSync(latestPath, "utf-8");
    console.log(`Loaded offline fixture: ${rawJson.length.toLocaleString()} bytes`);
  } else {
    const ct0 = process.env.X_CT0;
    const authToken = process.env.X_AUTH_TOKEN;
    if (!ct0 || !authToken) {
      console.error("Missing cookies. Set X_CT0 and X_AUTH_TOKEN env vars.");
      console.error("Get them from DevTools > Application > Cookies > x.com");
      return false;
    }

    // Build the request exactly as x-capture.ts does
    const {
      X_API_BASE,
      X_BEARER_TOKEN,
      HomeLatestTimeline,
      getHomeLatestTimelineVariables,
    } = await import(join(ROOT, "packages/capture-x/src/endpoints.ts"));

    const variables = getHomeLatestTimelineVariables();
    const base = `${X_API_BASE}/${HomeLatestTimeline.queryId}/${HomeLatestTimeline.operationName}`;
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(HomeLatestTimeline.features),
    });
    const url = `${base}?${params.toString()}`;

    console.log(`Fetching X HomeLatestTimeline...`);
    console.log(`  URL: ${url.slice(0, 120)}...`);

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${X_BEARER_TOKEN}`,
        "x-csrf-token": ct0,
        cookie: `ct0=${ct0}; auth_token=${authToken}`,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    rawJson = await resp.text();
    console.log(`Response: ${resp.status} ${resp.statusText} (${rawJson.length.toLocaleString()} bytes)`);

    if (resp.status !== 200) {
      console.error("FAIL: Non-200 response from X API.");
      console.error("Response preview:", rawJson.slice(0, 500));
      return false;
    }

    if (saveFixtures) {
      mkdirSync(X_FIXTURES_DIR, { recursive: true });
      const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const fixturePath = join(X_FIXTURES_DIR, `timeline-${date}.json`);
      writeFileSync(fixturePath, rawJson, "utf-8");
      console.log(`Fixture saved: ${fixturePath}`);
      const latestPath = join(X_FIXTURES_DIR, "timeline-latest.json");
      writeFileSync(latestPath, rawJson, "utf-8");
      console.log(`Latest fixture: ${latestPath}`);
    }
  }

  // --- Parse and validate ---
  console.log("\n--- Response analysis ---");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    console.error("FAIL: Response is not valid JSON.");
    console.error("First 500 chars:", rawJson.slice(0, 500));
    return false;
  }

  // Check for API errors
  const asError = parsed as { errors?: Array<{ code: number; message?: string }> };
  if (Array.isArray(asError?.errors) && asError.errors.length > 0) {
    console.error("FAIL: X API returned errors:");
    for (const err of asError.errors) {
      console.error(`  code=${err.code} message="${err.message}"`);
    }
    return false;
  }

  // Navigate the response structure
  const response = parsed as Record<string, unknown>;
  const data = response.data as Record<string, unknown> | undefined;
  console.log(`Top-level keys: ${Object.keys(response).join(", ")}`);
  if (data) {
    console.log(`data keys: ${Object.keys(data).join(", ")}`);
    const home = data.home as Record<string, unknown> | undefined;
    if (home) {
      console.log(`data.home keys: ${Object.keys(home).join(", ")}`);
      const urt = home.home_timeline_urt as Record<string, unknown> | undefined;
      if (urt) {
        console.log(`data.home.home_timeline_urt keys: ${Object.keys(urt).join(", ")}`);
        const instructions = urt.instructions as unknown[] | undefined;
        if (instructions) {
          console.log(`Instructions: ${instructions.length}`);
          for (const instr of instructions) {
            const typed = instr as { type: string; entries?: unknown[] };
            console.log(`  type="${typed.type}" entries=${typed.entries?.length ?? "N/A"}`);
          }
        }
      }
    }
  }

  // --- Run through the capture-x pipeline directly (no desktop layer) ---
  console.log("\n--- Running capture-x parser pipeline ---");

  const { tweetsToFeedItems, deduplicateFeedItems: xDedup } = await import(
    join(ROOT, "packages/capture-x/src/normalize.ts")
  );

  // Navigate the response tree ourselves, same as x-capture.ts does
  const timelineResp = parsed as { data?: { home?: { home_timeline_urt?: { instructions?: unknown[] } } } };
  const homeData = timelineResp?.data?.home;
  const instructions = homeData?.home_timeline_urt?.instructions ?? [];

  if (instructions.length === 0) {
    console.error("FAIL: No timeline instructions found in response.");
    console.error("Response shape doesn't match expected TimelineResponse.");
    return false;
  }

  console.log(`Instructions found: ${instructions.length}`);

  // Extract tweets from instructions
  type AnyInstruction = { type: string; entries?: Array<{ content?: { itemContent?: { tweet_results?: { result: Record<string, unknown> } } } }> };
  const tweets: Record<string, unknown>[] = [];
  let instructionCount = 0;

  for (const instr of instructions as AnyInstruction[]) {
    if (instr.type === "TimelineAddEntries" && instr.entries) {
      instructionCount++;
      for (const entry of instr.entries) {
        const tweet = entry.content?.itemContent?.tweet_results?.result;
        if (tweet && (tweet.__typename === "Tweet" || tweet.__typename === "TweetWithVisibilityResults")) {
          tweets.push(tweet);
        }
      }
    }
  }

  console.log(`TimelineAddEntries instructions: ${instructionCount}`);
  console.log(`Tweets extracted: ${tweets.length}`);

  if (tweets.length === 0) {
    console.error("FAIL: No tweets extracted from instructions.");
    return false;
  }

  // Run normalization
  let feedItems;
  try {
    feedItems = tweetsToFeedItems(tweets as never[]);
  } catch (err) {
    console.error("tweetsToFeedItems threw:", err);
    console.error("First failed tweet:", JSON.stringify(tweets[0], null, 2).slice(0, 500));
    return false;
  }

  console.log(`FeedItems normalized: ${feedItems.length}`);
  const deduped = xDedup(feedItems);
  console.log(`After dedup: ${deduped.length}`);

  if (deduped.length > 0) {
    console.log(`\n  Sample tweets (first 3):`);
    deduped.slice(0, 3).forEach((item, i) => {
      console.log(`  [${i}] ${item.author?.displayName} (@${item.author?.handle})`);
      console.log(`      ${item.content?.text?.slice(0, 120) ?? "(no text)"}`);
      console.log(`      published: ${item.publishedAt ? new Date(item.publishedAt).toISOString() : "(null)"}`);
    });
  }

  console.log(`\nX: ${deduped.length > 0 ? "PASS" : "FAIL"} (${deduped.length} items)`);
  return deduped.length > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Freed Scraper Integration Test Harness");
  console.log(`Mode: ${offline ? "OFFLINE" : "LIVE"} | Save fixtures: ${saveFixtures}`);

  const results: Record<string, boolean> = {};

  if (runFb) {
    results.facebook = await testFacebook();
  }

  if (runX) {
    results.x = await testX();
  }

  console.log("\n" + "=".repeat(72));
  console.log("  SUMMARY");
  console.log("=".repeat(72));
  for (const [platform, passed] of Object.entries(results)) {
    console.log(`  ${platform}: ${passed ? "PASS" : "FAIL"}`);
  }

  const allPassed = Object.values(results).every(Boolean);
  console.log(`\nOverall: ${allPassed ? "ALL PASS" : "FAILURES DETECTED"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
