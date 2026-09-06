# Demo functional verification

Local evidence recorded September 5, 2026. This is not production acceptance.
Editorial counts live in the editorial admission records and change separately.

## Verified locally

- Empty-provider label placement now shares one vertical-offset calculation
  between the interleaved GPU buffer writer and Three.js WebGPU. The latter
  previously ignored the centered flag. The focused live-label suite passes
  five tests, including centered and raised buffer values; PWA typecheck passes.
  This validates placement math, not a new Three.js rendered screenshot.
- The owner's September 5 preview screenshot showed the persistent Library's
  busy-tab refusal. Code inspection found that the anonymous demo opened OPFS
  and requested the same origin-wide lock. The exact original lock holder was
  not established. Demo-selected workers now use isolated SQLite memory stores
  and no OPFS content vault. A headless same-context two-tab proof loaded both
  feeds while a synthetic holder retained the persistent lock. Both displayed
  304 items at that source snapshot; neither requested release of that lock.
  The synthetic holder and second test tab were closed afterward. Thirteen
  worker-client/demo-mode tests and PWA typechecking pass. No persistent data,
  epoch, schema, authority key, or replication contract changed. Ordinary app
  workers keep the existing writer exclusion. Reload is required for a page
  already displaying the old startup refusal.
- Fresh-document Raw WebGPU Galaxy review: wheel zoom to scale 1.30 shows
  101 ready labels and 12 rendered avatars without selecting an identity or
  profile. The rendered shell includes Cato, Luna, Corin, Agnes, Oswin and
  Mira portraits, with smaller provider labels next to their orbiting dots.
  Screenshot: `/tmp/freed-galaxy-profile-shell-20260905.png`. The wide view
  retains provider particle clouds after settling. Dense multi-account labels
  still overlap around Calder at this intermediate zoom; this probe does not
  establish collision-free labeling or cross-backend acceptance.
- Mobile banner review at 390 by 844 pixels: the settled newsletter panel
  remains fully visible after dragging near the top and opening the form.
  Its rendered bounds are x=16, y=56, width=358, height=378. Horizontal
  margins stay balanced; the form expands down rather than crossing the top.
  Measure the transformed child panel, not its stationary positioning wrapper.
  Both labeled fields appear immediately, the title reads Freed Newsletter,
  and the demo description is absent. The lower actions use 12 px text and
  36 px height; the primary submit action is 50 px high. The unsubscribe
  sentence is centered. Synthetic email `jane.doe@example.com` suggests
  Jane Doe; changing the email preserves a manually entered Chosen Name.
  Skip returns to the demo panel. No subscription was submitted. Screenshot:
  `/tmp/freed-newsletter-mobile-settled-20260905.png`.
- YouTube reader descriptions preserve narrative paragraphs and separate credit
  lines. The existing reader suite passes 10 tests, including newline preservation.
- Profile metadata admission uses compiled XYZ coordinates, matching compact
  rendered shells. A regression with 620 nodes fails before the correction and
  passes afterward; worker and scene suites pass 17 tests.
- Rendered Raw WebGPU close-zoom proof shows Velvet Night's Instagram label
  beside its profile dot without selection after the coordinate correction.
  The combined worker, scene, fade, ambient-motion, and reader run passes 34
  tests. This is not a complete cross-backend visual acceptance result.
- Replacement feed records have null read and seen timestamps.
- Demo theme and device display preferences reset on document reload. Native
  credentials, consent, and real subscription records are not erased.
- Friends membership is stable and rounded to 15% of admitted identities.
- The Friends header uses the filtered reader count. Browser proof showed 34
  Friends entries versus 252 All content entries at that corpus snapshot.
- The full PWA unit suite passed 403 tests before the latest avatar contract
  addition. The subsequent avatar and checkpoint suites passed 23 tests.
- PWA TypeScript validation passed after those additions.
- All 93 reviewed avatar URLs loaded and passed anonymous cross-origin canvas
  readback using the configured delivery URLs, including 15 NOAA relay entries.
