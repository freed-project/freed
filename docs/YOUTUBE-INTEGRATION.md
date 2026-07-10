# YouTube Focus and Offline Integration

> **Status:** Initial integration implemented in the YouTube focus feature branch.
> The user must connect a Google account with YouTube access, and deployed builds
> must provide the matching Google OAuth and YouTube Data API credentials.
> **Phase:** [Phase 12: Additional Platforms](PHASE-12-ADDITIONAL-PLATFORMS.md)
> **Last reviewed:** 2026-07-10

## Product Goal

YouTube contains excellent long-form educational material, but opening the
normal application also exposes Home, Shorts, recommendations, comments, and
autoplay. Freed should help a user choose a video deliberately, watch it without
entering those discovery surfaces, and prepare selected videos for YouTube
Premium offline viewing.

The integration has three distinct jobs:

1. Track videos from channels the user intentionally follows.
2. Offer a focused player that does not surround the selected video with a feed.
3. Hand Premium-only background and offline work to the YouTube application,
   where those entitlements are actually available.

The design does not pretend that a web embed inherits Premium benefits. It also
does not treat a video added to a playlist as downloaded. YouTube remains the
authority for Premium status, download eligibility, download progress, and the
encrypted offline copy.

## Initial Capability Matrix

| Capability | Initial behavior | Important boundary |
| ---------- | ---------------- | ------------------ |
| Followed videos | The PWA imports the complete authenticated subscription roster, records stable channel feeds, then attempts a bounded recent window for each channel. | The roster lands before optional video enrichment. Partial channel failures are reported without discarding followed channels. Sync is explicit and foreground-only. |
| Watch here in Focus Mode | The reader offers `Watch here in Focus Mode`, then loads one click-to-load YouTube embed for the selected video. | Reliable foreground playback only. It does not promise locked-screen playback. |
| Open in YouTube | A direct canonical watch URL hands the exact video to YouTube through iOS Universal Links when available. | Freed can bypass Home and Shorts on entry, but cannot remove navigation inside YouTube. |
| Save to Freed Offline | After YouTube OAuth, Freed creates or reuses a private `Freed Offline` playlist and adds the selected video. | This is a YouTube playlist write, not a media download. |
| Open offline playlist | Freed opens the private playlist in YouTube so the user can download the full playlist with Premium. | YouTube performs and manages all device downloads. |
| Premium background playback | The exact-video handoff lets the YouTube application use the user's Premium background playback setting. | The Focus Mode iframe does not inherit this guarantee. |
| Direct media download | Not included. | Freed does not receive, decrypt, store, or redistribute YouTube media bytes. |
| Screen Time shield | Not included. | A PWA cannot use Apple's Screen Time frameworks. |

## Initial User Experience

### Watch Here in Focus Mode

`Watch here in Focus Mode` is the primary focus action for a YouTube item. The player follows
these rules:

- The focus player does not contact YouTube until the user presses the play
  action. Subscription metadata and thumbnail images have separate provider
  contact behavior.
- The embed loads only the selected video. It does not load a playlist or
  automatically queue the next item.
- Autoplay stays off. Playback begins from a deliberate user action.
- Inline playback is allowed on mobile so the user is not forced into a separate
  browser surface.
- The YouTube player remains the media renderer. Freed does not scrape or proxy
  the media source.
- If the video owner disabled embedding, the item was removed, or the player
  returns another embed error, the exact-video YouTube handoff remains available.
- If the IFrame API script fails or does not initialize within ten seconds,
  Freed removes both the script and player. The user can retry with a clean
  script or use the exact-video handoff. A failed observer never leaves an
  unguarded recommendation end screen behind.

After the click, Freed loads the official IFrame API to observe ready, playing,
paused, buffering, ended, and error states. When playback ends, Freed removes
the iframe before YouTube can turn the end screen into the next browsing surface
and offers `Replay in Focus Mode`. It must not automatically start the next
video. YouTube's `rel=0` parameter limits related videos to the same channel. It
does not remove related videos completely, so removing the player at the ended
state is the stronger protection.

