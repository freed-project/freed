# Phase 12: Additional Platforms

> **Status:** 🚧 In Progress: LinkedIn and YouTube are integrated, and authenticated Substack and Medium capture is available in beta with local sessions, visible roster and activity extraction, provider health controls, and connection-only identity ingestion
> **Dependencies:** Phase 5 (Desktop App), Phase 7 (Facebook/Instagram patterns)

---

## Overview

Expand capture to more platforms. Each platform gets its own capture layer package, following the patterns established in earlier phases.

---

## Packages

### `@freed/capture-linkedin`

Professional network posts and articles, now fully surfaced in the desktop app with the same provider health summaries and pause controls as the other social sources.

```
packages/capture-linkedin/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**

- LinkedIn aggressively blocks automation
- Session management more complex than other platforms
- May require browser profile approach rather than cookies

---

### `@freed/capture-substack` and `@freed/capture-medium` beta

Authenticated essay networks are first-class beta sources in Freed Desktop.
Each source uses an isolated native WebView session for login and visible page
capture. Browser-safe capture packages normalize rendered activity and roster
records into `FeedItem` and `Account` records.

```
packages/capture-substack/
  src/browser.ts
  src/normalize.ts
  src/types.ts
  package.json

packages/capture-medium/
  src/browser.ts
  src/normalize.ts
  src/types.ts
  package.json
```

**Beta behavior:**

- Substack and Medium appear in Sources, Settings, source filters, provider
  health, sync status, diagnostics, and legal risk controls with visible Beta
  labels.
- Login cookies and session state stay in provider-specific WebView data stores
  on Freed Desktop. Each connected source reuses one validated browser identity
  across login, auth checks, captures, and app restarts until disconnect.
- Native event bridge access is limited to each hidden scraper window while it
  is on that provider's own web origin. Visible login windows and third party
  sign in pages receive no Freed IPC permissions.
- Post-login, manual, and scheduled capture read rendered follower, following,
  subscription, activity, and essay surfaces where the provider makes them
  visible. Roster surfaces use randomized scrolling with ceilings of 500
  unique identities per graph run, 20 extraction passes, and 60 seconds per
  surface. Navigation chrome and links to individual essays are rejected as
  roster identities. Redirects to any unexpected provider route fail closed
  before cards can be assigned the wrong relationship or essay role.
- Roster records become social `Account` records with
  `discoveredFrom: "follow_roster"`. Identity repair can create provisional
  `connection` people for human profiles, but never promotes them to friends.
  Publication-only Substack and Medium identities remain unlinked accounts and
  are not offered as friend candidates. Accounts retain the follower,
  following, and subscription directions observed across partial roster
  captures.
- Partial roster captures can add or refresh accounts. They never infer an
  unfollow from a missing rendered row.
- Authenticated item authors become accounts in the same atomic reconciliation,
  including when capture upgrades an existing RSS record without changing the
  feed item count. Existing accounts gain richer names and avatars without
  losing connection links. Distinct people acting on the same essay remain
  distinct activity records.
- Authenticated capture shares the native social session lock, memory
  preflight, background runtime coordinator, randomized pacing, cooldowns,
  provider health, and scrape outcome telemetry.
- A dedicated randomized scheduler runs authenticated beta capture outside the
  existing RSS poll job. The next allowed capture time persists separately from
  auth state, so an app restart or disconnect cannot bypass the randomized
  cooldown. A cooldown defers locally before any provider page is opened and
  schedules one retry after the remaining deadline instead of polling
  throughout the cooldown.
- Publication and author RSS feeds remain the preferred path for full public
  essay bodies. Users add those feeds through the existing RSS source. RSS and
  authenticated captures share canonical essay identities, enrich the same
  record in either sync order, consolidate preexisting RSS and authenticated
  duplicates, and preserve the chosen item ID and all merged user state.
  Provider-classified RSS articles remain visible and counted under both their
  provider source and Feeds.
  Medium custom domain feeds are recognized from their feed generator metadata.
  Freed Desktop writes complete provider RSS text to the device-local reader
  cache before synced text is compacted. A richer RSS body replaces a cached
  placeholder, a longer local article is preserved, and cache failures do not
  block feed ingestion.

**Privacy boundaries:**

- Substack subscriber management pages are blocked from extraction.
- Subscriber email addresses, paid status, subscriber metadata, direct
  messages, private chats, and private audience tools are out of scope.
- Subscriber-only essay bodies are not archived through authenticated page
  capture. Both the DOM extractor and browser-safe normalizer enforce this
  boundary.
- Restacks, likes, and claps retain only explicit activity labels and linked
  titles. Embedded essay excerpts are not archived as activity text.
- Incidental author links do not become roster accounts. A rendered profile
  needs an explicit follower, following, or subscription role.
- Raw page data, cookies, and provider sessions do not enter Automerge,
  diagnostics, or bug reports.

**Known beta limits:**

- Provider DOM and route changes can reduce visible results until selectors are
  updated.
- Capture is deliberately bounded and does not script clicks or unbounded
  scrolling. Rosters larger than 500 visible identities per graph run remain
  partial and may require later conservative pagination work.
- Medium marks its API unsupported and does not allow new integrations, so the
  beta uses authenticated website extraction instead of an official token
  integration.
- The installed beta still needs real-account selector validation and an
  attributable soak before it can leave beta.

---

### `@freed/capture-mozi`

Private social planning network focused on trips, being-in-town windows, event attendance, and overlap signals.

```
packages/capture-mozi/
├── src/
│   ├── index.ts
│   ├── extractor.ts      # Structured payload capture from authenticated WebView
│   ├── selectors.ts      # DOM fallback selectors for visible cards and details
│   ├── normalize.ts      # Mozi activity -> FeedItem
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Approach:**

