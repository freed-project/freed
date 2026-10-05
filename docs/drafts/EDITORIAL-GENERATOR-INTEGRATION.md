# Isolated editorial generator integration

## Implemented and verified locally on September 6, 2026

`sample-editorial-data.ts` now projects accepted arcs into showcase data. `sample-data.ts` routes showcase calls there and retains explicit stress/custom graph generation. The anonymous demo's separate mapper was removed because it overwrote episode platforms, Story types, reviewed portraits and real YouTube sources. `demo-checkpoint.ts` now consumes the same explicit showcase projection. Its normalized serializers, fixed synthetic authority constants, staging functions and activation calls were not changed.

Current source produces 391 accepted items, 103 Stories, 133 represented characters, 237 authored platform accounts and 64 disabled sample subscriptions. The editorial source still has 134 identities with reviewed avatar bindings; identities with no accepted episode are not padded into the displayed showcase. Five YouTube entries use actual watch URLs, first-person titles and exact narrative paragraphs followed by separated credits. Item IDs bind batch, character, platform and media hash, independent of presentation order. Character chronology survives interleaving and previous-top avoidance.

Sample subscriptions are explicitly disabled. The sentinel domain alone was not a sufficient refresh boundary. Independent review confirmed the enabled-feed request path and the correction. Numeric seeds now use the existing PRNG's integer coercion before indexing. Both findings are resolved in [independent review](EDITORIAL-GENERATOR-REVIEW.md).

The legacy synthetic stress generator could loop indefinitely while searching a finite text-template pool for another unique string. That loop is now bounded, with a clearly marked stress-fixture suffix on remaining collisions. The 6,201-item, 1,000-person and 6,000-account stress check completed in 57 ms with unique text. The original unbounded probe was interrupted through its own terminal session. Showcase prose does not use that path.

Validation: 37 tests passed across five focused suites in 1.76 seconds: shared corpus, YouTube projection, PWA sample generator, canonical demo checkpoint construction and shared UI seed notifications. Shared generator TypeScript checking passed with the lockfile's TypeScript 5.9.3. The roadmap validator and git diff --check passed. Canonical-record tests mock database runtime imports; they do not claim database activation or live persistence proof. Rendering and the full repository gate remain outstanding.

Validation tools were installed only under this task's `/tmp/freed-editorial-validation-runtime` and `/tmp/freed-editorial-validation-cache`, using lockfile versions, a single Vitest worker and no shared worktree dependencies. No package manifest or repository lockfile changed. Temporary configs are under `/tmp/freed-editorial-vitest-*.config.mjs`.

Library Core review loaded `docs/LIBRARY-CORE-CONTRACT.md`, `docs/library-core-contract/checkpoints.md` and `.agents/skills/freed-library-core/references/delivery-validation-and-closeout.md`, totaling 28,203 bytes. This is synthetic input construction through the existing normalized-v2 builder, not a storage transition. SQLite engine, schema, protocol, checkpoint registry, fixed demo epoch/authority tuple, serialization and staging/activation implementation are unchanged. No live frontier, key, writer, receipt, database selection or outbox was touched. Reverting these local source edits before publication is sufficient; no executed data transition requires rollback.

Admissions86 through98 are documented in their root admission records; held batches add no entries. LAND100, Luna101 and Sela103 are admitted; Edmund101 remains held. Full corpus completion remains required.

## Historical gap measured before this correction

A native Node 24.14.1 invocation of `generateSampleLibraryData` in this isolated worktree used batch `editorial-isolation-audit`, seed 1 and generatedAt 1788652800000. It produced 1,701 items, 15 Stories, 250 people, 1,500 accounts and 15 feeds. None of the 320 accepted exact bodies appeared. The title **I can swim** did not appear, and no item source was a YouTube watch URL. Fingerprint generatorVersion was 11.

This is a source-level execution result, not a rendered app or deployment audit. No shared process, data store, dependency installation or other task was touched.

## Cause and required change

`packages/shared/src/sample-data.ts` still builds its older fixed placeholder collections. Its `authorEntireSampleCorpus` function assigns assets by index from the entire catalog and calls `sampleCorpusGeneratedText`, which produces generic narrative. It does not read accepted character episodes or call `projectSampleYouTubeVideo`. Its people graph also uses index-selected scene assets rather than reviewed avatar bindings and creates provider identities irrespective of the authored platform.

The user-facing seed consumer is `packages/ui/src/lib/sample-library-seed.ts`. It calls `generateSampleLibraryData` and reports exported showcase counts. Existing contract tests are in `packages/pwa/src/lib/sample-data.test.ts` and `packages/ui/src/lib/sample-library-seed.test.ts`. There is no `packages/shared/src/sample-data.test.ts` or `packages/pwa/src/lib/sample-data.ts` in this base.

Implement the accepted showcase projection independently here. Emit exactly one item per bound, independently admitted episode. Preserve every exact body and title, episode platform override, explicit Story classification, character home and stable identity. Omit all null-media drafts. Source catalog size must never determine item count or pad the reviewed corpus.

Use reviewed portrait bindings for identities. Link only the accounts represented by the accepted content, with stable batch-scoped IDs. Preserve the existing explicit stress-data contract separately if its current callers require large synthetic graphs. Inspect those callers before changing exported count semantics.

YouTube entries must use the existing verified-video projector, actual watch and channel URLs, first-person authored title, complete narrative paragraphs, a blank paragraph before provenance, and separate thumbnail credit lines. Feed subscriptions must retain the sample sentinel boundary so adding demo content cannot start real feed fetches. Do not alter capture, authentication, cookies, refresh cadence or provider navigation controls.

Update the existing seed contract tests to cover accepted-only counts, exact author/content/media bindings, Story timing, stable IDs across repeat calls and disjoint IDs across batches, consistent accounts and people, real YouTube projection, and paragraph preservation. Existing generic count tests cannot establish those requirements. Verify the reader rendering separately after source projection works. Full gate failures caused by missing shared automation guard files remain separate and must not be repaired here.

The investigation below preceded the implementation described above. This task's owner forbids any DEMO LAUNCH contact, inspection or coordination. Do not retrieve its integration or merge into its worktree. All implementation, validation and evidence belong here; merging requires the owner's approval.

## Complete sample text and separate image credits

Every accepted sample now supplies its complete text through the existing preservedContent fields, including Stories. The reader uses this local text without invoking the hydrator and does not label these complete samples Summary. Photo attribution is rendered in a separate footer with preserved source and license line breaks. Forty-six tests across six suites pass, including the distinct Story contract. Shared generator TypeScript checking passes. No database schema, activation or provider behavior was changed.

The actual Story reader DOM and repository CSS were rendered at390px in headless Chromium with a cached image embedded as data and a restrictive CSP. Root inspected mobile-story-credit.png: full image is contained, prose is separate from credits, all source/license text wraps within350px and no Summary or hydration error appears. Request inventory contains only the local HTML and CSS. This proves offline layout, not browser React hydration, live delivery or full application activation.