The privacy-enhanced `youtube-nocookie.com` host reduces storage before the user
interacts with the player, but it does not make playback invisible to YouTube.
Once loaded, YouTube can still observe the request, IP address, browser and
device traits, selected video, referring origin, and playback timing.

Freed Desktop needs separate native verification. YouTube error `153` means an
embed did not provide an HTTP Referer or equivalent client identity. A native
WebView served from a custom application scheme may trigger that error even when
the same player works at `https://app.freed.wtf`. The initial reader keeps the
exact-video fallback visible. If native verification proves unreliable, the
lowest-complexity fix is an HTTPS wrapper page that owns only the official
YouTube embed and completion messages. That wrapper would be a new hosted,
provider-visible surface, but it would not proxy media bytes.

### Play in YouTube

Freed converts supported YouTube URLs to this canonical form:

```text
https://www.youtube.com/watch?v=VIDEO_ID
```

Normalization should accept at least these source shapes:

- `youtube.com/watch?v=VIDEO_ID`
- `youtu.be/VIDEO_ID`
- `youtube.com/shorts/VIDEO_ID`
- `youtube.com/embed/VIDEO_ID`
- `youtube.com/live/VIDEO_ID`

The handoff strips tracking, recommendation, playlist, and index parameters
unless the user explicitly chose playlist playback. The initial normalizer also
removes start-position parameters. Converting a Shorts URL to the canonical watch
route avoids opening directly in the Shorts player.

On iOS, a direct user-tapped YouTube HTTPS link normally opens the installed
YouTube application at that video. If YouTube is absent, the same URL opens in
the browser. A user can override Universal Link behavior and keep YouTube links
in the browser, so Freed must present this as an exact link rather than a promise
that it can force a particular application.

The action must be a synchronous result of the user's tap. Freed should not put
a redirect service, analytics hop, asynchronous task, or URL shortener between
the tap and `youtube.com`. This improves handoff reliability and avoids leaking
another navigation record.

### Save to Freed Offline

If the YouTube write grant is missing, the first `Save to Freed Offline` action
saves the item locally and opens Google authorization. The OAuth return opens
YouTube Settings. The initial implementation does not retain or automatically
resume that pending provider write, so the user completes it with `Sync saved
videos`. When the write grant is already present, the reader can add the
selected video immediately. In either path, Freed:

1. Validates the device's recorded private playlist ID when one exists, then
   falls back to an exact private `Freed Offline` title match.
2. Creates a private playlist named `Freed Offline` if no valid playlist exists.
3. Records the returned playlist ID, never an access token, in device-local
   integration state.
4. Adds the selected video to that playlist.
5. Offers `Open Freed Offline in YouTube` so the user can manage the playlist and
   choose YouTube's playlist download action.

The reader action saves the video in Freed before attempting the provider write.
If authorization, connectivity, capacity, or quota blocks the playlist update,
the local save remains. In YouTube Settings, `Sync saved videos` collects every
locally saved YouTube URL, canonicalizes and deduplicates the video IDs, then
reconciles them into the same private playlist. Inserts are sequential and stop
on the first provider failure. The initial client has no durable pending queue
or per-video progress record. Any successful provider inserts remain in the
playlist, and the user manually retries the full saved set. Retrying is safe
because every insert begins with a membership check.

The saved-video query runs inside the Automerge worker against the full
document. It includes hidden and archived saved items and does not inherit the
main feed's 2,500-item hydration limit.

The playlist must be private when created. The client records the resulting ID
locally and prefers that ID later, so a user rename does not create a duplicate.
If the ID is deleted or inaccessible, it searches owned playlists by exact
private title before creating a replacement. A future synced integration record
can carry this non-secret identity across devices. A new OAuth grant clears the
device-local ID because Freed cannot prove that the account stayed the same.
If the playlist was renamed before reauthorization, the next write may create a
new `Freed Offline` playlist instead of rediscovering the renamed one.

Adding a video uses best-effort duplicate avoidance, not transactional
idempotency. Each insert begins with a playlist membership read. The PWA also
serializes playlist operations with the same-origin Web Locks API when
available, with an in-tab queue as a fallback. Simultaneous operations from
different devices, or tabs without Web Locks support, can still race between
the membership check and YouTube's insert and create a duplicate. Retrying an
uncertain insert performs the membership check again.

