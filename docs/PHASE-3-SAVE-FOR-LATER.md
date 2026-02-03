# Phase 3: Save for Later (`capture-save`)

> **Status:** ✓ Complete  
> **Dependencies:** Phase 1-2 (Capture layers ✓)

---

## Overview

Independent capture layer for manually saved URLs. Follows the same architecture as `capture-x` and `capture-rss`.

---

## Package Structure

```
packages/capture-save/
├── src/
│   ├── index.ts          # Public API
│   ├── extract.ts        # URL metadata + content extraction
│   ├── readability.ts    # Article content parser
│   ├── normalize.ts      # URL -> FeedItem
│   └── types.ts          # Save-specific types
├── package.json
└── tsconfig.json
```

---

## Core Implementation

### URL Metadata Extraction

```typescript
// packages/capture-save/src/extract.ts
export interface UrlMetadata {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  author?: string;
  publishedAt?: number;
}

export async function extractMetadata(url: string): Promise<UrlMetadata> {
  const response = await fetch(url);
  const html = await response.text();

  // Parse Open Graph and meta tags
  const title =
    extractOgTag(html, "og:title") ||
    extractMetaTag(html, "title") ||
    extractTitleTag(html);

  const description =
    extractOgTag(html, "og:description") || extractMetaTag(html, "description");

  const imageUrl = extractOgTag(html, "og:image");
  const siteName = extractOgTag(html, "og:site_name");
  const author = extractMetaTag(html, "author");

  return { url, title, description, imageUrl, siteName, author };
}
```

### Article Content Extraction

```typescript
// packages/capture-save/src/readability.ts
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ExtractedContent {
  html: string;
  text: string;
  wordCount: number;
  readingTime: number;
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  const response = await fetch(url);
  const html = await response.text();

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Could not extract article content");
  }

  const wordCount = article.textContent.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / 200); // 200 WPM

  return {
    html: article.content,
    text: article.textContent,
    wordCount,
    readingTime,
  };
}
```

### Normalize to FeedItem

```typescript
// packages/capture-save/src/normalize.ts
import { FeedItem, PreservedContent } from "@freed/shared";
import { UrlMetadata } from "./extract";
import { ExtractedContent } from "./readability";

export function urlToFeedItem(
  metadata: UrlMetadata,
  content: ExtractedContent
): FeedItem {
  const preserved: PreservedContent = {
    html: content.html,
    text: content.text,
    author: metadata.author,
    wordCount: content.wordCount,
    readingTime: content.readingTime,
    preservedAt: Date.now(),
  };

  return {
    globalId: `saved:${metadata.url}`,
    platform: "saved",
    contentType: "article",
    capturedAt: Date.now(),
    publishedAt: metadata.publishedAt ?? Date.now(),
    author: {
      id: metadata.siteName ?? new URL(metadata.url).hostname,
      handle: new URL(metadata.url).hostname,
      displayName: metadata.siteName ?? new URL(metadata.url).hostname,
    },
    content: {
      text: metadata.description ?? content.text.slice(0, 300),
      mediaUrls: metadata.imageUrl ? [metadata.imageUrl] : [],
      mediaTypes: metadata.imageUrl ? ["image"] : [],
      linkPreview: {
        url: metadata.url,
        title: metadata.title,
        description: metadata.description,
        imageUrl: metadata.imageUrl,
      },
    },
    preservedContent: preserved,
    userState: {
      hidden: false,
      saved: true,
      savedAt: Date.now(),
      archived: false,
      tags: [],
    },
    topics: [],
  };
}
```

---

## OpenClaw Skill

```
skills/capture-save/
├── SKILL.md
├── src/
│   └── index.ts
└── package.json
```

### SKILL.md

```yaml
---
name: capture-save
description: Save any URL to your FREED library
user-invocable: true
metadata: {"requires": {"bins": ["bun"]}}
---

# Save for Later

Capture any URL to your FREED library with full article extraction.

## Usage

- `capture-save add <url>` - Save a URL
- `capture-save list` - List saved items
- `capture-save search <query>` - Search saved content

## What Gets Saved

- Page metadata (title, description, image)
- Full article content (reader view)
- Word count and reading time estimate
```

---

## Tasks

| Task | Description                                   | Complexity |
| ---- | --------------------------------------------- | ---------- |
| 3.1  | Create `@freed/capture-save` package scaffold | Low        |
| 3.2  | Implement URL metadata extraction             | Medium     |
| 3.3  | Implement Readability-style content parser    | Medium     |
| 3.4  | Normalize to FeedItem with PreservedContent   | Low        |
| 3.5  | Create OpenClaw skill wrapper                 | Low        |
| 3.6  | CLI commands (add, list, search)              | Medium     |

---

## Deliverable

`@freed/capture-save` package and OpenClaw skill for saving any URL with full article extraction.

---

## Dependencies

```json
{
  "dependencies": {
    "@freed/shared": "*",
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^24.0.0"
  }
}
```