- Desktop-only authenticated source via Tauri WebView against `app.mozi.app`
- Prefer structured network payloads or embedded page data when available
- Fall back to DOM extraction only for fields the payload does not expose
- Normalize plans, trips, event attendance, and other visible planning activity into unified `FeedItem` records

**Why it matters:**

- Mozi is not a generic content feed or an RSS source
- The value is future-aware social planning data, not passive scrolling
- Captured items should eventually power Friend identity, time-aware map playback, and derived overlap views

**Desktop integration target:**

- Sources settings section with login, auth check, disconnect, and sync actions
- Sidebar source presence and source status indicator
- Sync status panel parity with LinkedIn
- Feed filtering parity with other desktop-authenticated sources

**Challenges:**

- Authenticated phone-based flow may require more brittle session handling than cookie-only providers
- The most useful items are future-dated, which means downstream consumers need time-window semantics
- Some overlap value is derived from multiple captured items and should not be persisted as canonical source content

---

### `@freed/capture-tiktok`

Short-form video feed.

```
packages/capture-tiktok/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Challenges:**

- Heavy anti-bot measures
- Video-first content doesn't fit text-based FeedItem as well
- May need different capture strategy (API if available, or accept limitations)

---

### `@freed/capture-threads`

Meta's Twitter competitor.

```
packages/capture-threads/
├── src/
│   ├── index.ts
│   ├── scraper.ts
│   ├── selectors.ts
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Approach TBD:**

- May have RSS support by then
- Shares infrastructure with Instagram (same Meta ecosystem)
- Could potentially reuse Instagram session

---

### `@freed/capture-bluesky`

Decentralized Twitter alternative built on AT Protocol.

```
packages/capture-bluesky/
├── src/
│   ├── index.ts
│   ├── client.ts         # AT Protocol client
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Advantages:**

- Open AT Protocol with official API
- No scraping required. It has legitimate API access.
- Federation-friendly architecture
- App passwords for authentication

**Implementation:**

```typescript
// packages/capture-bluesky/src/client.ts
import { BskyAgent } from "@atproto/api";

export async function getTimeline(
  agent: BskyAgent,
  cursor?: string
): Promise<TimelineResponse> {
  return agent.getTimeline({ cursor, limit: 50 });
}
```

---

### `@freed/capture-reddit`

Reddit posts and comments (beyond RSS).

```
packages/capture-reddit/
├── src/
│   ├── index.ts
│   ├── client.ts         # Reddit API client
│   ├── normalize.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