Unsaving an item in Freed does not silently remove it from the YouTube playlist.
Those are separate user decisions. A later explicit `Remove from Freed Offline`
action may delete the matching playlist item.

### What YouTube Premium Does

YouTube Premium owns both behaviors that require the user's subscription:

- Background playback while another application is active or the screen is off
  is handled by the signed-in YouTube mobile application.
- Offline media is downloaded, encrypted, validated, and played by YouTube.

After the user downloads the full `Freed Offline` playlist in YouTube, videos
added later may download automatically when YouTube's recency and connectivity
conditions are met. This is useful behavior, not a completion guarantee. Freed
cannot query whether Premium is active, trigger the Download control, observe
progress, confirm that bytes exist locally, or open YouTube in a forced offline
mode. User-facing confirmation must therefore say `Added to Freed Offline`, not
`Downloaded`.

## Capture Architecture

### Current Public Channel Path

`@freed/capture-rss` already recognizes YouTube channel feeds and normalizes
entries as `platform: "youtube"` and `contentType: "video"`. This is the lowest
traffic and least privileged capture path. It remains useful even after an
authenticated provider exists.

### Authenticated Subscription Path

The Phase 12 `@freed/capture-youtube` package now expands capture beyond
manually added channel feeds:

1. Request a read grant only when the user chooses to connect YouTube.
2. Page through `subscriptions.list` with `mine=true` to obtain the user's
   channel roster.
3. Reconcile that roster into Freed sources with stable YouTube channel IDs.
4. After the complete roster is stored, attempt each channel's uploads playlist
   and capture up to five recent videos during the explicit foreground sync.
5. Store every channel as a normal Freed feed so Freed Desktop can continue on
   the existing RSS cadence after the Automerge document reaches it.
6. Mark roster-managed feeds inactive when they disappear from a later complete
   roster. The RSS scheduler excludes them without overwriting the user's
   `enabled` preference, captured videos, or fetch health.
7. Deduplicate videos by the existing YouTube Atom identity,
   `youtube:yt:video:VIDEO_ID`, so later RSS polls preserve read and saved state.

This architecture imports the user's deliberate subscriptions, not YouTube's
algorithmic Home feed. The initial PWA refresh is manual and foreground-only.
It pages and stores the full roster first. Recent-video enrichment then makes
one bounded uploads-list request per available channel. The initial sync omits
separate duration lookups to reduce provider traffic and quota cost.
Individual channel failures are skipped, and quota or authorization failures
stop enrichment without rolling back the roster or videos already collected.
It does not start a hidden browser loop. This still has material shared-quota
cost for large rosters and needs production telemetry
before a broad rollout.

Watch Later and watch history are not dependable capture sources. The current
Data API explicitly reports that some system playlists, including Watch Later,
cannot be listed. Freed should own its private playlist instead of basing an
offline contract on an inaccessible system playlist.

## OAuth, Token, and Data Security

The playlist feature is an authenticated provider write. Its security boundary
is stricter than public RSS capture.

- Request read access for subscription import separately from write access for
  `Freed Offline`. Incremental authorization keeps the first connection honest.
- Use OAuth authorization code flow with PKCE where the platform supports it.
- Validate `state`, redirect origin, and authorization response before exchange.
- Use the existing server token exchange pattern when an OAuth client secret is
  required. Never ship the secret in browser or desktop JavaScript.
- The initial PWA keeps the access and refresh token bundle in origin-scoped
  browser storage. It never places those tokens in Automerge, feed items, URLs,
  logs, diagnostics, or bug reports. A future native surface should use its
  platform credential store.
- Each completed authorization grant replaces the previous token bundle.
  Freed never carries a refresh token or recorded scopes into a later grant
  because Google may let the user choose a different account. Token refreshes
  may retain their own refresh token because they are tied to the same grant.
- A completed grant also clears device-local playlist IDs, links, and sync
  counters before the new token is stored. This prevents one account's private
  playlist link from being reused after an account switch. Existing captured
  channels remain in Automerge until the next explicit roster sync reconciles
  the new account.
