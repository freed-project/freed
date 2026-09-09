# Demo capability audit and delivery handoff

As of September 9, 2026, the demo fixes are implemented and merged into `dev` through [PR #1966](https://github.com/freed-project/freed/pull/1966). They have not been deployed to the public demo by this task. The source machine has stopped implementation. This document supports continuation on another machine; do not repeat or cherry-pick the merged implementation.

## Source identity and scope

- Squash merge: `62a149752c046303aef243009efce086917a2936`, merged September 9 at 20:48:10 UTC.
- Final tested PR head: `a93e1c94e2239c49a79eb8e5ed5023df694f0338`.
- Merge footprint: 36 text files, 422 insertions and 76 deletions. No binary assets, new dependencies, schema migrations, downloaded photographs, or bundled map data.
- This handoff PR changes documentation only and must remain draft until the owner chooses its disposition. It does not authorize deployment or restart work on the source machine.

## Findings and architecture

The original failure was a search action offering to promote a person, then invoking an unavailable Person SQLite mutation. The solution derives capabilities from platform configuration and routes supported demo changes through the existing isolated demo session. Unsupported controls have both visibility and handler guards where appropriate. Hiding a toast alone would leave misleading behavior.

| Exposed functionality | Failure or misleading behavior | Implement or hide | Implemented boundary |
| --- | --- | --- | --- |
| Search friend and close-friend promotion | Unavailable Person SQLite mutation | Implement | Existing demo care callback; hydrate linked person records with bounded point reads so current care is accurate. |
| Create people and link accounts | Requires unsupported library writes | Hide | Search commands, Friends linking and unlinked relationship drops respect capabilities. |
| Friends graph pins | Missing mutation callback or pin loss after care change | Implement | Existing registered device-layout mutations in the memory-only demo SQLite worker; serialize with care changes. |
| Archive maintenance and unarchive saved | Unsupported demo maintenance | Hide | Toolbar, overflow and stale command entry points are guarded. |
| Add feed, saved-content and library maintenance dialogs | Unsupported operations reachable through commands | Hide | Dialog mounting and command access are capability-gated. |
| Diagnostics menus, shortcuts and drawer | Exposes implementation details or unavailable operations | Hide | Friends diagnostics, drawer, keyboard path and copy handler are guarded. |
| Offline reader cache and automatic archive deletion | Settings imply unsupported maintenance | Hide | Demo settings omit controls; presentation preferences remain isolated. |
| StoryWall import and publish | Requires file/archive or remote publishing integration | Hide actions, retain preview | Preview preferences and content remain; import, publishing targets and credentials are omitted and handlers guarded. |
| YouTube player | External player/API failure or blocked embedding | Retain thumbnail and post | Demo omits playback, iframe and player API; existing real thumbnail and credits remain. |
| Remote reader photographs | Broken image can damage the reading experience | Implement graceful fallback | Local image error state renders a small unavailable-image message while retaining post text. Existing URLs and attribution remain. |
| Live map | Failed map resources can leave an unusable surface | Implement graceful fallback | Dispose the failed MapLibre map and show the existing simplified map and location markers. |
| Empty feed scopes | Connect, populate or clear controls suggest unsupported operations | Implement navigation, hide maintenance | Return to feed clears search and uses shared navigation; sample-data controls are guarded. |
| Fatal application error | Raw SQLite/error details and inappropriate recovery controls | Implement safe recovery | Demo shows plain reload recovery; full diagnostics and reset controls remain outside demo mode. |
| Newsletter submission | Raw HTTP/backend errors | Implement safe failure messages | Retain inputs, allow retry and show specific rate-limit guidance. Real submission was not exercised. |
| Preview navigation | Canonical routes dropped `freed-demo=1`, disabling demo behavior | Implement | Preserve the accepted flag only for a Vercel preview entry URL that already enabled demo mode. Normal PWA origins do not gain demo mode. |

Core capability derivation lives in `packages/ui/src/context/PlatformContext.tsx`. The UI remains platform-agnostic; demo mutation ownership remains in `packages/pwa/src/lib/demo-checkpoint.ts`. Demo mode is recognized through the existing `interactionMode` configuration and callbacks, not a second writable library implementation.

Pin preservation uses bounded graph pages of 128 identities with a 1,000-identity cap. Only pinned coordinates are retained temporarily and replayed through registered mutations after fixture activation. Care and pins reset on reload. This does not introduce persistent data authority, raw SQL bypasses or a new storage system.

### Maps and photographs will not bloat the repository

`MapSurface.tsx` reuses the simplified map that already exists. It adds resource-error handling and cleanup, not offline map tiles, geography datasets, new mapping packages or retry infrastructure. `ReaderView.tsx` adds an image error fallback, not an image archive, proxy or local photo cache. Real corpus photographs stay remote and retain their existing attribution. Neither change creates media files in Git.

Full offline maps, mirroring the photograph corpus, a media proxy, full demo library editing, account linking, sync or remote StoryWall publishing would be materially larger projects. None is part of this implementation or recommended for closing this audit.

## Validation already completed

The implementation passed `npm run validate:feature`, package typechecks, the PWA build, artifact policy and roadmap validation. Reported package runs were UI: 90 files and 513 tests; PWA: 58 files and 452 tests; Desktop: 135 files and 874 tests. Additional focused checks overlap these totals. Required Feature validation and Tooling smoke checks passed on the final PR head before merge.

Headless browser checks established:

- Search promotion updates care without a SQLite toast; Friends shows the current value.
- A graph pin survives another care change. Reload resets both care and pin state.
- StoryWall preview renders real images while import, publishing and credential controls are absent.
- Empty Archived scopes behave on desktop and a 390 by 844 viewport; Return to feed works.
- A real YouTube thumbnail decodes; the demo creates no player iframe or player API script.
- Forced map resource failure renders 129 existing simplified-map markers, with zero live MapLibre canvases or user alerts.
- Preview-origin route navigation retains `freed-demo=1`; promotion, pinning, reload and StoryWall preferences continue working.

The last preview-origin check served the final local compiled bundle through headless browser route fulfillment. It was not a hosted deployment. The earlier automatic hosted preview belonged to `bbd533fc00e1830339a2c17b27ce991a40902537` and must not be treated as verification of the final code. Production acceptance remains outstanding. No authenticated provider interaction or real newsletter submission was required for these checks.

Phase 6, 8, 10 and 12 documents and `docs/roadmap-status.json` were updated in the product commit. This handoff does not change phase status.

## Remaining work and timing

[Issue #1968](https://github.com/freed-project/freed/issues/1968) tracks the one known code blocker to reliable preview delivery. `scripts/pwa-vercel-ignore-build.mjs` passes repository-relative pathspecs to Git while running from `packages/pwa`. Against an available prior deployment, Git can incorrectly report no relevant changes and cancel a required build.

The reproduction compares `aa62f8a159471a31447040d814b0231e15aefb0e` with `bbd533fc00e1830339a2c17b27ce991a40902537`. `planPwaVercelBuild` returns `ignore: false` from the repository root and `ignore: true` from `packages/pwa`. A Vercel status reported success with the description `Canceled by Ignored Build Step`; this is not deployment success.

Recommended repair: resolve the repository root for Git calls or use top-anchored pathspecs. Test both invocation directories, relevant and irrelevant changes, and an available baseline. Preserve the baseline fix from closed #1812. Keep #1968 as the canonical issue.

A manual preview attempt built the staged bundle but failed with `The specified scope does not exist` and could not access `freed-pwa` in `aubreyfs-projects`. The receiving machine must verify access to that permitted scope. Do not change scopes or bypass project controls to work around it.

The remaining code repair is bounded. Review, that repair and targeted verification are plausibly within one to two hours of machine time if hosting access works. CI queues, missing hosting access and production authorization prevent a guaranteed wall-clock commitment. There is no large maps or photographs implementation outstanding.

## Receiving-machine checklist

1. Fetch and read the current `origin/dev:AGENTS.md`. Verify the merge above is present in the current lane. Read the build skill and scoped instructions before changing files. Use the pinned Node toolchain and an isolated worktree from fresh `origin/dev`.
2. Review PR #1966 and this inventory. Preserve the existing real photographs and simplified-map design. Do not rebuild merged features or expand the demo into a full writable library.
3. Reproduce #1968, apply the bounded path-resolution repair, add the cheapest deterministic regression coverage and run the required local publication gate. Publish that repair separately; this documentation PR remains the handoff record.
4. Verify Vercel project access in `aubreyfs-projects` using repository helpers. Build a hosted preview of the actual candidate. Confirm its source commit and actual completed deployment, not merely a green canceled-build status.
5. Repeat the browser acceptance scenarios above against that hosted preview. Also force a reader photo failure and confirm readable text and fallback; exercise safe newsletter failures without submitting a real address. Check hidden actions through search, menus and keyboard paths as well as visible buttons.
6. The last granted task level was 5. Production deployment requires Level 6 under the repository policy. Obtain that level on the receiving machine before production publication, then follow the applicable deployment workflow. The source machine will not deploy or resume implementation.
7. Verify the public demo serves the approved artifact and repeat the core promotion, pin, navigation, image and map checks. Record exact source and deployment identities and any remaining limitations. Do not claim that every possible network failure is eliminated; the contract is supported demo actions and graceful failure handling.

The original implementation worktree and branch were removed and its preview was stopped. The source launcher had unrelated untracked files and was preserved. This new draft documentation worktree has no app preview or implementation process. The receiving machine is the sole executor of remaining implementation and deployment work.
