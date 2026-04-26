# Phase 1: Foundation

> **Status:** ✅ Complete  
> **Dependencies:** None

---

## Overview

Core infrastructure for the Freed project: monorepo setup, shared types, Automerge CRDT schema, marketing site, and CI/CD pipeline.

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
export type ThemeId =
  | "neon"
  | "midas"
  | "vesper"
  | "ember"
  | "porcelain";

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
  updates: Partial<FeedItem>
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

Next.js 15 (App Router) site deployed to Vercel at freed.wtf.

**Pages:**

- Landing page with hero, features, how-it-works
- Manifesto page
- Roadmap page
- Updates/blog with RSS feed
- QR concept gallery page for fullscreen presentation links

**Features:**

- Static Site Generation (SSG) for SEO
- Newsletter signup (Brevo via Next.js Route Handler with staged email capture, Turnstile, and optional phone collection)
- Auto-generated sitemap.xml
- RSS/Atom feed generation at build time
- Public legal pages for Terms of Use, Privacy, and Desktop EULA
- Get Freed modal now scrolls internally on small screens, removes the extra mobile subtitle under the main title, keeps the mobile signup and launch headings on matching vertical spacing, simplifies the mobile section copy, gives the mobile launch CTA a primary-tinted treatment, closes reliably from the `X` button even on direct `/get` visits, and defaults real mobile devices to a `Freed Web` launch target while still offering every desktop download explicitly
- Mobile homepage hero now shows a direct email entry form that prefills the protected Get Freed signup flow, while desktop keeps the modal-first newsletter and download CTA
- Mobile nav header now keeps a top-level `Get Freed` CTA beside the hamburger once the user scrolls away from the top of the homepage or lands on any non-home page, animating it in smoothly while the full mobile menu still exposes the same primary action inside the drawer
- Marketing homepage now stays in its single-column mobile layout through tablet widths, including the mobile nav, compact hero treatment, and stacked content grids, before switching to desktop layouts at `lg`
- Marketing-site manifesto buttons now use the shared theme secondary button treatment consistently, including both `Read the Manifesto` and `Why We Built This`
- Shared cross-surface theme system for the marketing site, Freed Desktop, and the PWA
- Neon now uses the original randomized marketing-site background logic as the canonical shared theme background across the marketing site, Freed Desktop, and Freed Web, while the other themes keep their current shared rendering
- Marketing site no longer inherits the shared app scrollbar chrome, while Freed Desktop and Freed Web keep the themed scrollbar treatment inside app shells and dialogs
- Theme-aware form controls across the marketing site and shared UI package
- Shared theme-aware tooltip primitive across the marketing site and shared UI package
- Homepage footer theme picker uses the same preview swatches as Freed Desktop, with hover tooltips for each theme plus live hover and focus previews that blur between themes and snap back unless the user clicks
- Five authored themes: Neon, Midas, Vesper, Ember, and Scriptorium
- Synced theme preference with `Neon` as the default for fresh installs
- Mobile-responsive design
- Mobile landing layout uses wider gutters, denser feature and step cards, and a compact hero animation footprint for tighter one-hand browsing
- Glassmorphic dark theme
- Full accessibility support (skip links, ARIA labels, focus states)
- `prefers-reduced-motion` support
- Public `/qr` gallery with five poster-style QR concepts for `freed.wtf`

**Remaining Work:**

- [x] Transition to Vercel for Edge function utilities.
- [x] Transition from Vite to Next.js for better SEO and accessibility.
- [x] Finish first updates blog post (001-introducing-freed)
- [x] Finish the manifesto
- [ ] Complete newsletter subscription system:
  - [x] Wire `NewsletterModal` form to `POST /api/subscribe`
  - [x] Finalize Brevo list mapping and list settings
  - [ ] Import existing 90k subscribers
  - [ ] Add one-click endpoint smoke test before release
  - [x] Set `BREVO_API_KEY` and `BREVO_LIST_ID` in Vercel
  - [x] Add Turnstile verification, a honeypot field, and basic abuse throttling to `/api/subscribe`
  - [x] Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `freed-www`
  - [ ] Configure freed.wtf domain in Vercel
