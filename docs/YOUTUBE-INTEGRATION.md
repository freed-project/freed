# YouTube Focus and Offline Integration

> **Status:** The authenticated website-session integration is implemented in
> the YouTube focus feature branch. Direct media caching is documented future
> work and is not part of the initial release.
> **Phase:** [Phase 12: Additional Platforms](PHASE-12-ADDITIONAL-PLATFORMS.md)
> **Last reviewed:** 2026-07-10

## Product Goal

YouTube contains excellent long-form educational material, but opening its
normal discovery surfaces also exposes Home, Shorts, recommendations, comments,
and autoplay. Freed should let a user choose deliberately, watch without a feed
wrapped around the video, and prepare selected material for offline listening or
viewing without sending the user back through an attention trap.

The integration has four jobs:

1. Capture the channels and recent videos visible in the user's normal signed-in
   YouTube website session.
2. Offer focused foreground playback and an exact-video YouTube handoff.
3. Maintain a private `Freed Offline` playlist through YouTube's normal website
   controls for users who want YouTube Premium to manage downloads.
4. Research a separate audio-first media path that can place user-selected
   material in the Freed PWA for offline and locked-screen playback.

The fourth job is technically possible, but it is a new media acquisition and
delivery system. A service worker cannot reach through a cross-origin YouTube
iframe and copy its media. Freed must first produce a stable media package on
Freed Desktop, then deliver that package to the PWA over the local network or
through encrypted storage controlled by the user.

## Product and Traffic Boundaries

The initial integration follows the same provider model as Facebook, Instagram,
LinkedIn, Substack, and Medium:

- The user signs into the ordinary provider website inside a dedicated Freed
  Desktop WebView.
- The provider session and cookies remain on that device in the isolated
  WebView data store.
- Freed loads normal YouTube website pages and extracts the roster and video
  cards visible to that signed-in user.
- Playlist actions use the website's normal Save and playlist controls.
- Freed has no YouTube developer project, YouTube OAuth grant, Data API client,
  API quota, or central subscription service.
- Current capture and playlist work originates from the user's device. Freed
  does not proxy those requests through shared infrastructure.

This minimizes distinct traffic, but it cannot guarantee that YouTube sees the
WebView as indistinguishable from every other browser visit. A provider can
observe WebKit traits, navigation order, repeated timing, and scripted clicks.
Freed must not add fingerprint spoofing, unusual headers, hidden high-frequency
polling, or synthetic interaction noise. The safest behavior is a small,
bounded sequence against ordinary pages at a cadence the user authorized.

The future media resolver has a different risk profile. Resolving downloadable
streams can require requests that differ from ordinary playback. It must remain
separate from routine roster capture, explicit per item, and covered by a new
provider-risk approval when implementation begins.

## Capability Matrix

| Capability | Initial behavior | Important boundary |
| ---------- | ---------------- | ------------------ |
| Followed channels | Freed Desktop captures the authenticated channel roster through the user's YouTube website session. | A complete roster may reconcile unfollows. A partial capture may add or refresh channels, but cannot infer an unfollow. |
| Recent subscription videos | Manual sync and the bounded routine refresh capture video cards from the signed-in Subscriptions surface. | This reflects the page the user can see. It is not an algorithmic Home import and does not use the Data API. |
| Watch here in Focus Mode | The reader loads one click-to-load YouTube embed for the selected video. | This supports reliable foreground playback only. It does not promise locked-screen playback. |
| Play in YouTube | A direct canonical watch URL hands the exact video to YouTube through iOS Universal Links when available. | Freed can bypass Home and Shorts on entry, but cannot remove navigation inside YouTube. |
| Save to Freed Offline | Freed Desktop uses the authenticated website session to create or reuse a private playlist and save the selected video. | This updates a YouTube playlist. It is not a media download. |
| Open offline playlist | Freed opens the playlist in YouTube so a Premium user can choose YouTube's playlist download. | YouTube performs and manages those device downloads. |
| Direct Freed audio download | Future work. | Requires Desktop resolution, packaging, transfer, PWA storage, and real iPhone validation. |
| Direct Freed video download | Later future work after audio proves reliable. | Video has much higher storage, bandwidth, codec, and battery cost. |
| Screen Time shield | Not included. | A PWA cannot call Apple's Screen Time frameworks. |

