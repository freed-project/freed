# P0-03: Loop counters: cloud uploads with heads-unchanged, relay broadcasts, worker INITs, scrape outcomes

runner-safe: false (touches sync/worker/capture code, logging only) | provider-visible: true (capture and native orchestration paths require scoped approval) | soak-gated: no
Findings: F01/F06 (cloud loop), F07/F10 (full-doc broadcast), F20 (worker restarts), F03 (lost scrape results) — measurement instruments for all of them.

## Context

The verified idle-churn loops are invisible in telemetry. Before any damper lands, their live signatures must be countable so each Wave-2 PR attributes its delta.

## Change

1. **Cloud uploads:** add a GET_HEADS-style worker request (`automerge-types.ts` + both workers) or reuse an existing heads accessor. Log every cloud upload attempt (desktop `sync.ts` upload scheduler ~1477 and PWA equivalent) as a runtime-health/local-log event: `{provider, cause (subscriber|manual|poll), headsBefore, headsUnchanged: bool}`. Emit closed coverage intervals as `{event: "cloud_sync_coverage", connected: true, eligible: true, intervalStartMs, intervalEndMs}`. Intervals may overlap and are unioned before rate calculation. A duration without exact bounds is not evidence.
2. **Relay broadcasts:** count and byte-size each `broadcast_doc` invoke (Rust side, one line per broadcast or a 60s aggregate) — `{count, totalBytes, clientCount}`.
3. **Worker INITs:** log worker spawn + INIT duration + doc size on both apps (desktop `automerge.ts` worker lifecycle, PWA mirror) — the INITs/hour counter.
4. **Scrape outcomes:** one shared helper used by all five provider capture drivers emitting `{provider, trigger, itemsExtracted, itemsPersisted, stage, durationMs}` at scrape end. `itemsExtracted >= 5 && itemsPersisted == 0` is the scrape_zero_persist signature.

Events go to runtime-health.jsonl (desktop) with small fixed shapes; PWA logs to its existing debug channel with the same field names. Every renderer-side counter carries the immutable app version, full build commit SHA, channel, and renderer app-session ID. GitHub release builds source the commit from `GITHUB_SHA` and the channel from the reviewed release workflow output. The numeric bundle version is not a channel authority because dev releases intentionally omit the `-dev` suffix for Windows MSI compatibility. Missing or mixed identity makes the soak and canary inconclusive.

The `cloud_sync_coverage` schema and consumers are in place, but its runtime emitter remains provider-gated because it must observe provider connection and eligibility state in cloud sync paths. Until a scoped owner approval lands that emitter, cloud-eligible time is unavailable and every cloud-rate soak or canary verdict remains `inconclusive`. Wall time is not a substitute.

Native heartbeat, memory, recovery, and alarm records also lack the renderer's build and app-session identity today. The consumers now fail closed when those untagged records are counted. Stamping native records must land through a scoped provider review because the canonical classifier conservatively protects the shared native orchestration file. Until then, affected installed-build windows remain `inconclusive` instead of borrowing identity from an unrelated renderer record.

## Verify

- Before the coverage emitter lands, an overnight idle soak may report raw upload counts, broadcasts, worker INITs, and scrape outcomes, but its cloud-rate assertions remain `inconclusive`.
- A build-attributed window with at least one app-alive hour enforces `worker_init_rate` below 10 events per app-alive hour. Short, thin, untagged, or mixed-identity windows remain `inconclusive`.
- After scoped owner approval and the emitter implementation, a GDrive-connected soak records bounded `cloud_sync_coverage` intervals and computes cloud upload rates only from their unioned eligible duration.
- Fill the scorecard baseline only from a build-bounded window with healthy source coverage and every required denominator.