- [ ] Send our first email newsletter
- [ ] Fix navigation bar vertical clipping on overscroll (iOS/macOS bounce)
- [ ] Finish Unified Feed icon (wave design)
- [ ] Finish Ulysses Mode icon (mermaid/siren design)

#### Newsletter Infrastructure

The newsletter system uses Brevo for contact management and email delivery, proxied through a Next.js Route Handler to keep API keys server-side. The public signup route now uses a staged flow that asks for email first, then name, optional phone, and Cloudflare Turnstile verification before the final confirmation step. It also uses a honeypot field and light server throttling to cut down on bot abuse.

**Setup:**

1. Brevo account with API key and contact list
2. Vercel project with environment variables: `BREVO_API_KEY`, `BREVO_LIST_ID`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
3. Frontend calls `/api/subscribe` (same domain, no CORS)
4. Use this smoke command to verify the endpoint before launch:

```bash
curl -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

### Desktop and PWA follow up

- Add a recurring invite banner in Freed Desktop and app.freed.wtf to nudge users to join the newsletter after they run the desktop app.

**Files:**

| File                                         | Purpose                       |
| -------------------------------------------- | ----------------------------- |
| `website/src/app/api/subscribe/route.ts`     | Next.js Route Handler (Brevo) |
| `website/src/components/NewsletterModal.tsx` | Modal component               |
| `website/src/components/TurnstileWidget.tsx` | Signup protection widget      |
| `website/src/context/NewsletterContext.tsx`  | Modal state management        |

**Cost:** Free tier for both Brevo (contact storage) and Vercel (Hobby plan). ~$10-25 per bulk email send.

### 4. CI/CD Pipeline

GitHub Actions workflows for continuous integration and deployment.

**CI (`ci.yml`):**

- TypeScript type checking
- ESLint
- Build verification
- Runs on all PRs and pushes to `dev` and `main`

**Deploy (Vercel):**

Two Vercel projects now follow a dev-first branch flow with preview deploys on PRs:

| Project      | Root Directory   | Domain                                          |
| ------------ | ---------------- | ------------------------------------------------ |
| `freed-www`  | `website/`       | [freed.wtf](https://freed.wtf)                   |
| `freed-pwa`  | `packages/pwa/`  | [app.freed.wtf](https://app.freed.wtf)           |

Branch routing:

- `dev` deploys to `dev.freed.wtf`
- `dev` deploys to `dev-app.freed.wtf`
- `www` deploys to `freed.wtf`
- `main` deploys to `app.freed.wtf`

Website preview and production deploys now come from Vercel Git integration on the `www` branch. The PWA still uses `./scripts/vercel-deploy-preview.sh pwa` and `./scripts/vercel-deploy-production.sh pwa` because raw subdirectory deploys can upload an incomplete monorepo slice and fail during install.

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
| 1.3  | Implement Automerge document schema          | ✓ (bugfixes: toggleSaved delete, updatePreferences deepMerge) |
| 1.4  | Build marketing site (landing, manifesto)    | ✓      |
| 1.5  | Set up GitHub Actions CI/CD                  | ✓      |
| 1.6  | Configure custom domain (freed.wtf)          | ✓      |
| 1.7  | Add newsletter signup with Next.js Route Handler (Brevo) | ✓      |
| 1.8  | Add Roadmap and Updates pages                | ✓      |
| 1.9  | Generate RSS feed at build time              | ✓      |
| 1.10 | Add public legal docs and versioned website clickwrap | ✓ |
| 1.11 | Add unified shared theme system across website, Freed Desktop, and PWA | ✓ |

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
      "next": "^15.0.0",
      "react": "^19.0.0",
      "framer-motion": "^12.0.0",
      "feed": "^5.0.0"
    },
    "devDependencies": {
      "tailwindcss": "^4.0.0",
      "typescript": "^5.0.0"
    }
  }
}
```