- Freed does not receive a stable Google account identity in this scope set and
  cannot select the account active inside the YouTube application. The user
  must open `Freed Offline` with the same account connected in Freed.
- The initial playlist ID and sync counters are also device-local. A future
  schema may sync non-secret integration state after cross-device ownership and
  stale-playlist recovery are designed.
- Refresh tokens before expiry and retry one authorization failure after a
  forced refresh. Repeated authorization failure becomes a reconnect state, not
  an infinite background loop.
- Disconnect forgets Freed's local credential. It does not revoke the Google
  grant or delete the user's private playlist.
- The initial client does not log API response bodies, bearer tokens, or full
  IDs. Future quota telemetry should record only method, status class, quota
  cost, duration, and a redacted ID tail.

### Deployment Credential Contract

The PWA reuses the existing server-side Google token exchange endpoint. A
deployment must configure and verify these pieces before the connection button
can reach a real account:

- Enable YouTube Data API v3 in the Google Cloud project.
- Authorize `youtube.readonly` for subscription capture.
- Authorize `youtube.force-ssl` only for users who enable private playlist
  writes. Google does not provide a narrower playlist-only write scope.
- Set `VITE_YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` for a separate web
  client, or omit them to reuse the existing Google Drive client.
- `GOOGLE_OAUTH_CLIENTS_JSON` may hold additional client ID to secret mappings.
  The older `GDRIVE_OAUTH_CLIENTS_JSON` name remains a fallback.
- Register `https://app.freed.wtf/oauth-callback`. The exact
  `https://dev-app.freed.wtf` origin may use the production callback relay, and
  the originating app verifies the exact stored PKCE state after return.
- Dynamic preview origins are intentionally excluded from the relay. OAuth must
  remain unavailable there until a server-authenticated, one-time return-origin
  mechanism replaces client-authored relay state. Hostname suffix matching is
  not an authorization boundary.
- Keep all client secrets in the server environment. Only client IDs ship in
  browser JavaScript.

The first implementation manages OAuth in the PWA. Subscription feeds and
captured videos travel through the existing Automerge document to Freed Desktop.
Adding a separate native Desktop OAuth and API transport would require its own
allowlisted native command, secure token storage, mocks, and real native tests.

The YouTube Data API currently charges 50 quota units to create a playlist, 50
for each playlist item insert, and 1 for the membership check that reduces
duplicate inserts. The default project budget for these methods is 10,000 units
per day. In the theoretical case where the project did nothing else, one
playlist creation plus the required checks permits at most 195 new additions in
that day. That is nowhere near a tens-of-thousands-of-users target. Production
rollout requires an approved quota increase, quota telemetry, per-user
backpressure, and a useful manual handoff when the shared quota is exhausted.

## Provider Visibility and Privacy

Each mode creates a different observable event:

| User action | Provider-visible behavior | Lowest-profile behavior |
| ----------- | ------------------------- | ----------------------- |
| Open reader | No player or IFrame API request before the focus click. A remote captured thumbnail can still contact YouTube's image host when a feed card renders. | Keep the player unloaded, avoid preconnect, and add a first-party thumbnail cache before claiming a fully quiet reader. |
| Watch here | The browser loads a YouTube embed and playback resources | Load only after an explicit tap. No autoplay, prefetch, or background player. |
| Play in YouTube | The device opens a canonical YouTube watch URL | Use the direct HTTPS link with no Freed redirect. |
| Save to Freed Offline | Freed makes authenticated playlist list, create, or insert API calls | Make writes only after the explicit save action and avoid repeated polling. |
| Sync subscriptions | Freed makes authenticated roster, channel, and upload-playlist reads | Run only after an explicit sync action, omit duration lookups, bound the recent window, then use the existing RSS scheduler where available. |

YouTube can associate authenticated API writes with the OAuth client, account,
video, playlist, IP address, and request time. The focus embed exposes playback
traffic without the OAuth write, while a Universal Link transfers the user into
YouTube's own application. These are not equivalent privacy modes and the user
interface should not blur them together.

All YouTube network paths belong in the canonical provider-visible path list.
Publishing changes to those paths requires the owner approval reference required
by the repository workflow.

