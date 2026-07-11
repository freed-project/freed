# P0-04: Daily runtime-health rotation replacing the 5 MiB halving cap

runner-safe: false (lib.rs) | provider-visible: true (conservative native orchestration gate, though this task is logging only) | soak-gated: no (runtime-neutral instrumentation)
Findings: telemetry-perf map — "5 MiB cap with halving destroys multi-day trend evidence and rewrites the whole file on the event path".

## Context

`append_bounded_jsonl` (`lib.rs` ~1025-1067) caps runtime-health.jsonl at 5 MiB by reading the whole file and rewriting the newest ~2.5 MB on the hot append path. Multi-day leak trends are unreconstructible, and the halving does file-sized I/O inside event handling. The new P0-02/P0-03 events increase volume, making this worse.

## Change

Rotate instead of halve: write to `runtime-health-YYYYMMDD.jsonl` (local date), keep the most recent 14 files, delete older on rollover. Keep a `runtime-health.jsonl` symlink or a small pointer file for existing readers, or update the readers (dev-sync-trigger idle checks, bug-report bundler, soak tools) to resolve the newest file — grep all readers and update them in the same PR. Bug reports (see `bug-report.ts` ~142) should gzip the full current + previous day rather than the last 120 lines.

Implementation notes (2026-07-02): the symlink option was chosen — `runtime-health.jsonl` becomes a symlink to the current day's file, repointed on rollover, so scripts (`social-scrape-loop.mjs`, `nightly-self-improve.mjs`) and any external tail keep working unchanged. The legacy plain file is migrated into the first day's dated file so no history is dropped at upgrade. In-app readers were additionally upgraded to read current+previous day (`read_runtime_health_recent_days`): dev-sync-trigger idle check, `get_recent_runtime_health`, and startup diagnostics export; a new `get_runtime_health_history` command (tail-capped at 8 MiB) feeds bug reports the full current+previous day inside the DEFLATE-compressed bundle. Non-unix builds keep the old 5 MiB bounded single file (no reliable unprivileged symlinks on Windows).

## Verify

- Unit test rollover + retention with fixture dirs.
- After one soak: no halving rewrites observed (add a debug counter or verify by file sizes); dev-sync-trigger idle detection still works (its runtime-health read path is finding-adjacent — see F-series trigger findings — do not regress it).
- Bug report bundle contains ≥24h of history.