**Note:** `capture-rss` already handles Reddit via RSS feeds. This package adds:

- Home feed (personalized, requires auth)
- Saved posts
- Comment threads
- Upvote/downvote state

**API Access:**

- Reddit API requires OAuth app registration
- Rate limits: 60 requests/minute with OAuth
- Consider Reddit's API pricing changes

---

### `@freed/capture-youtube`

YouTube subscription capture, focused playback, exact-video application handoff,
and a private user-owned playlist through the user's authenticated website
session. Future work adds an audio-first offline media path through Freed Desktop.

```
packages/capture-youtube/
├── src/
│   ├── index.ts
│   ├── browser.ts        # Browser-safe capture exports for Freed Desktop
│   ├── normalize.ts      # Website channels and videos -> accounts/items
│   ├── constants.ts      # Canonical YouTube page and watch URLs
│   └── types.ts
├── test/
│   └── normalize.test.ts
├── package.json
└── tsconfig.json
```

**Authenticated website behavior:**

- Freed Desktop maintains a persistent YouTube WebView data store, matching the
  existing authenticated provider pattern.
- The interactive login window hides as soon as authentication is confirmed.
  Initial capture continues in the same persistent background session.
- An explicit sync captures the signed-in user's followed-channel roster and
  recent Subscriptions page video cards.
- Dev-channel installed builds can start that same explicit sync through the
  terminal trigger, with the existing authenticated session, pause state,
  cooldowns, and provider-safe retry spacing intact.
- Routine scheduled refreshes capture only recent Subscriptions videos. Full
  roster reconciliation stays with post-login and explicit manual syncs.
- Complete roster captures reconcile unfollows. Partial captures can add or
  refresh accounts, but never infer that a missing channel was unfollowed.
- Selected playlist actions use YouTube's normal Save and playlist dialogs in
  the same website session.
- No YouTube developer project, Google OAuth grant, Data API client, shared
  quota, or central subscription service is required.
- Provider cookies, session state, raw responses, and page data stay on Freed
  Desktop and never enter Automerge, logs, or diagnostics.

`capture-rss` continues to handle public YouTube channel feeds that a user adds
directly. It is a separate manual intake mode. The authenticated roster is not
discovered through RSS, and Freed does not generate an RSS subscription for each
captured channel.

This package adds:

- The authenticated user's subscription roster
- Stable YouTube channel accounts in the Freed identity graph
- Recent video cards from the normal Subscriptions page
- Long-form filtering that keeps Shorts and Reels out of the focused feed
- Normalization of website data into stable `FeedItem` identities
- Creation and reuse of a private `Freed Offline` playlist through website
  controls
- Bounded, serialized insertion of user-selected videos into that playlist,
  with device-local progress checkpoints and batches capped at 25 actions

The integration intentionally does not import the algorithmic Home feed, Watch
Later, or watch history. Freed owns a normal private playlist so saved study
material has one deliberate destination.

The shared reader adds two playback paths:

- `Watch here in Focus Mode` loads one click-to-load YouTube embed with no autoplay or
  automatic next video.
- `Play in YouTube` uses a canonical watch URL so iOS can open the exact video
  through YouTube's Universal Link.

YouTube Premium downloads remain inside YouTube. Freed adds a selected video to
`Freed Offline` and opens that playlist. The user chooses the playlist download
inside YouTube, and Freed does not claim to detect download completion.

**Future direct media path:**

- Freed Desktop resolves and packages one user-selected video locally.
- Audio-only AAC is the first rendition. Optional H.264 and AAC video follows
  only after audio passes real iPhone offline and locked-screen acceptance.
- The PWA receives media over an authenticated LAN endpoint first, then through
  chunk-encrypted objects in the user's configured cloud when Desktop is away.
