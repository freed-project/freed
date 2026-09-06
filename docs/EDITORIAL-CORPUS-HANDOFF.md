# Editorial corpus continuity transfer

## Start here

The owner stopped this task on September 6, 2026 and requested a pull request plus a complete continuity comment so other agents can work in parallel. **Authoring is stopped at 391 accepted illustrated entries.** This is a transfer checkpoint, not completion of the 500-entry milestone or a demo release.

Read [the canonical editorial guide](SAMPLE-CORPUS-EDITORIAL-GUIDE.md), [character canon](SAMPLE-CHARACTER-CANON.md), the full runtime arc for an assigned character, then its latest admission records. Do not read every historical draft before starting. Historical targets, approvals and task instructions are superseded by this document and the current owner request.

## Verified inventory

| Measure | Count |
| --- | ---: |
| Accepted illustrated entries | 391 |
| Regular entries | 288 |
| Visual Stories | 103 |
| Authored source episodes | 787 |
| Excluded null-media episodes | 396 |
| Editorial identities with reviewed avatars | 134 |
| Represented characters | 133 |
| Authored platform accounts | 237 |
| Disabled sample subscriptions | 64 |
| Media catalog records | 2,176 |
| Additional accepted entries to 500 | 109 |

Instagram has 83 Stories and 92 posts. Preserve the posts and prioritize new Stories; 55 more Stories reach 60% at that fixed post count. Facebook has 20 Stories and 70 posts. Other accepted regular entries: X33, LinkedIn12, RSS64, Medium8, Substack4, YouTube5. These are corpus counts, not platform usage statistics. [Format research](drafts/PLATFORM-FORMAT-BALANCE.md) records evidence and limits.

Recompute from runtime with pinned Node: `node docs/drafts/editorial-counts.mjs`. Catalog records, excluded drafts, duplicate copies and avatars never increase accepted totals.

## Parallel continuation contract

1. Each author works in a separate worktree based on the exact PR head accepted for transfer. Do not merge this PR or another task's branch without owner authorization. Read current repository governance before implementation.
2. Assign disjoint characters and unique batch IDs before authoring. Next unused numeric batch is 170; suffixes or author namespaces are preferable to collisions. A character's complete timeline belongs to one author at a time.
3. Authors own proposal Markdown/JSON, source provenance and review notes only. A separately designated integrator owns runtime arcs, media catalog imports, counters, canon updates and admissions. Do not let every worker edit shared registration files.
4. Every candidate needs an author decision and an independent reviewer decision on prose, exact image, source-specific rights, biology, continuity and corpus repetition. An explanation of why something is funny cannot substitute for the prose.
5. Preserve original bodies on media recoveries. Record rejected drafts literally with reasons, so the next author does not repeat failed mechanisms. New photos for accepted entries are replacements, not additions.
6. The integrator serializes accepted admissions, checks uniqueness, recomputes counts and updates the current checkpoint. Reserve the final available slots before admitting near500. Stop at exactly500 for the owner to publish a demo release. The remaining500 and future token-efficiency exploration are deferred.
7. Never contact, inspect, monitor, coordinate with, interrupt or change DEMO LAUNCH, its worktree, processes, dependencies, automations or task state. Keep installations, test caches and previews local to each editorial worktree.

No active author assignments survive this handoff. Existing author workers saved their work and stopped. The heartbeat service reported that `editorial-corpus-continuity` no longer exists when deactivation was attempted; do not recreate it unless the owner requests a new schedule. The old goal record has obsolete1,000-entry wording and is not editorial authority. This task is closing by owner request.

## Pending work, excluded from391

The owner explicitly requested preservation of promising unfinished writing. Start with [promising unfinished work](EDITORIAL-UNFINISHED-WORK.md); [all396 unpaired runtime passages](drafts/EDITORIAL-UNPAIRED-INVENTORY.md) are preserved verbatim. Missing media is not a reason to erase a promising passage.

| Packet | Disposition and next step |
| --- | --- |
| [BOTANICAL165](drafts/BOTANICAL-EDITORIAL-165.md) | Vesta, **What met my foot**. Author and [root review](drafts/BOTANICAL-EDITORIAL-165-ROOT-REVIEW.md) support unchanged Instagram Story. Not integrated before owner stop. Check uniqueness and admit if still suitable. |
| [CYGNUS167](drafts/CYGNUS-RECOVERY-167.md) | **The missing one**, original Instagram regular recovery. [Independent review passes unchanged](drafts/CYGNUS-RECOVERY-167-REVIEW.md). Bind original null slot only, preserve nine-cygnet fictional canon; the pictured brood is not a documentary count of nine. Not integrated. |
| [AQUATIC163](drafts/AQUATIC-EDITORIAL-163.md) | Tentative Frogbert **A firmer greeting**. Partner and gesture are offscreen; image-fit and prose review remain unresolved. Check anatomy carefully, including which fins can bear weight. Protect his approved "grey." passage. No admission. |
| [NIB168](drafts/NIB-SOURCE-168.md) | Source exploration only. Yawning passage already accepted. Sleeping image may support an original recovery, but rights and pairing review are unfinished. Two Commons requests returned429; do not retry as a loop. |
| [LAND169](drafts/LAND-EDITORIAL-169.md) | Sixteen reviewed images and two unfinished prose holds. No approved candidate. Renew canon/behavior checks if revisiting. |
| [LAND164](drafts/LAND-EDITORIAL-164.md) | Seven image holds, two literal prose holds. No admission candidate. |

