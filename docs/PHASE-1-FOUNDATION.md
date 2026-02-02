# Phase 1: Foundation

> **Status:** ✓ Complete  
> **Dependencies:** None

---

## Overview

Core infrastructure for the FREED project: monorepo setup, shared types, Automerge CRDT schema, marketing site, and CI/CD pipeline.

---

## Deliverables

### 1. Monorepo Structure

```
freed/
├── packages/
│   └── shared/          # @freed/shared - Core types and Automerge schema
├── skills/              # OpenClaw skill wrappers
├── website/             # Marketing site (freed.wtf)
├── docs/                # Phase implementation plans
├── .github/workflows/   # CI/CD
├── tsconfig.base.json   # Shared TypeScript config
└── package.json         # Workspace root
```

### 2. Shared Package (`@freed/shared`)

Core types and Automerge document schema used by all capture layers.

#### Types (`packages/shared/src/types.ts`)

```typescript
// Platform types
export type Platform =
  | "x"
  | "rss"
  | "youtube"
  | "reddit"
  | "mastodon"
  | "github"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "saved";

export type ContentType = "post" | "story" | "article" | "video" | "podcast";

// Core feed item structure
export interface FeedItem {
  globalId: string; // "platform:id" format
  platform: Platform;
  contentType: ContentType;
  capturedAt: number;
  publishedAt: number;
  author: Author;
  content: Content;
  engagement?: Engagement;
  location?: Location;
  rssSource?: RssSourceInfo;
  preservedContent?: PreservedContent;
  userState: UserState;
  topics: string[];
  priority?: number;
}

// User preferences for feed ranking
export interface UserPreferences {
  weights: WeightPreferences; // Author, topic, platform weights
  ulysses: UlyssesPreferences; // Feed blocking settings
  sync: SyncPreferences; // Cloud backup config
  display: DisplayPreferences; // UI settings
  xCapture: XCapturePreferences; // X capture mode and lists
}
```

#### Automerge Schema (`packages/shared/src/schema.ts`)

```typescript
// Root document structure for CRDT sync
export interface FreedDoc {
  feedItems: Record<string, FeedItem>; // All captured content
  rssFeeds: Record<string, RssFeed>; // RSS subscriptions
  preferences: UserPreferences; // User settings
  meta: DocumentMeta; // Device ID, sync state
}

// CRUD operations
export function addFeedItem(doc: FreedDoc, item: FeedItem): void;
export function updateFeedItem(
  doc: FreedDoc,
  globalId: string,
  updates: Partial<FeedItem>,
): void;
export function removeFeedItem(doc: FreedDoc, globalId: string): void;
export function markAsRead(doc: FreedDoc, globalId: string): void;
export function toggleSaved(doc: FreedDoc, globalId: string): void;

// Query helpers
export function getFeedItemsSorted(doc: FreedDoc): FeedItem[];
export function getSavedItems(doc: FreedDoc): FeedItem[];
export function getUnreadItems(doc: FreedDoc): FeedItem[];
```

### 3. Marketing Website

Vite + React + TypeScript site deployed to GitHub Pages at freed.wtf.

**Pages:**

- Landing page with hero, features, how-it-works
- Manifesto page
- Roadmap page
- Updates/blog with RSS feed

**Features:**

- Newsletter signup (Brevo via Cloudflare Worker)
- RSS feed generation at build time
- Mobile-responsive design
- Glassmorphic dark theme

**Remaining Polish:**

- [ ] Finish Unified Feed icon (wave design)
- [ ] Finish Ulysses Mode icon (mermaid/siren design)

#### Newsletter Infrastructure

The newsletter system uses Brevo for contact management and email delivery, proxied through a Cloudflare Worker to keep API keys server-side.

**Setup:**

1. Brevo account with API key and contact list
2. Cloudflare Worker deployed at `workers/newsletter-subscribe/`
3. Environment variables: `BREVO_API_KEY`, `BREVO_LIST_ID`, `ALLOWED_ORIGIN`

**Files:**

| File | Purpose |
|------|---------|
| `workers/newsletter-subscribe/worker.js` | Cloudflare Worker (Brevo proxy) |
| `workers/newsletter-subscribe/wrangler.toml` | Worker configuration |
| `website/src/components/NewsletterModal.tsx` | Modal component |
| `website/src/context/NewsletterContext.tsx` | Modal state management |

**Cost:** Free tier for both Brevo (contact storage) and Cloudflare Workers. ~$10-25 per bulk email send.

### 4. CI/CD Pipeline

GitHub Actions workflows for continuous integration and deployment.

**CI (`ci.yml`):**

- TypeScript type checking
- ESLint
- Build verification
- Runs on all PRs and pushes to main

**Deploy (`deploy.yml`):**

- Builds website
- Deploys to GitHub Pages
- Triggered on push to main

---

## Key Decisions

| Decision                          | Rationale                                 |
| --------------------------------- | ----------------------------------------- |
| Automerge CRDT                    | Conflict-free sync without central server |
| Record<string, T> for collections | CRDT-friendly map operations              |
| Unix timestamps                   | Simple, portable, sortable                |
| `globalId` = "platform:id"        | Unique across all sources                 |
| TypeScript monorepo               | Shared types, single build system         |

---

## Tasks

| Task | Description                                  | Status |
| ---- | -------------------------------------------- | ------ |
| 1.1  | Initialize monorepo with npm workspaces      | ✓      |
| 1.2  | Create `@freed/shared` with core types       | ✓      |
| 1.3  | Implement Automerge document schema          | ✓      |
| 1.4  | Build marketing site (landing, manifesto)    | ✓      |
| 1.5  | Set up GitHub Actions CI/CD                  | ✓      |
| 1.6  | Configure custom domain (freed.wtf)          | ✓      |
| 1.7  | Add newsletter signup with Cloudflare Worker | ✓      |
| 1.8  | Add Roadmap and Updates pages                | ✓      |
| 1.9  | Generate RSS feed at build time              | ✓      |

---

## Dependencies

```json
{
  "@freed/shared": {
    "dependencies": {
      "@automerge/automerge": "^2.0.0"
    }
  },
  "website": {
    "dependencies": {
      "react": "^19.0.0",
      "react-router-dom": "^7.0.0",
      "framer-motion": "^12.0.0",
      "feed": "^4.0.0"
    },
    "devDependencies": {
      "vite": "^7.0.0",
      "tailwindcss": "^4.0.0",
      "typescript": "^5.0.0"
    }
  }
}
```
