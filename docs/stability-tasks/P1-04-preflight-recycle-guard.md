# P1-04: Preflight recycle guard + login-in-progress latch

runner-safe: false | provider-visible: true (window lifecycle changes provider-observable session behavior) | soak-gated: YES
Findings: F04, F05 (sev-5), plus rust-backfill A6. Prereq: P0-02 kill records live (this task's acceptance instrument).

## Defect

Every provider's memory preflight unconditionally recycles ALL other scraper windows with no active-session check, running before both the JS job gate and the Rust session mutex (`packages/desktop/src-tauri/src/lib.rs` ~6053-6094): provider B's trigger destroys provider A's in-flight scrape. Worse, IG (`ig_show_login` ~8249-8253) and LinkedIn (~8953-8956) login windows REUSE scraper labels (`ig-scraper`/`li-scraper`), so preflights, critical-pressure cleanup, and watchdog recycles destroy a user's window mid-2FA. Facebook already does this right with a separate `fb-login` label (~7144).

## Change

1. Route the preflight through the existing (currently unused here) `recycle_social_scraper_windows_unless_active` guard (~647-664), passing the caller's own window as preserve_label.
2. Make preflight recycling conditional on actual memory pressure rather than unconditional.
3. Give IG/LI login windows dedicated `ig-login`/`li-login` labels excluded from `SOCIAL_SCRAPER_WINDOW_LABELS` (line ~68), mirroring fb-login; audit all lookups of the old labels.
4. Update `social-scraper-session-order` e2e/test contracts deliberately (they pin the current ordering).

## Blast radius

Scraper window lifecycle — the riskiest PR in this arc. Mitigation: the guard function already exists and is used by the watchdog path; tests pin the ordering.

## Verify

- Regression test: provider-B preflight during provider-A scrape leaves A's window alive.
- E2E: IG/LI login flow survives a concurrent provider trigger; login window label assertions.
- Soak: P0-02 `window_destroyed` events with `scraperSessionHeld=true` or `reasonEnum=login_flow` victims → 0 (baseline soak showed nonzero — the positive control flips).