## Current Authenticated Website Integration

### Connection and Capture

Freed Desktop owns the YouTube connection. The login window uses a persistent,
provider-specific WebView data store. Signing in establishes an ordinary website
session instead of issuing a token to a Freed YouTube application.

One explicit sync does the following:

1. Verifies that the WebView still shows a signed-in YouTube session.
2. Loads the normal channel-management and Subscriptions pages needed for the
   requested capture.
3. Extracts stable channel IDs, channel names, handles, profile links, artwork,
   long-form video IDs, titles, thumbnails, and published labels when present.
4. Scrolls only as much as the bounded capture requires and reports whether the
   roster reached a complete stopping condition.
5. Normalizes followed channels into Freed's identity graph and recent videos
   into normal `FeedItem` records.
6. Reconciles missing channels only after a complete roster capture.

Shorts and Reels cards are discarded before persistence. Freed does not import
them into the focused feed merely because YouTube inserted them into the
Subscriptions surface.

YouTube's website cards often expose localized relative labels rather than an
exact publication timestamp. Freed preserves the rendered Subscriptions order
with deterministic millisecond offsets on first capture. It does not pretend a
localized label is an exact date. Later captures preserve the first-seen order
for an existing video.

The login window remains open while post-login prompts and the first capture
finish. Later manual syncs use the same persistent session and refresh both
surfaces. Routine scheduled refreshes load only Subscriptions, so the full
channel roster is not crawled every cycle. A failed or partial capture keeps
existing content and reports diagnostic counts instead of turning an incomplete
page into a mass unfollow.

No access token, refresh token, Google account identifier, or YouTube API secret
exists in this design. Disconnecting removes Freed's local website session. It
does not modify the user's YouTube account.

### The Role of RSS

RSS is not the authenticated subscription source and is not generated from the
captured roster.

Freed's existing RSS capture can still follow a public YouTube channel feed when
the user adds that feed directly. That independent path is useful for a public,
low-privilege channel with no personalized state. It does not reveal the signed-in
user's follows, unfollows, ordering, members-only material, or the personalized
Subscriptions page.

The authenticated website session is therefore the source of truth for whom the
user follows and which recent subscription items YouTube shows them. Public RSS
remains an optional manual intake mode. Adding automatic RSS polling for every
captured channel would create a new request pattern and must not happen silently.

### Save to Freed Offline

Playlist management uses the same authenticated website session. Freed does not
call a playlist API.

For one deliberate save, Freed Desktop:

1. Opens the canonical watch page in the authenticated YouTube WebView.
2. Activates the normal Save control.
3. Selects an existing private `Freed Offline` playlist, or creates it through
   the normal website dialog when it does not exist.
4. Confirms the resulting website state or notification.
5. Stores the non-secret playlist link and ID needed for later handoff, plus a
   device-local set of video IDs already confirmed in that playlist.

`Sync saved videos` repeats that sequence serially in batches of at most 25
provider actions. Each confirmed item is checkpointed locally, so a later run
resumes without replaying the full saved library. It stops on the first
uncertain failure instead of clicking blindly. A successful provider action
stays successful even when a later item fails. Removing the failed item from
Saved lets the next run continue through the remaining queue. `Recheck All`
clears only the local completion markers when the user wants to reconcile
external playlist edits. `Stop After Current Video` cancels the remainder of a
batch without abandoning confirmed progress.

The playlist belongs to the user. If the same YouTube account is active on the
iPhone, the playlist should appear in the YouTube application. Premium users can
then choose YouTube's native playlist download. Freed cannot remotely start or
observe that iPhone download.

Unsaving an item in Freed does not silently remove it from YouTube. These are
separate user decisions. Disconnecting, losing authentication, or beginning a
new login clears cached playlist metadata and completion checkpoints so they
are not reused across account changes.

### Watch Here in Focus Mode

