# Phase 3: Save for Later (`capture-save`)

> **Status:** Current  
> **Dependencies:** Phase 1-2 (Capture layers)
>
> Save for Later is functional across desktop and PWA. The Save Content dialog
> previews URL details before submission, suggests editable notes without
> replacing user input, and writes searchable notes with the saved item. Saved
> URLs then write a lightweight stub and Freed pulls article details in the
> background where the platform can fetch them. Existing manual saves can be
> edited to change their URL or notes. Desktop
> has full article extraction, local HTML caching, Markdown import/export,
> background fetch healing, user-visible AI controls, and hierarchical tag
> navigation. PWA saves sync-healed stubs for Freed Desktop to hydrate. Saved
> content is pinned in the device-local reader cache by default. Freed Desktop
> and the PWA page Saved rows through the same bounded SQLite query contract.
> The PWA uses SQLite WebAssembly over OPFS and retains no IndexedDB Library
> rows.

---

## Overview

Phase 3 covers manually saved URLs and the reader flow around them. The core
architecture is now:

1. Save a URL from desktop or PWA by writing a lightweight stub item.
2. Pull metadata plus article content in the background with Readability-safe
   browser parsing where the platform can fetch the page.
3. Keep full HTML in the device-local content vault, never in checkpoint rows.
4. Sync typed content descriptors and normalized preserved-text records through
   the Library Core protocol.
5. Render reader content through a layered waterfall:
   1. Local cached HTML
   2. Synced preserved text
   3. Platform hydration on open when online

---

## Shipped Behavior

### Save Flow

- **Desktop:** previews public URL metadata while the dialog remains editable,
  writes the saved stub after submission, and queues a priority background
  detail fetch that caches readable HTML locally and commits compact preserved
  text through a typed SQLite mutation.
- **PWA:** writes a saved stub immediately. Freed Desktop can hydrate the
  details after sync.
- **Editable searchable notes:** every save can carry a whole-item note through
  the synchronized annotation authority. Existing Library search indexes the
  note. Manual saves expose an edit state for both URL and notes.
- **Input ownership:** a fetched note suggestion fills only an untouched notes
  field. Once the user edits the field, no preview result can replace it.
- **Saved cache pinning:** saved URLs, posts, and stories enter the permanent
  device-local cache path when readable content is available. Unsaving does not
  immediately remove the local reader copy.
- **Post-save reader handoff:** after stub persistence succeeds, Freed switches
  to Saved and opens the newly saved item in reader mode while details load in
  the background.
- **Save failure recovery:** if stub persistence or background detail fetching
  fails for a user-initiated save, the Save Content dialog reopens with the URL
  and the error message.

### Reader And Cache Layers

- **Layer 1:** device-local HTML cache
  - Desktop uses Tauri FS
  - PWA uses the Cache API
- **Layer 2:** synced `preservedContent.text`
- **Layer 3:** on-demand reader hydration when online. Freed Desktop uses native
  fetch or provider-authenticated paths, while the PWA uses browser fetch where
  the web platform allows it.

### Library Management

- Freed Markdown import and export are implemented.
- Imported folder paths become hierarchical tags.
- Sidebar tag navigation supports parent and child tag filtering.

### AI Summaries

- Desktop background fetch can summarize newly cached saved articles.
- The AI settings section is available in Settings.
- Topic extraction now respects the `extractTopics` toggle instead of always
  writing topics whenever summarization succeeds.

---

## Tasks

| Task | Description | Status | Notes |
| ---- | ----------- | ------ | ----- |
| 3.1 | Create `@freed/capture-save` package scaffold | ✓ Complete | Package exists in `packages/capture-save/` |
| 3.2 | Implement browser-safe metadata and article extraction | ✓ Complete | Shared browser parser used by desktop and PWA |
| 3.3 | Implement desktop full save flow with local HTML cache | ✓ Complete | Saves a stub first, then uses Tauri `fetch_url` plus FS cache in the background |
| 3.4 | Implement PWA full save flow with fallback stub mode | ✓ Complete | Saves a stub immediately and returns a saved item id for reader navigation |
| 3.5 | Layered reader fallback for offline reading | ✓ Complete | Cache → preserved text → live fetch |
| 3.6 | Hierarchical tag navigation | ✓ Complete | Sidebar tag tree is live |
| 3.7 | Freed Markdown import/export | ✓ Complete | Import, export, and background fetch healing shipped |
| 3.8 | User-facing AI summarization controls | ✓ Complete | Settings UI is live, desktop-only key storage stays local |
| 3.9 | Broader mobile validation across hostile sites | ☐ Ongoing | Fallback stub mode remains intentional for blocked or oversized pages |
| 3.10 | Saved content pinned in local reader cache | ✓ Complete | Saved URLs, saved posts, and saved stories enter the high-priority local cache path |
| 3.11 | Bound Saved overview analytics on Freed Desktop | ✓ Complete | The overview reads exact source, content, and time-bucket aggregates from authenticated SQLite and fails closed when that bounded source is unavailable. |
| 3.12 | Complete bounded Saved reads on the PWA SQLite store | ✓ Complete | Official SQLite WebAssembly over OPFS executes the same named Saved queries and ordering contract as Freed Desktop. |
| 3.13 | Add searchable notes, pre-submit URL previews, and manual-save editing | ✓ Complete | Desktop and PWA share synchronized whole-item notes. The dialog shows preview activity, preserves user input, and edits URL or notes before persistence. |

---

## Current Constraints

- Save URL validation only accepts `http` and `https` URLs.
- Oversized background article fetches leave the saved stub in place and report
  the detail error to the user.
- AI summarization still runs on desktop because API key storage is device-local
  there.
- Phase 3 remains marked `Current` until broader mobile validation is complete,
  even though the missing core implementation gaps are now closed.
