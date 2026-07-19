# P0-04: Daily runtime-health rotation replacing the 5 MiB halving cap

runner-safe: false (lib.rs) | provider-visible: false (runtime-health persistence only; the native path still requires verified-neutral review) | soak-gated: no (runtime-neutral instrumentation)
Findings: telemetry-perf map — "5 MiB cap with halving destroys multi-day trend evidence and rewrites the whole file on the event path".

## Context

`append_bounded_jsonl` (`lib.rs` ~1025-1067) caps runtime-health.jsonl at 5 MiB by reading the whole file and rewriting the newest ~2.5 MB on the hot append path. Multi-day leak trends are unreconstructible, and the halving does file-sized I/O inside event handling. The new P0-02/P0-03 events increase volume, making this worse.

## Change

Rotate instead of halve: write to `runtime-health-YYYYMMDD.jsonl` (local date), keep the most recent 14 files, delete older on rollover. Keep a `runtime-health.jsonl` symlink or a small pointer file for existing readers, or update the readers (dev-sync-trigger idle checks, bug-report bundler, soak tools) to resolve the newest file — grep all readers and update them in the same PR. Bug reports (see `bug-report.ts` ~142) should gzip the full current + previous day rather than the last 120 lines.

Implementation notes (2026-07-02): the symlink option was chosen — `runtime-health.jsonl` becomes a symlink to the current day's file, repointed on rollover, so scripts (`social-scrape-loop.mjs`, `nightly-self-improve.mjs`) and any external tail keep working unchanged. The legacy plain file is migrated into the first day's dated file so no history is dropped at upgrade. In-app readers were additionally upgraded to read current+previous day (`read_runtime_health_recent_days`): dev-sync-trigger idle check, `get_recent_runtime_health`, and startup diagnostics export; a new `get_runtime_health_history` command (tail-capped at 8 MiB) feeds bug reports the full current+previous day inside the DEFLATE-compressed bundle. Non-unix builds keep the old 5 MiB bounded single file (no reliable unprivileged symlinks on Windows).

Append-integrity repair (2026-07-18): retained runtime evidence contained two valid JSON objects fused onto one physical line. The same corruption shape appeared across five calendar dates. The dated-file writer protected date selection but released its mutex before rotation, file open, and `writeln!`, so concurrent callers could interleave a JSON body with another caller before either newline was written. A process mutex and a permanent per-data-directory operating-system lock now cover Unix date selection, rollover, open, and whole-record append. They also cover the complete non-Unix bounded read, rewrite, and append sequence, plus runtime-health removal during factory reset. Rollover failure leaves the active target unchanged and appends nothing, so the next event retries instead of stranding evidence behind a missing reader link. The Unix path prebuilds the JSON bytes plus newline and writes that record as one buffer. Cross-platform regressions cover exact record multiplicity, bounded rewrite exclusion, independent lock handles, same-date writes to distinct data directories, rollover retry, final newline, and JSON parsing for every physical line. Historical evidence remains untouched.

## Verify

- Unit test rollover + retention with fixture dirs.
- [x] Concurrent appends preserve exact record multiplicity and produce one parseable JSON object per physical line.
- After one soak: no halving rewrites observed (add a debug counter or verify by file sizes); dev-sync-trigger idle detection still works (its runtime-health read path is finding-adjacent — see F-series trigger findings — do not regress it).
- Bug report bundle contains ≥24h of history.