`Watch here in Focus Mode` is the primary focused playback action for a YouTube
item.

- The reader does not contact the player host until the user presses Play.
- The embed loads only the selected video. It does not queue a playlist.
- Autoplay stays off.
- Freed observes player state through the official IFrame API.
- When playback ends, Freed removes the iframe before the end screen becomes a
  new discovery surface and offers `Replay in Focus Mode`.
- The exact-video handoff remains visible when embedding is disabled or fails.

The privacy-enhanced `youtube-nocookie.com` host reduces storage before the user
interacts with the player, but playback is still visible to YouTube. Once the
iframe loads, YouTube can observe the request, IP address, selected video,
browser traits, referring origin, and playback timing.

### Play in YouTube

Freed normalizes supported links to one canonical watch route:

```text
https://www.youtube.com/watch?v=VIDEO_ID
```

Normalization accepts watch, short-link, Shorts, embed, and live URL shapes. It
strips tracking, playlist, index, and recommendation parameters unless the user
explicitly chose a playlist. Converting a Shorts URL to the watch route avoids
entering directly through the Shorts player.

The link is a synchronous result of the user's tap. No Freed redirect, analytics
hop, asynchronous task, or URL shortener sits between the tap and YouTube. iOS
normally opens the installed application at the exact video through its
Universal Link. Browser fallback remains available when the application is
absent or the user has changed Universal Link behavior.

## Future Offline Media Architecture

### Feasibility

The iPhone PWA can store and play audio or video offline when it receives a
stable, same-origin or cross-origin-enabled media resource. It cannot extract
that resource from a YouTube iframe because the iframe is cross-origin, the
player does not expose downloadable bytes, and the underlying media URLs are
often temporary, signed, split by track, or bound to a particular client
context.

The feasible design moves resolution and packaging to Freed Desktop, then moves
the resulting package to the PWA. The PWA does not resolve YouTube streams.

### Audio-First Package

Audio is the first supported rendition because it best serves focused study,
locked-screen listening, weak connections, and limited phone storage.

For each user-selected video, Freed Desktop should produce a package containing:

| Asset | Required contents |
| ----- | ----------------- |
| Manifest | Opaque package ID, YouTube video ID, title, channel, duration, creation time, source fingerprint, rendition list, byte sizes, MIME types, codec names, and checksums. |
| Audio | One seekable AAC-LC track in an M4A or MP4 container unless a proven Safari-compatible source can be passed through safely. |
| Artwork | A bounded local image suitable for the reader and Media Session controls. |
| Captions | Optional creator captions or transcript metadata when separately available and authorized by the selected source path. |
| Video | Optional H.264 video with AAC audio in an MP4 container after the audio path is proven. |

The packaging ladder should be conservative:

1. Pass through a source when its container, codec, seeking behavior, and Safari
   playback are already compatible.
2. Remux separate compatible audio and video tracks without transcoding.
3. Transcode only when the selected source cannot meet the device contract.
4. Fail clearly when digital rights management, interactive verification, or an
   unsupported media class prevents a valid package.

Audio-only output should be the default. Optional video should use one selected
quality rather than an offline adaptive ladder. Multiple renditions multiply
storage, transfer, integrity checks, and eviction complexity.

### Desktop Resolver and Packager

The resolver runs locally in Freed Desktop against one video the user explicitly
selected. It must not become a hidden channel crawler.

The Desktop pipeline should:

1. Resolve currently viable source formats using the user's local network and
   the minimum provider context required for that selected video.
2. Never export raw YouTube cookies, session tokens, device attestation material,
   or browser storage to another device or service.
3. Choose an audio source first and an optional video source only when requested.
4. Download into a temporary local workspace with bounded retries and a total
   byte limit.
5. Remux or transcode through a constrained media worker.
6. Move the MP4 metadata needed for seeking to the front of a progressive file.
7. Compute a SHA-256 checksum for each final asset and for the package manifest.
8. Publish the package atomically only after duration, codec, seek, checksum, and
   size validation pass.
9. Delete source fragments and failed temporary outputs.

