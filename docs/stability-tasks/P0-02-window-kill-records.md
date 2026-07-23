# P0-02: Structured window_destroyed kill records

runner-safe: false (lib.rs) | provider-visible: true (conservative native orchestration gate, even though the intended change is logging only) | soak-gated: no
Findings: F03, F04, F05 (scrape/login windows destroyed mid-flight) — this task is their measurement instrument, not their fix.

## Context

Window destructions are the pivot of the verified scrape→recover→rescrape and preflight-fratricide loops, but they are not observable as events. Nobody can count how many scrapes or logins die by recycle.

## Change

In `packages/desktop/src-tauri/src/lib.rs`, at every window-destruction site — `destroy_main_window_for_recovery` (~10361), `recycle_webview_window` / `recycle_social_scraper_windows_except` (~6053) and `..._unless_active` (~647), and the post-scrape recovery path (~5944-6051) — append a `window_destroyed` runtime-health event: `{label, reasonEnum (preflight_recycle | post_scrape_recovery | watchdog_stale | watchdog_memory | critical_pressure | user | login_flow | job_complete | startup_recovery), requestedBy, victimPid, victimAgeS, scraperSessionHeld: bool, jsActiveJob: string|null}`. Reuse `append_runtime_health`; keep it one line per destruction.

Premise adjustments found during implementation (2026-07-02): the code has two destruction classes the original 7-value enum could not represent, so two values were added — `job_complete` (WebviewRecycleGuard teardown when a scrape/auth/visit/like command settles; always has `scraperSessionHeld=true` for its own job, exclude it when counting fratricide) and `startup_recovery` (startup occlusion recycle + crash-screen retry). `victimPid` is emitted as null until Wave 6 delivers deterministic PID→window attribution — the watchdog freeze forbids reusing the WebKit age-matching heuristic here. `jsActiveJob` is sourced from `BackgroundRuntimeCoordinator::active_job_for_health()` (the Rust-side record of the renderer's `runBackgroundJob` invoke), which is the closest observable to the JS activeJob. The recovery-keepalive utility window is deliberately not recorded (blank transient, would double-count every recovery).

`scraperSessionHeld`/`jsActiveJob` are the load-bearing fields: they make "window killed while work was active" directly countable and are the acceptance instrument for P1-04/P1-05.

## Verify

- Unit test the reason enum serialization.
- One overnight soak: runtime-health contains window_destroyed lines; count grouped by reason establishes the scorecard baseline ("windows destroyed while session active").
- soak-assert (W1-02) gains the preflight_kill==0 assertion wired to this event (expected to FAIL until P1-04 lands — that is the positive control).