Flora166 **Before the pink** is already admitted. Mabel159, Manny160 and Maud161 are also admitted. Do not add them twice. Other historical pending labels can be stale; the runtime binding plus latest admission document governs.

Recent continuity to preserve: Lark154 has three dependent young in her adult breeding episode; Oona156 has released some mature material and cannot silently return to an earlier stage; Ines158 is the lower bird in a mating pair, with no offspring or lifetime bond asserted; Mabel159 is a juvenile recollection before the adult avatar. Existing accepted bodies and avatars remain intact.

## Runtime map

- `packages/shared/src/sample-character-arcs*.ts`: stable character episodes. Some use JSON-shaped arrays, others tuple helpers and reviewed bindings. Resolve through runtime before deciding an episode is null.
- `packages/shared/src/sample-corpus-*-media.json` and `sample-corpus.ts`: exact media provenance and registration. Episode and catalog `subject` must match literally. One accepted hash resolves once.
- `sample-character-avatars.ts`: reviewed portrait bindings, separate from episode illustrations.
- `sample-editorial-data.ts`: accepted projection, stable identities/accounts, platform overrides, chronology, disabled feeds and separate attribution.
- `sample-data.ts`: showcase uses accepted projection; explicit stress mode retains synthetic scale behavior.
- `sample-youtube.ts`: actual playable URL projection and first-person narrative/credit layout. No fabricated upload or attribution.
- `packages/pwa/src/lib/demo-checkpoint.ts`: consumes the shared accepted showcase. Existing checkpoint version, activation and storage authority remain unchanged.
- `packages/ui/src/components/feed/ReaderView.tsx`: preserves YouTube line breaks and separate image credit, removes misleading Summary badge from complete sample copy.

New exported projection and YouTube helpers have real callers in sample-data, sample-corpus and their focused tests. This PR does not authorize live provider behavior, database migration or deployment.

## Validation and limits

All46 focused tests across six suites pass: shared corpus and YouTube, PWA sample and demo checkpoint, UI seed and ReaderView. Shared TypeScript, direct runtime counts, roadmap validation and whitespace checks pass. Offline rendered desktop/mobile reader evidence is in [the formatting review](drafts/YOUTUBE-READER-FORMATTING-ISOLATED.md) and `output/playwright/editorial-reader/`.

Portable focused-test configuration: `docs/drafts/editorial-vitest.config.mjs`. Recreate its isolated dependencies from `docs/drafts/handoff-evidence/validation-package.json` and `validation-package-lock.json` in a temporary directory, then run from repository root:

```sh
EDITORIAL_TEST_DEPENDENCIES=/absolute/task-local/node_modules \
  /absolute/task-local/node_modules/.bin/vitest run \
  --config docs/drafts/editorial-vitest.config.mjs
```

Use Node24.14.1 from `.nvmrc`, with matching npm/npx. Do not install into or symlink another task's dependencies. The dedicated test config uses one worker and no file parallelism. The demo checkpoint test mocks SQLite, so it does not establish live database activation.

`npm run validate:feature` was attempted at publication and failed at root typecheck because package dependencies such as `tsc` are absent in this deliberately dependency-free worktree. The machine preflight also reports absent host automation guard files. Do not repair shared controls from an editorial task. Full integration gates, live media delivery for the complete corpus, browser React hydration, live YouTube playback and production release are unverified. This transfer remains a draft PR.

## Evidence portability

Proposal JSON contains public source URLs, exact delivery URLs, hashes, credits, dimensions and review decisions. `/tmp` image paths are local review caches and will not exist on another machine. Re-fetch the exact recorded delivery and verify its hash before continuing image review; do not substitute another image from the same observation. Raw compact primary metadata for pending165/167 and admitted166 is preserved in `drafts/handoff-evidence/`. Earlier source provenance remains in individual proposal/catalog records. Remote source photos are intentionally excluded from Git; offline UI screenshots are retained as validation artifacts.

The former guide and running handoff are archived under `docs/drafts/`. They preserve work and owner decisions, but their old permissions and shared-task instructions must not restart another task or override this transfer.
