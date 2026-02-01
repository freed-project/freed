# Phase 7: Facebook + Instagram Capture

> **Status:** Not Started  
> **Dependencies:** Phase 5 (Desktop App with Playwright)

---

## Overview

DOM scraping for Facebook and Instagram feeds. Requires the Desktop App's Playwright subprocess for headless browser automation.

**Note:** DOM scraping is inherently fragile. These platforms actively fight scrapers and frequently change their DOM structure. This is lower priority than X + RSS.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Desktop App                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Playwright Subprocess                   │   │
│  │                                                           │   │
│  │  ┌──────────────┐    ┌──────────────┐                    │   │
│  │  │  Facebook    │    │  Instagram   │                    │   │
│  │  │  Scraper     │    │  Scraper     │                    │   │
│  │  └──────┬───────┘    └──────┬───────┘                    │   │
│  │         │                   │                             │   │
│  │         └─────────┬─────────┘                             │   │
│  │                   ▼                                       │   │
│  │          ┌──────────────┐                                 │   │
│  │          │  Normalize   │                                 │   │
│  │          │  to FeedItem │                                 │   │
│  │          └──────────────┘                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/capture-facebook/
├── src/
│   ├── index.ts          # Public API
│   ├── scraper.ts        # DOM scraping logic
│   ├── selectors.ts      # CSS selectors (frequently updated)
│   ├── normalize.ts      # FB post -> FeedItem
│   └── types.ts          # FB-specific types
├── package.json
└── tsconfig.json

packages/capture-instagram/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## Core Implementation

### Facebook Scraper

```typescript
// packages/capture-facebook/src/scraper.ts
import { Page } from 'playwright-core';
import { SELECTORS } from './selectors';

export async function scrapeFacebookFeed(page: Page): Promise<RawFbPost[]> {
  await page.goto('https://www.facebook.com');
  await page.waitForSelector(SELECTORS.feed);
  
  // Scroll to load more posts
  await autoScroll(page, { maxScrolls: 10 });
  
  const posts = await page.$$eval(SELECTORS.post, (elements) => {
    return elements.map(el => ({
      id: el.getAttribute('data-pagelet'),
      authorName: el.querySelector('[data-ad-preview="message"]')?.textContent,
      content: el.querySelector('[data-ad-comet-preview="message"]')?.textContent,
      timestamp: el.querySelector('abbr')?.getAttribute('data-utime'),
      imageUrls: Array.from(el.querySelectorAll('img[src*="scontent"]'))
        .map(img => img.src),
      // ... more extraction
    }));
  });
  
  return posts;
}
```

### Instagram Scraper

```typescript
// packages/capture-instagram/src/scraper.ts
import { Page } from 'playwright-core';
import { SELECTORS } from './selectors';

export async function scrapeInstagramFeed(page: Page): Promise<RawIgPost[]> {
  await page.goto('https://www.instagram.com');
  await page.waitForSelector(SELECTORS.feed);
  
  await autoScroll(page, { maxScrolls: 10 });
  
  const posts = await page.$$eval(SELECTORS.post, (elements) => {
    return elements.map(el => ({
      id: el.getAttribute('data-testid'),
      authorHandle: el.querySelector(SELECTORS.authorHandle)?.textContent,
      content: el.querySelector(SELECTORS.caption)?.textContent,
      imageUrls: Array.from(el.querySelectorAll('img'))
        .filter(img => img.src.includes('cdninstagram'))
        .map(img => img.src),
      location: el.querySelector(SELECTORS.location)?.textContent,
      // ... more extraction
    }));
  });
  
  return posts;
}
```

### Selector Maintenance

```typescript
// packages/capture-facebook/src/selectors.ts
// These WILL break. Update frequently.
export const SELECTORS = {
  feed: '[role="feed"]',
  post: '[data-pagelet^="FeedUnit"]',
  authorName: 'h4 a strong',
  content: '[data-ad-comet-preview="message"]',
  timestamp: 'abbr[data-utime]',
  image: 'img[src*="scontent"]',
  // ... more selectors
};

// Version tracking for debugging
export const SELECTOR_VERSION = '2026-02-01';
```

---

## Session Management

```typescript
// packages/capture-facebook/src/session.ts
export interface SessionConfig {
  cookies: Cookie[];
  userAgent: string;
  viewport: { width: number; height: number };
}

export async function createAuthenticatedContext(
  browser: Browser,
  config: SessionConfig
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: config.viewport,
  });
  
  await context.addCookies(config.cookies);
  return context;
}

// Cookie extraction from browser
export async function extractCookiesFromBrowser(
  browser: 'chrome' | 'firefox'
): Promise<Cookie[]> {
  // Read from browser's cookie store
  // Handle encryption (Chrome on macOS)
}
```

---

## Rate Limiting

```typescript
// Avoid getting banned
const RATE_LIMITS = {
  facebook: {
    minInterval: 5 * 60 * 1000,  // 5 minutes between scrapes
    maxPostsPerScrape: 50,
    cooldownOnError: 30 * 60 * 1000,  // 30 min cooldown if blocked
  },
  instagram: {
    minInterval: 10 * 60 * 1000,  // 10 minutes
    maxPostsPerScrape: 30,
    cooldownOnError: 60 * 60 * 1000,  // 1 hour cooldown
  },
};
```

---

## Tasks

| Task | Description | Complexity |
|------|-------------|------------|
| 7.1 | `@freed/capture-facebook` package scaffold | Low |
| 7.2 | `@freed/capture-instagram` package scaffold | Low |
| 7.3 | Facebook DOM selectors | Medium |
| 7.4 | Instagram DOM selectors | Medium |
| 7.5 | Feed scraping logic | High |
| 7.6 | Stories capture | High |
| 7.7 | Session/cookie management | Medium |
| 7.8 | Rate limiting to avoid bans | Medium |
| 7.9 | Selector maintenance strategy | Medium |
| 7.10 | Location extraction (for Phase 8) | Medium |

---

## Success Criteria

- [ ] Facebook feed posts captured to FeedItem
- [ ] Instagram feed posts captured to FeedItem
- [ ] Location data extracted from Instagram posts
- [ ] Stories captured (if feasible)
- [ ] Rate limiting prevents account bans
- [ ] Selector updates can be deployed quickly

---

## Risks

| Risk | Mitigation |
|------|------------|
| DOM changes frequently | Version selectors, monitor for breakage, quick update process |
| Account bans | Conservative rate limiting, human-like scrolling |
| Anti-bot detection | Realistic user agents, viewport sizes, mouse movements |
| Legal concerns | User captures their own data, no central server |

---

## Deliverable

`@freed/capture-facebook` and `@freed/capture-instagram` packages for DOM-based feed capture. Most location data for Friend Map comes from here.