- The capture script produced five themed PNGs and a 933 KB GIF locally.
  Visible images are loaded and decoded before capture. Themes are selected
  after navigation through the real Settings UI.
- Release tooling contract tests passed all 17 tests. Structured roadmap
  validation passed all 13 phase records.
- Production CSP is exercised through `?freed-demo=1`, not inferred from normal
  localhost. The YouTube view loaded eight visible images with no policy
  violations; two offscreen lazy images were not requested by that probe.
  The allowlist test checks all current admitted media and avatar origins.
- PWA checkpoint tests pass 14 cases, including production-policy activation
  from both the real hostname and loopback query. The screenshot gate now also
  records visible image failures before React removes failed image elements.
  Its first guarded run correctly rejected a failed Atolla image rather than
  accepting a fallback. Media delivery repair remains with editorial; this
  failed run is not release acceptance.

## Release preflight

USGS delivery integration: the exact `d9-wret.s3.us-west-2.amazonaws.com` host
is admitted for reviewed images, with no S3 wildcard or added connect sources.
The Botanical46 macro passed the relay factory's existing byte, signature and
hash checks: 624,223 bytes in 730 ms. Sabine's NPS avatar passed and is registered,
along with seven other newly reviewed portraits. Sylvia and Nestor timed out
at the unchanged five-second bound and remain unregistered pending delivery
repair. No completeness claim applies to that remaining pair.

Showcase manifests record rendered feed and Stories counts. The owner's later
functional-first release instruction permits a partial reviewed corpus labeled
`interim`. Only exactly 900 regular entries and 100 Stories receive `complete`.
Finalization and public verification reject missing, inconsistent, overfull,
string-coerced counts and a false completion label. All 21 asset and release
governance tests pass, including both public URL variants for interim releases.
This does not claim the corpus has reached its target.

Read-only `validate-release-tag-authority.mjs` passed for `freed-project/freed`.
`release-tag-publisher.mjs verify-installation` also passed, confirming the
dedicated Freed Release Publisher App installation and repository scope.
These checks do not create a tag, approve a source snapshot, or publish a build.
Automation actor enrollment is not evidence of a release publisher failure.

September 5 preflight: pinned Node, npm, npx, GitHub CLI, and Git credentials
pass. Strict doctor still fails on missing automation guard state. The host has
no canonical task manifest; cutover requires one, while task creation requires
the cutover receipt. No authority records were fabricated and no actors were
activated. Normal authenticated publication treats doctor as advisory, and the
feature, dev, and release validation plans do not use the host automation
receipt. September 6 inspection found the old Mac state in retired-authority
and a retained cutover plan targeting Linux. Do not recreate that retired
authority. The Mac's separate root-owned release publisher passed its live
installation verification again. SSH access to the Linux host failed at the
configured signing agent; no remote mutation was attempted.

Release-asset integrity helpers from the earlier task release-control worktree
are integrated here. The workflow finalizes hashes and GitHub URLs after GIF
generation, then verifies tag-specific and latest downloads after publication.
Twenty local asset and release-tooling tests pass; public delivery remains
unverified until an actual production release runs.

## Still required

Visual inspection rejected the nominally successful five-view capture at
`/tmp/freed-showcase-final-functional-20260905`: its Map image showed markers
before the basemap. MapSurface now distinguishes construction readiness from
settled tile readiness, resetting the latter during movement and data loading.
Release capture waits for the settled state. A subsequent rendered probe at
`/tmp/freed-map-tiles-settled-20260905.png` shows the basemap. That older browser
session has a separate stale Library error, so it proves tile rendering only,
not current marker completeness. PWA typecheck, nine existing map unit cases,
and 17 release-governance tests pass. The complete capture rerun stopped before
Map on two visible Commons elephant image failures; those sources were sent
to editorial. Neither run is accepted as the final GIF source.