- Large media lives in the PWA Origin Private File System and never in Automerge.
- iPhone downloads remain foreground, resumable jobs because Safari cannot be
  trusted to finish a large PWA transfer after lock or app switching.
- A Freed-hosted media relay is a later decision because it increases privacy,
  cost, provider differentiation, retention, and shared-failure risk.

See [YouTube Focus and Offline Integration](YOUTUBE-INTEGRATION.md) for the
current website-session behavior, Premium handoff, PWA storage boundaries,
audio-first resolver plan, encryption, provider risk, milestones, and tests.

---

## Tasks

| Task  | Description                                | Complexity | Status |
| ----- | ------------------------------------------ | ---------- | ------ |
| 12.1  | `@freed/capture-linkedin` package scaffold | Low        | ✓ Done |
| 12.2  | LinkedIn DOM selectors                     | High       | ✓ Done |
| 12.3  | LinkedIn session management                | High       | ✓ Done |
| 12.4  | LinkedIn desktop source integration        | Medium     | ✓ Done |
| 12.5  | LinkedIn regression test coverage          | Medium     | ✓ Done |
| 12.6  | `@freed/capture-mozi` package scaffold     | Low        |        |
| 12.7  | Mozi auth and session flow research        | High       |        |
| 12.8  | Mozi extraction strategy: payload first    | High       |        |
| 12.9  | Mozi desktop source integration            | Medium     |        |
| 12.10 | Mozi regression test coverage              | Medium     |        |
| 12.11 | `@freed/capture-tiktok` package scaffold   | Low        |        |
| 12.12 | TikTok capture strategy research           | High       |        |
| 12.13 | `@freed/capture-threads` package scaffold  | Low        |        |
| 12.14 | Threads capture (similar to Instagram)     | Medium     |        |
| 12.15 | `@freed/capture-bluesky` package scaffold  | Low        |        |
| 12.16 | Bluesky AT Protocol client                 | Medium     |        |
| 12.17 | Bluesky authentication flow                | Medium     |        |
| 12.18 | `@freed/capture-reddit` package scaffold   | Low        |        |
| 12.19 | Reddit OAuth setup                         | Medium     |        |
| 12.20 | Reddit home feed capture                   | Medium     |        |
| 12.21 | `@freed/capture-youtube` package scaffold  | Low        | ✓ Done |
| 12.22 | YouTube authenticated website-session capture | High    | ✓ Done |
| 12.23 | YouTube roster and Subscriptions page capture | High    | ✓ Done |
| 12.24 | Focus player and exact-video handoff       | Medium     | ✓ Done |
| 12.25 | Private `Freed Offline` playlist through website controls | High | ✓ Done |
| 12.26 | Persistent YouTube WebView session and recovery | Medium | ✓ Done |
| 12.27 | Desktop audio resolver and package laboratory | High   |        |
| 12.28 | Authenticated LAN media transfer to PWA    | High       |        |
| 12.29 | PWA offline audio storage and locked-screen validation | High |        |
| 12.30 | Encrypted user-cloud media transfer        | High       |        |
| 12.31 | Optional offline video rendition           | High       |        |
| 12.32 | Hosted relay measurement and owner decision | High      |        |
| 12.33 | YouTube installed-build terminal sync trigger | Low      | ✓ Done |
| 12.34 | Substack and Medium browser-safe capture packages | Medium | ✓ Done |
| 12.35 | Isolated authenticated WebView login and disconnect flows | High | ✓ Done |
| 12.36 | Bounded visible roster traversal plus activity and essay extraction | High | ✓ Done |
| 12.37 | Atomic follow-roster and activity reconciliation | High | ✓ Done |
| 12.38 | Beta source UI, consent, health, filtering, and diagnostics | Medium | ✓ Done |
| 12.39 | Normalizer, DOM extractor, auth, health, and desktop workflow coverage | Medium | ✓ Done |
| 12.40 | Scheduled refresh with restart-safe local cooldowns | High | ✓ Done |
| 12.41 | Installed Substack and Medium selector soak | High | 🚧 In Progress |
| 12.42 | Device-local provider RSS essay body preservation | Medium | ✓ Done |
| 12.43 | Origin-scoped native event bridge capabilities | High | ✓ Done |

