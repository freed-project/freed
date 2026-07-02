# P0-03: Loop counters: cloud uploads with heads-unchanged, relay broadcasts, worker INITs, scrape outcomes

runner-safe: false (touches sync/worker/capture code, logging only) | provider-visible: false | soak-gated: no
Findings: F01/F06 (cloud loop), F07/F10 (full-doc broadcast), F20 (worker restarts), F03 (lost scrape results) — measurement instruments for all of them.

## Context

The verified idle-churn loops are invisible in telemetry. Before any damper lands, their live signatures must be countable so each Wave-2 PR attributes its delta.

## Change

1. **Cloud uploads:** add a GET_HEADS-style worker request (`automerge-types.ts` + both workers) or reuse an existing heads accessor. Log every cloud upload attempt (desktop `sync.ts` upload scheduler ~1477 and PWA equivalent) as a runtime-health/local-log event: `{provider, cause (subscriber|manual|poll), headsBefore, headsUnchanged: bool}`.
2. **Relay broadcasts:** count and byte-size each `broadcast_doc` invoke (Rust side, one line per broadcast or a 60s aggregate) — `{count, totalBytes, clientCount}`.
3. **Worker INITs:** log worker spawn + INIT duration + doc size on both apps (desktop `automerge.ts` worker lifecycle, PWA mirror) — the INITs/hour counter.
4. **Scrape outcomes:** one shared helper used by all four `*-capture.ts` files emitting `{provider, trigger, itemsExtracted, itemsPersisted, stage, durationMs}` at scrape end. `itemsExtracted >= 5 && itemsPersisted == 0` is the scrape_zero_persist signature.

Events go to runtime-health.jsonl (desktop) with small fixed shapes; PWA logs to its existing debug channel with the same field names.

## Verify

- One overnight idle soak with GDrive connected + paired phone produces the expected pathological baseline: hundreds of uploads/hour with headsUnchanged=true, broadcasts tracking mutation cadence, INITs tracking the content fetcher.
- Scorecard baseline column filled from this soak.
