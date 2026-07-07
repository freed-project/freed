# W2-01: Invariant alarms with surgical circuit breakers

runner-safe: false (lib.rs + sync paths) | provider-visible: false | soak-gated: no (may land before its matching dampers — positive control)
Findings: measurement/containment layer for F01, F03, F04, F16, F23. Prereq: P0-02, P0-03.

## Context

Turn the verified pathologies into named alarms with bounded automatic containment, so the app degrades loudly instead of silently looping. Post-fix, each alarm is the permanent regression tripwire.

## Change

A small Rust-side monitor consuming the P0 event stream, raising `invariant_alarm` runtime-health events (+ user-visible status where noted):

- `cloud_loop`: ≥5 uploads with headsUnchanged in 15 min → alarm + circuit-break cloud sync 30 min with visible status.
- `scrape_zero_persist`: itemsExtracted ≥5, itemsPersisted == 0 → alarm.
- `preflight_kill`: window_destroyed with scraperSessionHeld or login_flow victim → alarm.
- `auth_zombie`: 3 consecutive ok-empty scrapes with isAuthenticated=true → force auth recheck; 6 → flip provider to needs-reconnect + notify.
- `relay_divergence`: client pushes observed while desktop heads unchanged over N pushes → alarm.
- `watchdog_thrash`: ≥3 main-renderer recoveries in 6h → STOP recovering, capture one deep-diagnostics bundle, alarm. (A large renderer beats recovery churn that destroys scrapes.)

Each alarm carries a one-line runbook string and the citing ledger lines. No new recovery behaviors beyond the two circuit breakers above — program rule: no new supervision layers.

## Verify

- Seed each pathology in a dev build (the unfixed loops seed several for free, pre-damper) and confirm the alarm fires within its window.
- soak-assert gains alarm-count assertions; alarms/day becomes a scorecard line.

## Landed vs deferred (2026-07-07, observation pass)

Landed in lib.rs as a passive monitor tapped into `append_runtime_health` (the single choke point for both Rust and JS-forwarded events), plus `assertAlarmCounts` in soak-assert and unit tests both sides:

- **cloud_loop** — ≥5 `cloud_upload_attempt` with headsUnchanged in 15 min. Wired.
- **scrape_zero_persist** — `scrape_outcome` with itemsExtracted ≥5, itemsPersisted == 0. Wired.
- **preflight_kill** — `window_destroyed` with scraperSessionHeld, or reasonEnum preflight_recycle/login_flow. Wired.
- **watchdog_thrash** — ≥3 `renderer_recovery_attempt` (main-renderer path) in 6 h. Wired (alarm only).
- **auth_zombie** — heuristic on consecutive `stage=="ok"` && itemsExtracted==0 per provider (recheck at 3, needs-reconnect at 6). Wired as a coarse tripwire; **precise version needs `isAuthenticated` added to the scrape_outcome JS event (Wave 4)** to separate legit-empty from logged-out-zombie.

Deferred, by design:

- **Circuit breakers** (cloud_loop → pause cloud 30 min; watchdog_thrash → stop recovering; auth force-recheck/needs-reconnect). Not wired: each is a behavioral change, stop-recovering touches the frozen watchdog, and program rules cap one behavioral change per soak and want the alarm to observe as a positive control first. Records carry `"action":"observe"`. Breakers land next, one per soak cycle, gated + owner-reviewed.
- **relay_divergence** — no per-client-push event exists to key on until the Wave 3 relay inbound path lands; an alarm today could never fire, so it is not stubbed.