Resolution is the least stable part of the design. Media signatures, temporary
URLs, client profiles, proof-of-origin tokens, rate limits, and attestation can
change without notice. The resolver must report the failure stage and version so
a provider change does not masquerade as storage corruption.

### Transfer Order

Media bytes never belong in Automerge, the normal document relay, application
logs, bug reports, or rotating document snapshots. Only a small package record
and, if useful, a device-keyed availability summary may enter synced metadata.

Transfer should follow this order:

1. Direct local network transfer from Freed Desktop.
2. Encrypted transfer through storage owned by the user.
3. A Freed-hosted relay only after the first two paths have been measured and
   found insufficient.

#### Local Network First

The fastest and most private path is a dedicated media endpoint next to the
existing Desktop LAN relay. It should use the existing device pairing relationship
but a separate media capability and protocol.

- The PWA requests one opaque package ID, never a filesystem path.
- The Desktop authorizes the paired device and package before serving bytes.
- The endpoint supports byte ranges, chunk hashes, resumable downloads,
  cancellation, and bounded concurrent transfers.
- A short-lived media capability prevents the long-lived pairing token from
  appearing in routine media URLs.
- The PWA writes chunks directly to device storage instead of holding the full
  file in JavaScript memory.
- The endpoint requires a transport acceptable to the secure PWA context. Mixed
  content and local network permission behavior must be proven on real iPhones.

The transport is a real design problem. An HTTPS PWA cannot assume that iOS will
allow a plain HTTP or WebSocket connection to an arbitrary LAN address. The
laboratory should compare a locally trusted HTTPS endpoint with a WebRTC data
channel. WebRTC supplies encrypted peer-to-peer transport from a secure page,
but Freed would need a signaling exchange, bounded message sizes, flow control,
resume offsets, and its own chunk protocol. A local HTTPS endpoint gives normal
range requests but requires a certificate chain that the iPhone accepts. The
existing document relay should not be stretched into a media pipe until one of
these transports passes real-device proof.

This path keeps provider acquisition and media transfer on the user's devices.
It also avoids cloud storage and hosted bandwidth.

#### Encrypted User Cloud Second

When the phone cannot reach Freed Desktop, Desktop may upload the package to the
user's configured cloud storage. This reuses the user's sync choice, but media
objects remain separate from the Automerge document.

The cloud package should use:

- One random media key per package.
- AES-256-GCM authenticated encryption through Web Crypto, with a unique nonce
  for every manifest-declared chunk.
- A versioned chunk format so a phone can resume and verify without downloading
  the entire object again.
- Random opaque object names that do not expose video IDs or titles.
- An encrypted manifest containing rendition metadata and plaintext checksums.
- A separate media root key established through the paired-device trust flow,
  then used to wrap each random package key. It must not reuse the long-lived LAN
  pairing token as encryption key material.
- Wrapped keys may travel with encrypted cloud metadata. Raw package keys and
  the raw media root key must never appear in Automerge or cloud metadata.
- Explicit retention, delete, and orphan cleanup records.
- A cloud quota check before upload and a PWA quota check before download.

The media root key needs an explicit recovery contract. A PWA cannot promise
hardware-backed secret storage. Clearing Freed site data may remove both cached
media and its local key material. The phone should re-pair with Desktop rather
than upload a recoverable plaintext key to Freed or the cloud provider.

Authenticated encryption detects tampering for each chunk. The final SHA-256
checksum verifies that the decrypted asset exactly matches what Desktop
packaged. A checksum alone is not an authentication mechanism.

Cloud encryption is future work. Existing document sync does not automatically
make large media end-to-end encrypted or suitable for partial download. This
requires a purpose-built object format and key exchange.

#### Hosted Relay Later

A Freed-hosted resolver or relay is the last option, not the default architecture.
It could resolve streams, package media, and serve signed first-party URLs when
Desktop is offline. It would also create the largest privacy, cost, and provider
risk:

- YouTube would see centralized Freed-controlled IP ranges and repeated client
  behavior instead of traffic originating only from the user's device.
- Freed would learn which user requested which video and would temporarily hold
  media bytes.