## Failure and Recovery Behavior

The integration should fail locally and legibly:

| Failure | User-facing recovery |
| ------- | -------------------- |
| Embed disabled or unavailable | Keep `Play in YouTube` visible for the exact video. |
| YouTube application not installed | Open the canonical mobile watch page. |
| Universal Link preference points to browser | Explain that the user can use YouTube's `Open` banner to restore app handoff. |
| OAuth canceled | Leave the item unchanged and offer connection again on the next explicit save. |
| Token expired or revoked | Refresh once, then show `Reconnect YouTube`. |
| Playlist deleted or made inaccessible | The next sync lists owned playlists and recreates `Freed Offline` when no exact private match remains. |
| Duplicate or uncertain insert | Reconcile membership before another write. |
| Video private, removed, regional, age-restricted, or otherwise unavailable | Keep metadata and explain that YouTube controls availability. |
| Quota exhausted | Keep the local save, report that the provider sync stopped, and let the user manually retry `Sync saved videos` later. Inserts completed before the failure remain in YouTube. |
| Playlist capacity reached | Keep the local save and ask the user to remove videos from `Freed Offline` in YouTube before retrying. Do not report this as a permission failure. |
| Device is offline | Keep the local Freed bookmark. The initial playlist action must be retried when online and never claims that YouTube media is offline. |

## Background Playback Findings

Mobile websites can provide locked-screen audio when they own a direct media
source that Safari can play through an HTML media element. A robust first-party
implementation would use a user-initiated `<audio>` or `<video>` element, a
range-capable MP4 or HLS source, and Media Session metadata for lock-screen
controls. Safari may suspend page JavaScript while its native media pipeline
continues to request HLS segments.

That mechanism does not transfer to a third-party YouTube iframe. The media
element lives in YouTube's cross-origin document. Freed cannot read its stream
URL, control its media session, cache its bytes, or confer the user's Premium
entitlement on the embed. YouTube documents Premium background playback for its
mobile applications. That is not a documented guarantee for a third-party
embedded player or for Freed's mobile website.

The initial product contract is therefore simple:

- `Watch here in Focus Mode` is focused foreground playback.
- `Play in YouTube` is the path for Premium locked-screen playback.
- Creator-provided direct media, such as a podcast enclosure, may use native web
  background audio without any YouTube relay.

## Future Native Screen Time Companion

An installed native iOS companion could use Apple's `FamilyControls`,
`DeviceActivity`, `ManagedSettings`, and `ManagedSettingsUI` frameworks. A
possible guarded handoff would:

1. Ask the user to select YouTube in Apple's Screen Time picker.
2. Shield YouTube by default during a focus schedule.
3. Temporarily remove the shield when the user chooses a specific Freed video.
4. Open the canonical video URL.
5. Restore the shield after the video duration plus a user-controlled cushion.

This reduces the available doomscrolling window, but it cannot prove that the
user watched the selected video. Screen Time observes application usage, not
YouTube's internal route. During the allowance, Home and Shorts remain reachable.

A PWA cannot call these frameworks. The companion must be a signed native app
with Apple's Family Controls capability and monitoring or shield extensions.
Whether it is distributed through the App Store or another installation path
does not remove the entitlement and code-signing requirement.

The native companion is a separate project because it adds a new application,
extensions, entitlement provisioning, native state synchronization, emergency
unlock behavior, and real-device testing. It should not block the web-based
focus player or exact-video handoff.

## Future Direct-Media Playback

Direct media should be preferred whenever the creator provides it. Podcasts,
owned files, authorized creator downloads, and standard HLS sources can support:

- Locked-screen audio through the browser media pipeline.
- Media Session title, artwork, play, pause, seek, and position controls.
- First-party offline storage where browser capacity permits it.
- Desktop local files without placing large media blobs in Automerge.

Synced state should contain metadata, a content hash, and device-local
availability, not the media bytes. Each device owns its download, eviction,
integrity check, and storage accounting. Browser storage can be evicted by the
operating system, so the PWA must describe offline availability as device-local
and re-check it before promising playback.

## Future YouTube Resolver and Relay Research

