# P1-05: Recovery never outruns a scrape invoke; persist lastScrapeAt

runner-safe: false | provider-visible: false | soak-gated: YES
Findings: F03 (sev-5), rust-backfill A2 (watchdog path), plus capture-orchestration map (in-memory lastScrapeAt). Prereq: P0-02/P0-03 live.

## Defect

Two recovery entry points destroy the main renderer while a scrape's results are still in flight: (a) post-scrape recovery (`maybe_recover_after_social_feed_scrape`, `lib.rs` ~5944-6051) runs after IG/LI drop their scraper session but BEFORE the invoke's results are persisted by the frontend — extraction events are fire-and-forget into the renderer, so captured posts are discarded, `recordScrape` never runs, throttle state is wiped, and the scheduler rescrapes; (b) the heartbeat-stale watchdog (`should_recover` ~11303-11309 → `recover_main_window` ~11598) has NO active-job gate at all, unlike the 60s memory monitor (~11055). Separately, per-provider `lastScrapeAt` throttles are module-level in-memory values that reset on relaunch and renderer recycle.

## Change

1. Rust-side latch: set at scrape-command entry, cleared only after the frontend acknowledges persistence (small ack invoke after the store commits items, with a bounded fallback grace window). Both `maybe_recover_after_social_feed_scrape` and the watchdog's `recover_main_window` call defer while the latch is held (mirror the existing scraper-recycle deferral pattern at ~637-664).
2. Persist `lastScrapeAt` per provider (alongside provider-health state on disk); read it on startup so restarts and recycles honor cooldowns.

## Blast radius

Recovery timing only — recovery still fires, seconds later. The watchdog gate must keep an escape hatch: if the latch is held longer than the scrape command's own timeout budget, recovery may proceed (a wedged scrape must not disable recovery forever).

## Verify

- Soak: scrape_zero_persist counter (P0-03) → 0; `window_destroyed` with `jsActiveJob != null` → 0.
- Unit test the latch state machine including the timeout escape hatch.
- Restart test: relaunch within cooldown does not trigger an immediate provider scrape.