---

## Success Criteria

- [x] LinkedIn feed posts captured to FeedItem
- [x] LinkedIn is visible in desktop Sources navigation and source status UI
- [x] LinkedIn shares the Desktop scraper window modes: shown, cloaked, hidden
- [x] LinkedIn background scrape and auth-check WebViews force provider media silent
- [x] LinkedIn desktop flows have regression coverage in Playwright
- [x] LinkedIn shares the desktop provider health summaries, rate-limit pause state, resume controls, and the unified provider section used in Settings and Debug panel cards
- [x] LinkedIn shares the same provider severity colors and per-provider sync spinner behavior as the other social sources
- [x] LinkedIn login stays open after auth so users can finish platform prompts while sync starts, then closes only after scrape startup health is confirmed
- [x] LinkedIn post-login sync uses the user's selected scraper window mode instead of switching modes for the first scrape
- [x] LinkedIn zero-post runs now fail with local DOM diagnostics for candidate counts, activity URNs, login chrome, feed containers, and URL instead of clearing the last capture error as a successful empty sync
- [x] Substack and Medium appear as Beta sources with isolated authenticated
      WebView sessions, provider risk consent, source filters, sync state, and
      provider health controls
- [x] Visible Substack and Medium roster records reconcile atomically as
      `follow_roster` accounts, create provisional connections only for human
      profiles, never create friends, and retain every observed relationship
      direction
- [x] Visible notes, stories, responses, comments, highlights, and linked essays
      normalize into stable feed items without turning incidental authors into
      roster accounts
- [x] Substack and Medium RSS articles enrich authenticated essay records
      without duplicate items or lost saved, read, archive, and tag state
- [x] Complete Substack and Medium essay text supplied by a user-added RSS feed
      is cached locally before sync compaction, including under a reconciled
      legacy RSS item ID
- [x] Authenticated essay capture shares the native social session lock, memory
      preflight, randomized pacing, cooldowns, and scrape outcome telemetry
- [x] Roster traversal stops at the visible end of each surface, 500 unique
      identities across the graph run, 20 extraction passes, or 60 seconds,
      rejects navigation and essay links, fails closed on unexpected redirects,
      and never opens subscriber management surfaces
- [x] One validated Safari or WebView browser identity is reused across login,
      auth checks, capture, and app restarts until the source is disconnected
- [x] Hidden scraper WebViews can emit only from the matching Substack or
      Medium origin, with no Freed IPC access in visible login windows or on
      third party sign in pages
- [x] Authenticated Substack and Medium sessions use a dedicated randomized
      scheduler outside the RSS poll job, while persisted local cooldowns
      prevent early provider navigation after a restart
- [x] Substack subscriber dashboards and sensitive subscriber metadata stay out
      of capture, Automerge, diagnostics, and bug reports
- [ ] Installed Substack and Medium beta sessions pass real-account selector and
      runtime soak validation
- [ ] Mozi activity captured to FeedItem with plans, trips, attendance, or overlap-adjacent events
- [ ] Mozi is visible in desktop Sources navigation and source status UI
- [ ] Mozi desktop flows have regression coverage in Playwright
- [ ] TikTok feed captured (video metadata at minimum)
- [ ] Threads posts captured to FeedItem
- [ ] Bluesky timeline captured via AT Protocol
- [ ] Reddit home feed captured (beyond RSS)
- [x] YouTube subscriptions are captured through an explicit authenticated
      Desktop website-session sync, with complete-roster safeguards and no
      YouTube developer project, OAuth grant, Data API client, or shared quota
- [x] Recent YouTube videos are captured from the signed-in Subscriptions page
      rather than generated RSS feeds or the algorithmic Home surface
- [x] Dev-channel installed builds can trigger the same authenticated explicit
      YouTube roster and Subscriptions sync from the terminal for unattended
      validation without changing the provider capture path
- [x] The YouTube login window hides as soon as authentication is confirmed,
      while the initial subscription sync continues in the persistent background session
