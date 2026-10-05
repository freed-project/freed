# Editorial generator independent review

Review date: 2026-09-06. Scope: the new `packages/shared/src/sample-editorial-data.ts`, generator changes in `sample-data.ts`, and the changed generator assertions in the shared, PWA and UI tests. Read-only inspection of existing types, YouTube projection, account identity helper and RSS refresh consumers was limited to verifying these records. No runtime edits, dependency changes, full gates or network requests were performed by this reviewer.

## Findings

Both concrete findings were corrected by the lead during review. No unresolved correctness blocker remains in the reviewed generator changes.

### Resolved P2: Normalize fractional seeds before indexing timelines

At the reviewed snapshot, `sample-editorial-data.ts:42` computes the rotation offset from the raw numeric seed. Later, `timelines[(start + index) % timelines.length]![round]` treats that offset as an array index. `SampleDataOptions.seed` and `presentationSeed` accept a number without an integer restriction. A value such as `0.5` produces a fractional property lookup, returning undefined and throwing before the library is returned. The previous random generator coerced its numeric seed through bitwise arithmetic.

The lead added `const seed = options.seed | 0` before modulo, matching the old PRNG coercion. I reread that fix and the added test cases for fractional, NaN and positive Infinity seeds. Each case asserts the complete showcase item count. This resolves the indexing failure, including non-finite inputs. No full generator test was run by this reviewer.

### Resolved: Synthetic editorial feeds were eligible for real refresh

The first inspected generator emitted `enabled: true`. A synthetic hostname does not itself prevent requests. The existing desktop path is concrete:

1. `packages/desktop/src/lib/capture.ts:802` scans feeds and retains enabled records.
2. `packages/desktop/src/lib/rss-refresh-plan.ts:40` filters enabled records and applies retry/staleness limits, without a sample fingerprint or hostname exclusion.
3. `refreshRssFeeds` and `refreshScheduledRssFeeds` pass the selected feeds to `refreshEnabledRssFeeds`.
4. `packages/desktop/src/lib/capture.ts:660` calls `fetchRssFeed(feed.url, trigger)` for each selected feed.

The lead independently fixed the generator during review. I reread `sample-editorial-data.ts:71` and confirmed `enabled: false`. The changed PWA projection test now asserts both disabled status and the synthetic URL prefix. This resolves the newly generated editorial-feed issue. The older stress generator's enabled-feed behavior remains outside this change; the stress path should not be described as proving that the hostname blocks requests.

## Verified design properties

- Only episodes with non-null admitted media bindings enter the showcase projection. Characters without any admitted episode produce no showcase profile or account.
- Media lookup uses the curated accepted corpus. Missing portraits or episode assets fail instead of silently selecting a substitute image.
- Non-video `content.text` is assigned directly from the episode body. Article `preservedContent.text` also uses that exact body.
- YouTube projection validates video identity and the reviewed thumbnail, preserves internal body paragraphs, then appends the primary video attribution and thumbnail credit. The changed test compares the complete expected string. The helper trims outer whitespace; current tested bodies do not rely on outer whitespace.
- Names, biographies, homes and avatar URLs come from character canon and the explicit avatar map. No image-catalog identity aliases are manufactured in showcase mode.
- Account IDs follow the existing `social:<platform>:<authorId>` convention, and every account's external ID matches the generated item author. A character retains one person ID across its authored platforms.
- Item IDs depend on batch, platform, character and exact image hash, rather than presentation position. The corpus test asserts unique admitted image hashes, protecting the current one-image-per-episode identity assumption.
- Per-character episode order survives round-robin interleaving and the previous-top fallback. The fallback moves a whole character timeline to the end, which produces a contiguous block on that refresh but does not reverse its events.
- Published timestamps are reassigned after ordering, including preserved article timestamps. Stories remain within the specified 22-hour window. No invented map time ranges are added to showcase records.
- FeedItem, Person, Account, RssFeed and preserved article fields match the inspected shared interfaces. YouTube is a supported platform and the video uses the reviewed thumbnail as an image, with the watch URL retained as its source.
- Explicit stress scale and custom synthetic graph options retain the separate synthetic generation path. The bounded duplicate-text loop prevents that path from spinning forever; it never edits showcase prose.

## Validation limits

This is independent static review, not a claim that the lead's tests passed. The lead owns execution of focused tests and UI checks. I did not inspect the separate demo mapper changes, run full gates, or alter pending editorial proposal 86. The only file written by this review is this document.