- Shared resolver breakage or blocking would affect every user at once.
- Audio and especially video transfer would create material bandwidth and
  storage costs.

Any hosted experiment needs a separate owner decision, isolated infrastructure,
strict log retention, signed per-user capabilities, abuse controls, deletion,
and a provider-risk approval. It does not meet the goal of making provider
traffic look like an ordinary request from the user's device as well as the
Desktop-first path does.

If approved later, the smallest credible hosted system still needs an
authenticated request service, job queue, resolver workers, constrained media
workers, ephemeral object storage, signed URL issuance, range and seek support,
rate limits, cancellation, expiry, deletion, and operational monitoring. A CDN
would reduce repeat transfer cost but would add another viewing-data processor.
Stored source fragments should expire quickly. User-authorized offline packages
need a separate retention record instead of inheriting a cache lifetime.

Hosted transfer planning should use measured rendition bitrates:

```text
bytes per hour = bits per second * 3,600 / 8
transfer bytes = playback hours * bytes per hour
stored bytes = retained hours * bytes per hour * rendition count
```

This arithmetic is why audio remains the default. Video multiplies egress,
storage, cache misses, retries, and regional replication before anyone has even
misplaced a semicolon.

## PWA Download and Storage

### Foreground Download Contract

The initial iPhone contract must be honest: a large download runs while the user
keeps the Freed PWA open in the foreground. Safari does not provide a dependable
Background Fetch contract for a Home Screen PWA that can finish large media after
the user locks the phone or leaves the app. A service worker may be suspended.

The user may choose `Download audio` or, later, `Download audio and video`.
Before starting, the PWA should:

1. Read estimated usage and quota through `navigator.storage.estimate()`.
2. Request persistent storage through `navigator.storage.persist()` when
   available and explain that persistence is still not an absolute guarantee.
3. Show the expected download size and available space.
4. Create a durable partial-download record.
5. Fetch and verify bounded chunks while the page remains foregrounded.
6. Resume from the last verified chunk after interruption.
7. Mark the rendition offline only after every chunk and final checksum pass.

The app shell, artwork, and small metadata can stay in the Cache API and
IndexedDB. Large media should use the Origin Private File System, with IndexedDB
holding the searchable package index and download state. OPFS is available in
modern iOS Safari, is scoped to the Freed origin, and is still governed by
browser quota and eviction policy.

Cloud objects remain encrypted in transit and at rest. After download, the PWA
should authenticate and decrypt into the final OPFS media file. Locked-screen
playback should not depend on page JavaScript or a service worker continuously
decrypting chunks after iOS suspends them. The resulting device-local file is
protected by browser origin isolation, not by hardware-backed file encryption.
That tradeoff must be stated plainly in user-facing storage copy.

A temporary filename or incomplete manifest must never appear as playable
offline media. Startup reconciliation should remove abandoned temporary files,
repair stale indexes, and downgrade any record whose file or checksum is gone.

### Eviction and Storage Pressure

PWA media availability is device-local. The operating system or browser can
evict origin data under pressure, and the user can clear site data at any time.

Freed should maintain a user-visible storage budget and apply these rules:

- Never consume the full reported origin quota.
- Protect the currently playing item and downloads explicitly pinned by the
  user.
- Evict optional video before the matching audio rendition.
- Evict least-recently-played unpinned packages next.
- Keep metadata after media eviction so the item remains saved and can be
  downloaded again.
- Reconcile IndexedDB against OPFS on startup, resume, and before claiming that
  an item is offline.
- Surface the reason for every automatic eviction and the bytes recovered.

`Available offline` means that the selected rendition exists on this device and
passed integrity verification. It does not mean that another device has it or
that the browser will preserve it forever.

## Offline and Locked-Screen Playback

Once the PWA owns a compatible local media file, it can play that file through a
first-party `<audio>` or `<video>` element. Media Session metadata can provide
title, artwork, play, pause, seek, and position controls on the lock screen.

This is fundamentally different from a YouTube iframe. Freed owns the local
media element and source, so Safari's native media pipeline can continue playback
while page JavaScript is suspended. It still requires proof on supported iPhone
and iOS versions.

