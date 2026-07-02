# P0-04: Daily runtime-health rotation replacing the 5 MiB halving cap

runner-safe: false (lib.rs) | provider-visible: false | soak-gated: no
Findings: telemetry-perf map — "5 MiB cap with halving destroys multi-day trend evidence and rewrites the whole file on the event path".

## Context

`append_bounded_jsonl` (`lib.rs` ~1025-1067) caps runtime-health.jsonl at 5 MiB by reading the whole file and rewriting the newest ~2.5 MB on the hot append path. Multi-day leak trends are unreconstructible, and the halving does file-sized I/O inside event handling. The new P0-02/P0-03 events increase volume, making this worse.

## Change

Rotate instead of halve: write to `runtime-health-YYYYMMDD.jsonl` (local date), keep the most recent 14 files, delete older on rollover. Keep a `runtime-health.jsonl` symlink or a small pointer file for existing readers, or update the readers (dev-sync-trigger idle checks, bug-report bundler, soak tools) to resolve the newest file — grep all readers and update them in the same PR. Bug reports (see `bug-report.ts` ~142) should gzip the full current + previous day rather than the last 120 lines.

## Verify

- Unit test rollover + retention with fixture dirs.
- After one soak: no halving rewrites observed (add a debug counter or verify by file sizes); dev-sync-trigger idle detection still works (its runtime-health read path is finding-adjacent — see F-series trigger findings — do not regress it).
- Bug report bundle contains ≥24h of history.