The complete `npm run validate:feature` command passed September 5 after the
stress-generator and avatar delivery fixes, including all six WebKit OPFS
cases in one run. This covers the live working-tree snapshot used by the run.
Final publication still requires a frozen source commit and exact-head CI.

Latest delivery rerun: Ansel's reviewed display portrait passed the actual relay
with matching SHA1, 253,405 bytes and 894 ms elapsed, and is registered. The full
PWA unit suite passes all 410 tests in 21.66 seconds. All 797 Desktop unit tests
and all 67 selected release-tooling tests pass. These are local working-tree
results, not a final immutable release receipt.

The capture probe produced populated Unified, Stories and Instagram images,
then correctly failed on the visible Commons wrasse-and-moray image during the
Map transition. Stories output was visually inspected and has real imagery,
including the formerly missing Euphemia portrait and Story image. The failed
source was returned for reviewed delivery repair. Capture timeouts now report
up to ten unresolved image URLs and policy failures instead of a generic wait
timeout. The five-view production capture and public GIF remain unverified.

Latest September 5 validation: the full PWA unit suite now finishes in 21.45
seconds, with 409 passing tests and one avatar-registration failure for Ansel.
The former hang was the stress generator exhausting a finite caption pool.
The fix caps candidate attempts and restricts synthetic fallback to explicit
benchmark data. The three previously failing WebKit cases all passed in
isolated reruns without storage changes.

All nine AVATAR-DELIVERY-34 portraits passed the actual relay handler and were
registered. The release showcase build now explicitly declares production
release metadata. All 20 release-asset/governance tests pass after that change.

Later September 5 rerun: root typechecking, provider unit/browser checks and
the production PWA build passed. Desktop smoke passed all nine cases.
Full PWA unit validation did not finish: a worker remained CPU-bound in
promise microtasks. A process sample was preserved before stopping that worker;
a serial verbose run is isolating the test. The separate WebKit OPFS run passed
three cases and failed interrupted population, worker-loss recovery and corrupt
generation recovery. Traces are retained. The interrupted-population trace
includes a dev-server disconnection and page reload, so that failure alone does
not establish a production storage defect. The isolated interrupted-population
rerun passed in 31.9 seconds without source changes. Worker-loss and corruption
cases are being rerun separately before assigning a cause.

The avatar relay now verifies and serves JPEG or PNG signatures with matching
MIME types. Its closed registry, SHA1 checks, 4 MiB limit, five-second timeout
and redirect refusal remain unchanged. Thirteen focused functional tests pass.
Cedric's PNG was verified against its reviewed hash and registered; unresolved
portrait delivery failures still prevent a completeness claim.

September 5 image delivery follow-up: exact `www.nps.gov` and `www.fws.gov`
hosts are included in the demo CSP and release capture allowlist. All 14
checkpoint tests pass. Avatar registration tests caught newly admitted NPS
portraits missing from the relay registry; verification is in progress.
Full feature validation stopped at two unsupported editorial theme values in
`sample-character-arcs-aquatic-twenty-six.ts`. The editorial owner has the exact
errors. No passing full-validation claim applies to this snapshot.
Independent reruns pass: 32 Galaxy worker, scene, fade, ambient-motion and
avatar-admission/crop tests; 20 demo reset/checkpoint tests; 20 release-asset
and governance tests; all 13 structured roadmap statuses.

- Complete and independently review exactly 900 regular entries and 100 Stories.
- Recheck every queued Galaxy behavior and the final corpus in rendered views.
- Validate the finished exact source, publish and merge through the governed
  product and release lanes, and run required native release proof.
- Generate showcase assets from the exact release build, not the live local
  development server used for the functional probe.
- Verify public screenshot/GIF URLs, the official production demo, deployed
  avatar relay delivery, and the signed release artifacts.

Local probe output is under `/tmp/freed-showcase-functional-check-20260905`.
These binaries are not committed to the repository.

### Avatar delivery and isolated demo storage follow-up