A relay is technically possible, but it is not part of the initial integration.
It would be independent media acquisition and delivery. It would not carry the
user's Premium entitlement through Freed.

### Resolver Only

A small service could resolve a video ID into temporary media URLs and return
them to the client. The client would then fetch media bytes directly from the
provider host.

Advantages:

- Freed avoids most media bandwidth and storage.
- Startup infrastructure is smaller than a full relay.

Technical weaknesses:

- Media URLs are short-lived and may be tied to an IP address or client context.
- Browser cross-origin rules can prevent direct use.
- YouTube increasingly requires proof-of-origin tokens or other client evidence.
- Audio and video are often separate streams, so a browser cannot treat the
  resolved result as one ordinary video source.
- Format, signature, client profile, and attestation changes can break resolution
  without warning.
- Centralized resolver traffic is easy to identify and rate limit.

This is a useful laboratory probe, not a dependable product contract.

### Full Media Relay

A full relay would acquire the source streams, combine or transmux them, and
serve a first-party HLS manifest to Freed:

1. An authenticated Freed request submits a video ID and requested mode.
2. A resolver worker obtains viable source formats.
3. A media worker selects audio-only or compatible audio and video streams.
4. FFmpeg or an equivalent pipeline transmuxes the source into HLS without
   transcoding when codecs permit it.
5. Object storage or an edge cache holds short-lived manifests and segments.
6. The PWA receives a signed, short-lived Freed HLS URL.
7. Safari plays that URL through its native media pipeline.

The service would need a job queue, resolver fleet, media workers, signed URL
issuer, object store, CDN, request authentication, rate limits, cancellation,
range and seek support, expiration, observability, and a deletion path. An
audio-only rendition should be the default for locked-screen listening because
shipping unseen video wastes bandwidth and battery.

### Bandwidth and Storage

Useful planning formulas are:

```text
bytes per hour = bits per second * 3,600 / 8
relay transfer = playback hours * bytes per hour
stored bytes = retained hours * bytes per hour * rendition count
```

At 128 kbps, audio is about 57.6 MB per listening hour. At 3 Mbps, video is
about 1.35 GB per viewing hour. At 10,000 playback hours, that is about 576 GB
of audio transfer or 13.5 TB of video transfer before retries, multiple
renditions, cache misses, origin egress, or replication. The arithmetic develops
teeth rather quickly.

Storage should be ephemeral by default. A user-authorized offline copy would
need a separate retention record, encryption at rest, integrity hash, per-user
access check, regional placement decision, deletion deadline, and storage quota.
Media bytes must never enter Automerge or normal diagnostic archives.

### Unsupported and High-Friction Content

A relay prototype must begin with public, non-live, freely viewable videos. It
must assume these classes are unsupported until individually proven:

- Private or unlisted content that requires account state
- Age-restricted videos
- Channel member content and paid media
- Regional restrictions
- Live streams, premieres, and in-progress archives
- Digital rights management protected formats
- Videos whose owner disables the needed playback form
- Removed videos and videos requiring interactive verification

Freed should never accept a user's raw YouTube cookies as a shortcut. Cookies,
session tokens, and device attestation material are account credentials. Sending
them to a relay would turn a playback experiment into an account-security system.

### Relay Fingerprinting and Privacy

A resolver or relay substantially increases provider detection risk. YouTube
would see repeated player and segment requests from Freed-controlled IP ranges,
consistent headers and client profiles, resolution timing, selected video IDs,
and retry patterns. A block against that fleet could affect every user at once.

The relay would also learn which user requested which video, when playback
started, how far the user sought, and roughly how much they consumed. A privacy
respecting design would need:

- Short-lived opaque session IDs rather than video IDs in public URLs
- Signed manifests scoped to one user, rendition, and expiration
- Minimal structured logs with video IDs redacted after active debugging
- No third-party analytics on media endpoints
- Separate billing and operational metrics from viewing history
- Strict retention limits and a user deletion path
- Protection against URL sharing, hotlinking, replay, and cache key confusion

The lowest-profile alternative remains the direct, user-initiated YouTube link.
Any relay experiment requires a separate owner approval for the new
provider-visible behavior before implementation.

## Staged Future Work

