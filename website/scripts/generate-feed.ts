/**
 * RSS Feed Generator
 *
 * Run this after building to generate feed.xml in the dist folder.
 * Usage: npx tsx scripts/generate-feed.ts
 */

import { Feed } from "feed";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Import posts - we need to handle the React content differently
// This script extracts just the metadata for RSS
interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author?: string;
  tags?: string[];
}

// Define posts metadata directly here for build-time generation
// This avoids importing React components in Node context
const posts: PostMeta[] = [
  {
    slug: "introducing-freed",
    title: "Introducing Freed: Take Back Your Feed",
    description:
      "Our first newsletter. Why we built Freed, what we believe, and where we're headed.",
    date: "2026-02-01",
    author: "The Freed Team",
    tags: ["announcement", "philosophy"],
  },
];

const SITE_URL = "https://freed.wtf";
const SITE_TITLE = "Freed Updates";
const SITE_DESCRIPTION =
  "Progress updates, technical deep-dives, and philosophical rants about the attention economy. From the team building Freed.";

async function generateFeed() {
  const feed = new Feed({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    id: SITE_URL,
    link: SITE_URL,
    language: "en",
    image: `${SITE_URL}/favicon.svg`,
    favicon: `${SITE_URL}/favicon.svg`,
    copyright: `All rights reserved ${new Date().getFullYear()}, Freed Project`,
    feedLinks: {
      rss2: `${SITE_URL}/feed.xml`,
      atom: `${SITE_URL}/atom.xml`,
    },
    author: {
      name: "The Freed Team",
      link: SITE_URL,
    },
  });

  // Add posts to feed
  for (const post of posts) {
    const postUrl = `${SITE_URL}/updates/${post.slug}`;

    feed.addItem({
      title: post.title,
      id: postUrl,
      link: postUrl,
      description: post.description,
      date: new Date(post.date),
      author: post.author ? [{ name: post.author }] : undefined,
      category: post.tags?.map((tag) => ({ name: tag })),
    });
  }

  // Ensure dist directory exists
  const distDir = join(process.cwd(), "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Write RSS feed
  writeFileSync(join(distDir, "feed.xml"), feed.rss2());
  console.log("✓ Generated feed.xml");

  // Write Atom feed
  writeFileSync(join(distDir, "atom.xml"), feed.atom1());
  console.log("✓ Generated atom.xml");

  // Also copy to public for dev server
  const publicDir = join(process.cwd(), "public");
  writeFileSync(join(publicDir, "feed.xml"), feed.rss2());
  writeFileSync(join(publicDir, "atom.xml"), feed.atom1());
  console.log("✓ Copied feeds to public/");
}

generateFeed().catch(console.error);