Audio acceptance must include:

- Playback starts from a user gesture in the installed Home Screen PWA.
- The screen can lock without stopping audio.
- Lock-screen and Control Center controls show the correct title and artwork.
- Play, pause, seek, previous position, wired audio, Bluetooth audio, and AirPlay
  behave correctly.
- Incoming calls, Siri, route changes, alarms, and audio from another application
  pause and resume predictably.
- Playback works in airplane mode after a cold PWA launch.
- Long audio seeks without loading the entire file into JavaScript memory.
- A suspended service worker does not break reads needed by the media pipeline.

If an OPFS-backed virtual URL cannot serve reliable byte ranges while the PWA is
backgrounded, the implementation must test a Blob URL or another first-party
delivery shape. The product must not promise locked-screen playback until a real
iPhone can play a long offline file through repeated lock, unlock, interruption,
and seek cycles.

## Stream and Codec Challenges

| Challenge | Required response |
| --------- | ----------------- |
| Temporary source URLs | Resolve and consume them on Desktop within a bounded job. Never sync temporary provider URLs as durable media references. |
| Separate audio and video tracks | Remux compatible tracks on Desktop. Do not ask the PWA to synchronize independent provider streams. |
| Unsupported Safari codec | Transcode to the approved audio or video profile, or fail before publishing the package. |
| Seeking and byte ranges | Put MP4 metadata at the front, serve correct range responses, and test long forward and backward seeks. |
| Large video files | Require an explicit video choice, show size, cap quality, and favor audio retention during eviction. |
| Source changes during resume | Pin a source fingerprint per job. Restart packaging when the source no longer matches rather than joining incompatible fragments. |
| Live or upcoming video | Exclude from the first resolver milestone. A finished archive may be retried later as a normal video. |
| Private, members-only, age-restricted, regional, paid, or protected media | Treat as unsupported until each class has an explicit secure design and real test. Never export account credentials to make it work. |
| Digital rights management | Do not attempt to bypass it. Report that the item cannot be packaged. |
| Captions and chapters | Store them as separate versioned assets. Missing text tracks must not invalidate otherwise valid audio. |

## Privacy and Security

The offline path creates a new copy of media and therefore needs stronger
boundaries than metadata capture:

- YouTube credentials never leave the Desktop WebView data store.
- Resolution happens only after an explicit user selection.
- No background channel-wide media downloading is allowed.
- The provider video ID may appear in the local manifest, but cloud object names
  and public URLs use opaque identifiers.
- Cloud media and its manifest are encrypted before upload.
- The cloud provider can still observe opaque object sizes, upload and download
  times, account identity, and IP addresses even though it cannot read titles or
  media bytes.
- Device-local PWA storage is protected by browser origin isolation. It is not a
  hardware-backed media vault and should not be described as one.
- Media bytes, keys, provider cookies, and source URLs stay out of Automerge,
  telemetry payloads, logs, snapshots, and bug reports.
- Deleting an offline item removes local renditions, partial files, keys, and
  queued cloud objects. Cloud deletion must be retried until confirmed.
- A lost or unpaired device must not be able to request new media capabilities.

The Desktop resolver may still be identifiable because media resolution can
differ from an ordinary player sequence. The technical design should minimize
that difference, not promise invisibility. A hosted relay makes differentiation
easier and is therefore intentionally last.

## Telemetry and Diagnostics

Diagnostics must explain failures without becoming viewing history. Runtime
health should record bounded structured events such as:

| Event | Safe fields |
| ----- | ----------- |
| `youtube_roster_outcome` | Trigger, result, resolved count, unresolved count, completeness, scroll passes, stage, duration. |
| `youtube_playlist_outcome` | Result, stage, click count, navigation count, duration. |
| `youtube_media_resolution_outcome` | Result, resolver version, source class, selected rendition, transform class, codec family, duration bucket, byte bucket, stage, elapsed time. |
| `youtube_media_transfer_outcome` | LAN or cloud path, result, verified chunks, retry count, byte bucket, throughput bucket, interruption reason, elapsed time. |
| `youtube_offline_storage_outcome` | Result, quota bucket, bytes written or recovered, eviction reason, checksum result, elapsed time. |
| `youtube_offline_playback_outcome` | Audio or video, local source shape, start result, seek result, interruption class, lock test result, duration bucket. |