The actual relay handler returned HTTP 200 with matching source hashes for
Nestor's repaired JPEG (148,225 bytes), Sylvia's repaired WebP (233,024 bytes),
Eustace's portrait (224,613 bytes), and Lucille's portrait (212,918 bytes).
All four exact URLs are registered. WebP admission requires both RIFF and WEBP
signatures plus the reviewed hash; the four MiB limit, five-second timeout,
anonymous request, redirect refusal, and no-retry behavior remain intact.

Five worker-dispatch regression cases exercise the disposable demo boundary:
official demo and explicit preview workers use RAM without acquiring the
persistent lock, while the ordinary app, disabled local demo, and ordinary
worker retain that lock. The PWA TypeScript check passes with these tests.
This is local functional evidence, not production deployment evidence.

### Desktop avatar cache

Shared author/profile avatars, map markers, and Galaxy image decoding now use
one native cache route on Desktop. Canonical source URLs remain unchanged.
Startup and identity changes trigger bounded backfill through Person and Account
graph pages, including identities not currently onscreen. Demo hotlinks are
unchanged. Native transfers validate public HTTPS destinations at every redirect,
cap images at two MiB, limit active work to two buffers, and suppress repeat
failed requests for 15 minutes.

All 176 native tests passed with all features. The repository native Clippy lane
passed with existing monolith warnings. Twenty-two focused UI/backfill tests and
both application TypeScript checks passed. An isolated app build succeeded.
A temporary hidden WebView then exercised the actual protocol against a local
fixture: HEAD returned 200, the image decoded at 32 pixels, and its canvas was
readable with anonymous image loading. The probe exited successfully and its
source was removed. Production publication and PWA cache parity remain unverified.

## Demo care and membership consistency

The checkpoint seed previously assigned care and membership independently. It now
keeps the rounded 15% Friends cohort while requiring every Connection to have one
or two stars and every Friend or Fam identity to have three through five. Curated
close relationships receive cohort priority. Membership stays stable across timeline
reshuffles. All 14 checkpoint tests passed, including the new per-identity invariant.
This is baseline data consistency, not proof of demo-session rating edits.

## Demo-session care interaction

Directory and selected-identity ratings now accept session-only care edits. The
existing checkpoint importer atomically replaces the isolated memory fixture;
normal read-only restrictions remain in place for all other Library operations.
Live browser proof changed Ludo Bluecap from five stars to one, reduced the
Friends count from 17 to 16, and rendered Connection in 1,499 ms including click
and rendering overhead. Reload restored five stars and 17 friends. The reload
check used a bounded Person detail query because timeline reshuffling moved
Ludo outside the visible virtual-list window.

This proves the current 307-entry fixture, not final 1,000-entry performance.
Two session tests cover lifecycle and failure containment without provider
traffic. No production deployment is implied.

September 6 functional checkpoint: `npm run validate:feature` completed with exit
zero after the care-session implementation. It covered root contracts and
typechecking, 161 provider unit tests, 23 provider browser tests, 423 shared tests,
421 PWA tests, the PWA build, six WebKit OPFS durability scenarios, 801 Desktop
unit tests, nine Desktop smoke scenarios, the Desktop build, native Rust checks,
and the selected release, instruction, activation, updater and roadmap checks.
This checkpoint precedes integration of the nine newer `dev` commits and does
not substitute for exact-head CI or production artifact verification.

The current `dev` snapshot merged cleanly into the functional branch at
`512ce5e25f2088802c92990c4cad28d1ae22cdaa`. A second full feature gate passed,
including 830 Desktop unit tests after upstream integration. During that gate,
the remaining fallback label correction was applied before the Desktop build:
WebGL2 and Canvas now share larger profile-label sizing and node tint selection.
Fourteen focused label/engine tests passed. A temporary real Canvas fixture
render confirmed identity labels follow their node color; the probe was removed.
Its screenshot is local evidence, not a complete provider-label visual matrix.
The PWA production build is rerun separately because its earlier gate stage
preceded this narrow correction.
