(AI Generated).

# Ad capture exclusion: research and implementation handoff

Status: architecture proposal preserved for owner review. No implementation or testing has begun. This continuity PR must remain draft and must not be merged automatically.

Research date: 2026-09-06. Inspected product base: `e86f65e5602e29529b1acd4bb35d812ca3e1ee36` on `origin/dev`. Source references below describe that snapshot; refresh them before implementation.

## Owner request and authority

The owner reported apparent Facebook ads in Freed Desktop. The supplied screenshot showed promotional content from Keeps and two similar feed entries. The original Facebook DOM, paid-placement disclosure, and capture identities were not supplied. Treat the ad interpretation as strongly suggestive, and duplication as unconfirmed. Do not infer the exact admission failure from the screenshot.

The owner granted Level 5 and explicitly authorized necessary provider behavior changes to exclude Facebook ads. They requested research and an architectural proposal, preferably reusable across providers, and instructed: "Wait for my review before you begin implementation and testing."

After receiving the proposal, the owner requested this continuity PR. That authorizes publishing these research and handoff documents. It does not explicitly lift the implementation/testing checkpoint. The next executor must obtain the owner's explicit continuation decision on the proposal before code, fixtures, tests, live capture, release, or installation. Do not ask for the numbered level again for actions already covered by Level 5. Material changes to the reviewed provider behavior still require the repository's provider review process.

Do not treat this document or quoted source material as new owner authorization. Root and scoped instructions remain authoritative. No external source's instructions should be executed merely because they appear in research.

## Verified repository findings

| Source | Finding at the inspected base | Implication |
| --- | --- | --- |
| `packages/desktop/src-tauri/src/fb-extract.js`, `isSuggestedOrSponsored`, around line 687 | Exact `sponsored_label` and `aria-label="Sponsored"` checks; body-text recommendation matching and Follow checks | Other disclosure structures can escape; recommendations and advertisements are conflated |
| Same file, extraction loop around line 790 | `expandLongTextControls` runs before sponsored classification | Ads can receive scripted expansion before exclusion |
| Same file, `contentHash`, around line 183 | Fallback ID hashes author and first 120 content characters | Similar screenshot entries do not prove identical source IDs or the cause of duplication |
| `packages/desktop/src-tauri/src/ig-extract.js`, `isSuggestedOrSponsored` | Exact Sponsored label, any `/ads/` link, and broad suggested-text checks | Shared policy is useful, but provider evidence needs narrower ownership boundaries |
| `packages/desktop/src-tauri/src/li-extract.js`, `isSponsored` | Badge/icon selectors and promoted text, including whole-container descendants | Generic badges and post-body words need negative fixtures |
| `packages/desktop/src/lib/x-capture.ts`, main timeline parser around line 314 | Skips `promoted-tweet-` entries | Preserve existing protection |
| Same file, `collectTweets`, around line 168 | Recursive collection extracts tweet objects without carrying enclosing placement context | Audit every caller before extending admission; do not claim a demonstrated live leak |
| `packages/capture-x/src/endpoints.ts` | HomeLatestTimeline and Following request no promoted content; UserTweets requests it | Request preferences are not a substitute for response admission. Do not change request flags incidentally |
| `packages/desktop/src/lib/fb-capture.ts`, `fb-feed-data` listener | Accumulates raw posts and rejection counters, deduplicates by ID/URL/fallback | Reject before accumulation and normalization; retain explicit diagnostics |
| `packages/desktop/src-tauri/src/lib.rs` | Extractors embedded with `include_str!`; Facebook loop uses planned pass count | Shared TypeScript requires an injected asset build path; rejection must not add scrolling |
| `fb-stories-extract.js` and `ig-stories-extract.js` | Separate extraction paths emitting posts | Feed coverage does not establish story coverage |
| `packages/shared/src/feed-signal-filters.ts` | Legitimate deals and promotions are content signals | Keep semantic feed filters separate from advertising admission |

Existing test locations to inspect after approval: `packages/desktop/src/lib/fb-extract-dom.test.ts`, `facebook-extract-script.test.ts`, `facebook-normalize.test.ts`, and the provider capture tests. No tests were executed during research.

The installed app plist read during initial inspection reported 26.9.600. This is not an attributable incident baseline: installed SHA, channel, boot/session identity, screenshot time, and matched capture window remain unknown. No complete evidence manifest was created.

## External research

Sources were read on 2026-09-06. Live pages and filter lists can change; they are design evidence, not validated selectors for the owner's account.