Do not record full video IDs, titles, channel names, source URLs, cookies, media
keys, exact viewing positions, or raw provider responses. Local debug mode may
show an ID tail when the repository convention requires one, but exported
reports must redact it.

Expected health directions are:

- Checksum failures remain zero.
- Interrupted downloads resume without restarting verified chunks.
- Resolver failures have a classified stage instead of a generic timeout.
- Storage evictions never delete pinned or currently playing media.
- Background playback passes every run on the explicitly supported iPhone
  matrix before the capability is labeled reliable.

## Failure and Recovery

| Failure | Recovery behavior |
| ------- | ----------------- |
| YouTube website session expired | Keep captured content and ask the user to reopen the login window. Do not erase the roster. |
| Capture ends before roster completion | Add or refresh observed channels, preserve all missing channels as active, and report the partial stop reason. |
| Website selector changed | Stop the bounded action, preserve state, and record extraction counts and stage. Never continue clicking by coordinates. |
| Localized label or interface experiment is ambiguous | Stop without clicking. Record the structural stage and let a maintained extractor add an explicit variant. |
| Playlist dialog is ambiguous | Stop without claiming success. Keep the local Freed save and offer a retry. |
| Embed disabled or unavailable | Keep `Play in YouTube` visible for the exact video. |
| Resolver cannot identify a viable source | Keep the saved item, report the resolver stage, and leave YouTube playback paths intact. |
| Source URL expires during packaging | Re-resolve once within the same explicit job. Restart if the source fingerprint changed. |
| Remux or transcode fails | Delete temporary output, keep source fragments only for the bounded retry window, and report the media worker stage. |
| LAN endpoint is unreachable | Preserve the prepared Desktop package and offer encrypted user-cloud transfer when configured. |
| Cloud quota is insufficient | Keep the Desktop package and explain the required bytes. Do not partially publish the cloud manifest. |
| PWA quota is insufficient | Offer audio-only, a smaller video rendition, or eviction choices before downloading. |
| PWA leaves the foreground | Pause at the last verified chunk and resume on the next foreground visit. |
| Chunk authentication or checksum fails | Delete the failed chunk, retry from a trusted source, and never mark the rendition ready. |
| Browser evicts local media | Keep the saved item, downgrade device availability, and offer download again. |
| Offline file exists but cannot seek | Mark the rendition unhealthy, preserve diagnostics, and offer repackage or delete. |
| Device is offline before download completes | Keep verified partial chunks and resume when the selected transport returns. |
| Item becomes private, removed, protected, or regionally unavailable | Keep metadata and explain that no new package can be produced. Existing local state follows the user's deletion and retention choices. |

## Staged Milestones

| Stage | Capability | Exit condition |
| ----- | ---------- | -------------- |
| 1 | Authenticated website capture and playlist actions | No YouTube developer project or API credentials remain. Roster, recent videos, and playlist actions work through one persistent Desktop session with focused automated coverage. |
| 2 | Desktop audio resolver laboratory | One explicit public video produces a validated, seekable AAC package. Resolver version, source class, transform, checksums, and classified failures are observable locally. |
| 3 | LAN PWA audio download | A paired iPhone downloads, resumes, verifies, stores, deletes, and re-downloads one audio package from Desktop without media bytes entering Automerge. |
| 4 | Real iPhone offline and lock-screen proof | A long audio file survives airplane mode, cold launch, lock, seek, interruption, Bluetooth, and repeated resume tests on the supported iOS matrix. |
| 5 | Encrypted user-cloud media | Desktop uploads chunk-encrypted opaque objects, a paired PWA decrypts and verifies them, and deletion removes package objects and key material. |
| 6 | Audio-first playlist queue | The user can prepare several saved videos, download them in a foreground queue, see exact storage cost, and recover from interruption or eviction. |
| 7 | Optional video | One bounded H.264 and AAC rendition passes storage, range, seek, battery, eviction, and offline playback acceptance. Audio remains independently retainable. |
| 8 | Hosted relay decision | Measured LAN and user-cloud limitations justify or reject centralized infrastructure. Privacy, traffic differentiation, cost, abuse, retention, and provider risk receive a separate owner decision. |