| Stage | Capability | Exit condition |
| ----- | ---------- | -------------- |
| 1 | Initial PWA provider, focus player, exact-video handoff, subscription roster, and private `Freed Offline` playlist | Implemented in this branch with automated coverage. Iframe loads and authenticated API calls require explicit actions. Generic feed cards can still request remote captured thumbnails. |
| 2 | Production hardening | Real credentials, quota increase, quota telemetry, first-party thumbnail caching, cross-device playlist identity, native Desktop embed proof, and real iPhone acceptance are complete. |
| 3 | Focus session controls | Optional duration timer, deliberate completion notes, and user-selected next-item behavior have mobile usability coverage without autoplay. |
| 4 | Native Screen Time companion | Real-device shield, timed handoff, emergency unlock, and entitlement provisioning are proven. |
| 5 | Direct creator media | HLS or direct audio supports lock-screen controls and honest device-local offline state. |
| 6 | Audio-only relay laboratory | One public video survives real locked-iPhone testing with measured bandwidth, token lifetime, failure classification, and separate provider-risk approval. |
| 7 | Relay product decision | Cost, reliability, privacy, account security, detection risk, and content coverage justify proceeding. Otherwise the laboratory is retired. |

## Validation Matrix

The feature should be tested at three levels.

### Automated

- Extract video IDs from watch, short, Shorts, embed, and live URLs.
- Reject deceptive hosts, invalid protocols, and malformed video IDs.
- Prove the reader does not create a YouTube iframe before the user's tap.
- Prove Focus Mode does not enable autoplay or playlist continuation.
- Preserve the exact-video fallback when embed playback fails.
- Create a private playlist only when no exact private `Freed Offline` match exists.
- Avoid duplicate playlist inserts after an uncertain response.
- Refresh an expired token once, then enter a reconnect state.
- Keep quota, capacity, authorization, offline, and deleted-playlist failures distinct.
- Confirm no OAuth secret or bearer token enters Automerge or logs.

### Browser and Shared UI

- Verify the actions remain reachable at supported reader widths.
- Verify focus controls use the established button hierarchy and theme tokens.
- Verify the player stays within the viewport in portrait and landscape layouts.
- Verify keyboard focus, labels, reduced motion, and screen-reader names.
- Verify leaving the item removes or stops the active embed.

### Real iPhone

- YouTube installed, Universal Links enabled, exact video opens.
- YouTube absent, canonical browser fallback opens.
- User preference keeps links in Safari, recovery copy is accurate.
- Premium background playback continues after the YouTube app handoff and lock.
- Focus Mode makes no locked-screen playback promise.
- The private playlist opens in YouTube and can be downloaded with Premium.
- A newly added playlist item is described as added to the playlist, never as
  downloaded to the device.
- Offline launch distinguishes Freed metadata availability from YouTube media
  availability.

## Reference Notes

- [YouTube Universal Links](https://support.google.com/youtube/answer/7174035?hl=en)
- [Apple Universal Link behavior](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content/)
- [YouTube IFrame player parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube IFrame Player API events and errors](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube privacy-enhanced embed mode](https://support.google.com/youtube/answer/171780?hl=en)
- [YouTube Premium background playback](https://support.google.com/youtube/answer/6308116?hl=en)
- [YouTube offline behavior](https://support.google.com/youtube/answer/7381437?hl=en)
- [Create a YouTube playlist](https://developers.google.com/youtube/v3/docs/playlists/insert)
- [List YouTube playlists and current system-playlist limits](https://developers.google.com/youtube/v3/docs/playlists/list)
- [Add a YouTube playlist item](https://developers.google.com/youtube/v3/docs/playlistItems/insert)
- [List YouTube subscriptions](https://developers.google.com/youtube/v3/docs/subscriptions/list)
- [YouTube Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Apple Family Controls](https://developer.apple.com/documentation/familycontrols)
- [Apple Managed Settings](https://developer.apple.com/documentation/managedsettings)
- [Apple Media Session overview](https://developer.apple.com/videos/play/wwdc2021/10189/)
- [Apple HTTP Live Streaming](https://developer.apple.com/streaming/)
- [yt-dlp proof-of-origin token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