- [x] YouTube videos offer click-to-load focused playback without autoplay or automatic next-video behavior
- [x] YouTube videos offer a canonical exact-video handoff for the YouTube application
- [x] An authenticated YouTube website session can create or reuse a private
      `Freed Offline` playlist through normal website controls and add a selected
      video without claiming it was downloaded
- [x] The private offline playlist can open in YouTube for the user's Premium-managed playlist download
- [x] YouTube website cookies, session state, and raw page data stay on Freed
      Desktop and out of Automerge, application logs, diagnostics, and bug reports
- [ ] One user-selected public video can produce a validated, seekable
      audio-first package on Freed Desktop without exporting YouTube credentials
- [ ] A paired iPhone can download, resume, verify, store, evict, and delete an
      audio package over the local network without media bytes entering Automerge
- [ ] Offline audio passes real iPhone airplane-mode, cold-launch, lock-screen,
      interruption, Bluetooth, AirPlay, and long-seek acceptance
- [ ] User-cloud media objects are opaque, chunk-encrypted, resumable, verified,
      quota-aware, and deleted with their key material
- [ ] Optional video passes storage, codec, range, seek, battery, and eviction
      acceptance without weakening the audio-only path
- [ ] Each platform handles its own rate limiting
- [ ] Selector/API maintenance strategy per platform
- [ ] Planning-oriented sources can surface future-dated activity without being forced through RSS assumptions

---

## Platform Comparison

| Platform | Method                | Auth Required | API Quality           | Difficulty | Primary Value |
| -------- | --------------------- | ------------- | --------------------- | ---------- | ------------- |
| LinkedIn | DOM scrape            | Cookies       | N/A                   | Very High  | Professional posts |
| Substack | Authenticated WebView plus user-added RSS | Website session | Public RSS only | High | Essays, notes, follows, subscriptions |
| Medium   | Authenticated WebView plus user-added RSS | Website session | No new general integration tokens | High | Stories, responses, follows |
| Mozi     | WebView payload + DOM | Phone session | Unknown / likely none | High       | Social planning, trips, overlaps |
| TikTok   | TBD                   | TBD           | Limited               | Very High  | Short-form video feed |
| Threads  | DOM scrape            | Cookies       | N/A                   | High       | Social posts |
| Bluesky  | AT Protocol           | App password  | Excellent             | Low        | Timeline capture |
| Reddit   | OAuth API             | OAuth         | Good                  | Medium     | Home feed beyond RSS |
| YouTube  | Authenticated website session, optional manual RSS | Website session | N/A | High | Subscriptions, focused viewing, Premium handoff, future offline media |

---

## Notes

- Feasibility varies by platform. Some may prove impractical.
- Each capture layer should fail gracefully without breaking others
- Consider community contributions for selector maintenance
- Bluesky is the most promising due to open protocol
- API-based platforms such as Bluesky and Reddit are generally more stable than DOM extraction
- YouTube embeds, roster capture, playlist interactions, media resolution, and media transfer are separate provider-visible behaviors and must remain user-controlled and bounded
- YouTube current behavior uses the user's authenticated website session and does not require a developer project, OAuth grant, Data API quota, or hosted provider requests
- Public YouTube RSS remains a separate manual intake mode. It is not the source of truth for the authenticated follow roster
- Substack and Medium are beta sources. Authenticated WebView extraction fills
  visible graph and activity gaps, while user-added RSS remains the preferred
  path for full public essay bodies
- Substack subscriber management, private chats, direct messages, paid status,
  subscriber email addresses, and private audience tools are not capture
  surfaces
- Future offline media is audio-first, Desktop-resolved, LAN-first, stored outside Automerge, and transferred through encrypted user cloud only when direct device transfer is unavailable
- A hosted YouTube media relay remains a later owner decision because centralized traffic directly conflicts with the goal of minimizing provider differentiation
- Mozi should be treated as a planning source, not squeezed into the RSS mental model
- Mozi overlap views should be derived from captured items at read time, not stored as source-authored canonical records