## Validation Matrix

### Unit and Package Tests

- Extract stable channel and video identities from representative website data.
- Reject malformed IDs, deceptive hosts, invalid protocols, and ambiguous page
  states.
- Reconcile unfollows only after a complete roster.
- Preserve saved, read, hidden, archived, and tagged state during recapture.
- Serialize playlist jobs and classify added, existing, ambiguous, and failed
  outcomes.
- Select the approved audio and video profiles from representative format sets.
- Verify manifest canonicalization, chunk authentication, SHA-256 checksums,
  atomic publish, partial resume, and delete behavior.
- Prove media bytes and keys cannot enter Automerge or exported diagnostics.

### Desktop Integration Tests

- Login, session check, post-login capture, manual capture, disconnect, and
  session-expiry recovery use the established provider pattern.
- Bounded extraction reports candidate count, scroll passes, unresolved count,
  completeness, and stop reason.
- Playlist automation stops on changed or ambiguous controls without coordinate
  clicking or infinite retries.
- Resolver timeouts terminate child media processes and remove temporary files.
- Remuxed and transcoded outputs pass codec, duration, seek, and checksum probes.
- The LAN endpoint rejects missing, expired, wrong-device, and wrong-package
  capabilities and honors valid range requests.

### PWA Tests

- Storage preflight handles unsupported APIs, denied persistence, low quota, and
  `QuotaExceededError`.
- Foreground download resumes only from verified chunk boundaries.
- Startup reconciliation repairs stale indexes and removes abandoned partials.
- Service worker or Blob media URLs return correct MIME type, content length,
  range status, and seek behavior.
- Eviction protects pinned and active media, removes video before audio, and
  retains metadata.
- Offline UI never confuses saved metadata, YouTube playlist membership, Desktop
  package readiness, cloud availability, and this-device availability.

### Real iPhone Acceptance

- Home Screen installation and first download work on the oldest supported iOS
  version and the current release.
- Foreground download pauses cleanly on lock or app switch and resumes without
  redownloading verified chunks.
- Audio plays after a cold airplane-mode launch.
- Lock-screen metadata and controls remain correct through seek, pause, resume,
  interruption, wired output, Bluetooth, and AirPlay.
- Browser storage eviction is reproduced and the PWA repairs availability state.
- Optional video, when introduced, survives portrait, landscape, seek, lock,
  unlock, and low-storage tests without degrading the audio-only path.

### Soak and Provider-Risk Checks

- No background resolver or channel-wide media downloader runs without an
  explicit user selection.
- Current capture contacts only the ordinary authenticated pages required for
  the bounded action.
- Resolver request count, retry count, duration, and child process lifetime stay
  within declared budgets.
- Repeated failure does not create a retry storm against YouTube, LAN peers, or
  cloud storage.
- Hosted relay work cannot begin under the current approval for local research.

## Reference Notes

- [YouTube Universal Links](https://support.google.com/youtube/answer/7174035?hl=en)
- [Apple Universal Link behavior](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content/)
- [YouTube IFrame player parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube IFrame Player API events and errors](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube privacy-enhanced embed mode](https://support.google.com/youtube/answer/171780?hl=en)
- [YouTube Premium background playback](https://support.google.com/youtube/answer/6308116?hl=en)
- [YouTube offline behavior](https://support.google.com/youtube/answer/7381437?hl=en)
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit Origin Private File System](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)
- [Background Fetch support boundary](https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API)
- [Encrypted WebRTC data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [Apple Media Session overview](https://developer.apple.com/videos/play/wwdc2021/10189/)
- [Apple HTTP Live Streaming](https://developer.apple.com/streaming/)
- [yt-dlp proof-of-origin token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