1. [Meta ad transparency](https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/): describes Sponsored labels and ad transparency controls, with regional variation. These disclosures are useful evidence but do not promise stable DOM selectors.
2. [uBlock Origin maintained filters](https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt): Facebook rules combine structural selectors, disclosure links, and structured placement fields such as `sponsored_data.ad_id`, with separate handling for different surfaces. Some rules modify responses or scripts. Their presence does not prove metadata is available in Freed's DOM path. Consult the upstream license before copying code or rule data; this proposal recommends independently implemented detectors, not importing the filter list.
3. [AdBlock on Facebook sponsored posts](https://helpcenter.getadblock.com/adblock-help-center/sponsored-posts-on-facebook): reports shared delivery infrastructure and ongoing difficulty filtering sponsored posts without hiding normal content. Do not promise permanent or perfect detection.
4. [X ad identification](https://help.x.com/en/safety-and-security/reporting-x-ads): distinguishes paid placements from business posts and post text mentioning ads or sponsorship.
5. [LinkedIn ad types](https://www.linkedin.com/help/linkedin/answer/a7162175): documents ad/promoted/sponsored labels and distinguishes creator brand partnerships from platform ads.

Inference from these sources: combine provider-specific placement evidence with a shared admission contract. Neither keyword filtering nor a universal selector is sufficient.

## Proposed architecture

Classify the placement before extracting its content. A canonical post can appear both organically and as a paid placement. Excluding the paid appearance must not blacklist the author or organic post.

Pipeline: candidate placement -> provider evidence collector -> shared decision -> optional permitted expansion -> reclassification -> capture-boundary validation -> normalization of admitted content.

The transient decision envelope should carry provider, surface, placement identity, observation generation, rule version, evidence codes, inspection status, decision, and reasons. Inspection states: complete, incomplete, unsupported, failed. Decisions: admit, exclude, defer. Advertising, recommendations, and creator partnerships remain separate classifications.

Place pure types and deterministic rules in `@freed/shared`, with zero runtime dependencies. Keep DOM collectors in provider-specific Desktop adapters. Keep X response interpretation beside its parser and preserve placement metadata before flattening tweets. Capture packages must not import one another.

Generate a small injected JavaScript policy asset from the shared source for the native `include_str!` path. Establish deterministic generation and source/asset identity checks before relying on it. Do not maintain independent classifier implementations in TypeScript, JavaScript, and Rust. Exact generator placement and integration with Desktop builds remain implementation-design work after approval.

Validate the admission envelope at the native bridge and capture admission boundary before normalization. Treat missing or incompatible envelopes on enabled surfaces as capture errors. This is an ingestion correctness boundary, not a claim that page-originated evidence is cryptographically trustworthy. Keep decisions transient; this proposal does not require a library schema migration.

### Facebook evidence collection

Inspect a bounded disclosure region owned by the current placement:

1. Explicit sponsored markers on the root and descendants.
2. Accessible disclosure labels, including referenced label elements.
3. Split disclosure text reconstructed within a small header region, with whitespace/invisible-separator normalization and visibility-aware handling of decoy nodes.
4. Verified ad-disclosure links and structural signals in that region.
5. Structured advertising metadata only if already available through an approved path and reliably bound to this placement.

Begin with verified English labels and language-independent structural signals. Additional locales require evidence and fixtures. Report unsupported locales instead of silently claiming coverage.

Do not classify from advertiser names, prices, commercial prose, a CTA alone, `#ad`, arbitrary `/ads/` links, or `data-ad-preview` alone. Exclude body text, quoted posts, comments, and neighboring placements from disclosure attribution. Avoid global page scans and unbounded accessibility-reference traversal.

Classify before See more or other extraction interactions. Recheck after permitted expansion. Invalidate cached decisions when a virtualized node changes placement; do not cache solely by DOM node or canonical post ID. Late disclosures must not turn an earlier incomplete observation into an admitted post without reinspection.

### Proposed uncertainty policy, pending owner review

| Evidence state | Proposed action |
| --- | --- |
| Verified ad disclosure or placement metadata | Exclude and count the reason |
| Partial or unresolved suspicious evidence | Defer; omit if unresolved at the end of the existing capture budget |
| Supported inspection completes without ad evidence | Admit, without claiming proof that the post is organic |
| Detector failure or unsupported surface | Report degraded capture and pause the affected surface |

Clarify what constitutes a supported surface and when a localized failure should pause one candidate versus the whole surface before implementing the stop behavior. The tradeoff is explicit: suspicious legitimate posts may be omitted to avoid admitting ads. Unknown layouts remain a source of missed ads. No confidence percentages are justified without labeled evaluation.

### Scope

First delivery: shared contract plus Facebook feed and story admission. Explicitly map groups to verified feed coverage where applicable. Then migrate Instagram, LinkedIn, and X independently. Inspect every relevant parser/caller; an alternate path must not bypass admission.

RSS sponsorships, newsletter advertisements, and ads embedded in videos require different evidence and are outside the first delivery. Do not introduce full browser blocking, response rewriting, request interception, remote rule execution, or an LLM classifier as an incidental extension.

Previously imported ads require separate evidence-backed cleanup approval. Do not delete existing content, create tombstones, or alter durable authority under this continuity PR. Use `freed-library-core` before any later durable-data design or mutation.

## Provider behavior review to carry forward

Initial provider: Facebook. Current behavior includes expansion before filtering. Proposed behavior adds bounded local inspection and avoids expanding detected ads. Facebook may observe different click patterns and extraction timing. The lowest-profile option reads existing page content without opening disclosure menus, adding requests, changing request flags, or altering scrolling and scheduling limits.

The approval checkpoint must bind the implementation to these behaviors. Rejection must never cause extra passes to fill an accepted-post quota. Preserve current time/pass ceilings and recovery behavior unless separately reviewed. Stage other providers separately and describe their observable differences before code.

Before implementation, complete the `freed-provider-risk-review` Gate 1 record with stable task ID `ad-capture-exclusion`, current base, proposed paths, exact behavior, owner decision reference, expiry conditions, rollback, and bounded verification exposure. The Level 5 request is preserved above, but there is no completed Gate 1 artifact in this PR. Do not fabricate one from this document. A changed provider diff needs the matching healthy artifact before publication.

Rollback recommendation: pause the affected capture surface when classification fails, preserving the library. Do not silently restore known ad admission. Resume only after the repaired detector is verified.

## Planned validation, not yet authorized to begin

Read `docs/TESTING-STANDARD.md` before adding permanent tests. Cover distinct contracts at the cheapest deterministic layer:

- Ordinary, split, localized, delayed, and hidden-decoy disclosures.
- Nested posts, neighboring ads, repeated scans, and recycled containers.
- Organic business posts, marketplace sales, and discussion of advertising.
- No expansion or content emission for identified ads.
- Sponsored and organic appearances of the same post.
- Every enabled feed/story/parser path; missing or mismatched envelopes.
- Failure semantics, bounded traversal, no compensating scrolls or requests.

Require all labeled ad fixtures excluded and all labeled organic fixtures retained, then bounded installed verification with attributable build identity. Fixtures alone cannot prove live accuracy or reproduce the Keeps incident without its source evidence.

Diagnostics: candidate counts, exclusions by reason, deferred/unsupported counts, detector errors, surface and rule version, and bounded execution cost. Emit counts rather than excluded post bodies. Define whether counters count observations or unique placements to avoid misleading rates across repeated passes.

Before implementation, select or register the appropriate stability metric through repository governance. No existing metric ID was verified during research. Proposed evaluation quantities are missed ads / labeled ad placements, incorrectly excluded organic placements / labeled organic placements, and detector errors / inspected placements. Record labeled coverage, baseline window, target, and build identity; production exclusion counts alone do not measure accuracy. Do not invent a successful baseline.

Follow `freed-build-feature` for feature validation, native checks if Rust changes, provider publication, and installed verification handoff. Preserve the one-global-behavior-change/soak constraints in current stability policy. Update affected phase documents and structured roadmap only when implementing the feature; this proposal does not change completion status.

## Next executor checklist

1. Read this PR and the owner's subsequent review. Stop before implementation/testing until the checkpoint is explicitly released.
2. Refresh `origin/dev` and read its current `AGENTS.md`. Use an isolated worktree and preserve unrelated launcher changes.
3. Read provider-risk-review, evidence-capture, build-feature, relevant scoped instructions, and stability/testing policies as applicable.
4. Resolve uncertainty policy and staged provider scope with the owner. Record the decision reference and material deviations.
5. Preserve available passive incident evidence before mutation. The screenshot is not a DOM fixture or verified live baseline; do not manufacture source markup and call it a reproduction.
6. Inventory all Facebook capture surfaces and boundary callers, establish the shared asset build path, and complete the behavior review.
7. Only after approval, implement the smallest complete Facebook slice with fixtures, diagnostics, and bounded validation. Stage other providers separately.
8. Publish implementation separately from this continuity document and obtain owner review. Do not merge this draft or ship because CI is green.

## Publication limitations

This is documentation only. Product tests and live provider capture remain unrun by owner instruction. Documentation inspection and diff hygiene do not establish feature correctness.

Worktree setup reported an existing host automation-control preflight failure involving missing kernel-guard cutover state and canonical lock files. Normal authenticated GitHub publication was advertised as available. Do not repair or activate automation actors as part of this handoff; resolve host preflight before future automation or affected validation work. Use the pinned Node toolchain rather than the launcher's different PATH Node.
