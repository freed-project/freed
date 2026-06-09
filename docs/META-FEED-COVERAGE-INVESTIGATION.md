# Meta Feed Coverage Investigation

Date: July 2, 2026

## Current Finding

The latest Freed Desktop build can enter an Instagram scrape where no `ig-feed-data` batches arrive. The app then reports the run as an empty feed, even though the real failure is that extraction never produced a batch. Facebook had the same frontend blind spot if native returned without a `fb-feed-data` batch.

Runtime diagnostics from June 8, 2026 also show the WebKit content process growing past 8 GB resident after the Instagram run and triggering renderer recovery. The run used a reduced feed-only plan because memory was already tight.

Runtime diagnostics from July 2, 2026 show the same failure family from the memory side. Facebook was allowed to start a feed scrape while WebKit RSS was already around 6.6 GB. Within the next minute, WebKit RSS climbed past 10 GB, provider sync entered memory cooldown, and the main renderer recovery dropped WebKit RSS to 0. The app then stayed in memory cooldown for several more minutes even though memory was already normal.

The July 2 runtime health file also shows this is a shared social runtime problem, not an isolated Instagram parser problem. Recent samples included 38 social scrape preflights, 2 scraper memory cooldowns, 16 renderer recovery attempts, peak app RSS around 13.9 GiB, and peak WebKit RSS around 12.1 GiB. LinkedIn preflights hit high and critical memory after the same hot WebKit pattern, so the memory fix is intentionally in the shared social scrape preflight path.

## Safe Changes In This Branch

- Instagram and Facebook silent extraction are now recorded as `extract_silent` instead of `extract_empty`.
- The Instagram extractor now accepts a single rendered `<article>` as a valid candidate set instead of scanning every `<div>` when fewer than two articles are present.
- Scraper WebViews now scrub more media, frame, and canvas state before destroy so WebKit can release memory sooner.
- Social scrape preflight now blocks when WebKit resident memory is already too large to start safely, even if the resident tail looks reclaimable.
- Blocked social scrape preflight now immediately recovers the main renderer when WebKit resident memory is hot, instead of waiting for the periodic memory monitor.
- Memory-pressure cooldown now clears as soon as a later memory sample is back below the scrape budgets.
- `npm run social:scrape-loop` now turns local runtime logs into a repeatable safe-action queue for ongoing social provider optimization.
- Focused tests cover silent extraction, the single-article Instagram extractor path, and existing social capture memory behavior.

## Provider-Visible Candidates For Review

These changes are likely needed for full Facebook and Instagram coverage, but they change behavior Meta can observe.

1. Re-navigate retained Instagram scraper windows to `https://www.instagram.com/?variant=following` before each feed scrape.
   - Risk: Instagram sees one extra feed navigation when Freed reuses a window that may be on login, a post, a story, or a stale page.
   - Benefit: avoids scraping the wrong retained page and should reduce silent or empty extraction runs.

2. Add a one-time silent extraction retry for Instagram after a zero-batch run.
   - Risk: Instagram sees one additional feed load or extraction attempt on failed runs.
   - Benefit: converts transient WebKit or placeholder failures into useful captures.

3. Add a low-ceiling feed-only retry after Facebook or Instagram returns zero candidates with a feed-like page.
   - Risk: Facebook or Instagram sees additional scripted scroll and extraction timing on only failed runs.
   - Benefit: recovers from virtualized feed stalls without increasing normal scrape cadence.

4. Increase minimum pass counts only when memory is healthy and the first pass sees valid candidates.
   - Risk: Facebook or Instagram sees more scroll passes in some healthy sessions.
   - Benefit: improves coverage without pushing already stressed WebKit processes harder.

## Lowest-Risk Next Step

Ship the local-safe diagnostics and memory cleanup first. Then review a guarded provider-visible patch that only retries when the current run has already failed.
