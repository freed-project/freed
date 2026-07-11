# W5-01: Automerge worker idle quiet window

runner-safe: false | provider-visible: false | soak-gated: YES

Finding: F20, repeated full Automerge initialization during sequential local bookkeeping.

Prerequisite: the deterministic large-document worker harness from PR 950.

## Evidence

The untriggered Freed Desktop 26.7.1000 baseline at `~/.freed/automation/soaks/2026-07-11-1914` loaded a 15,466,044-byte Automerge document repeatedly. Sequential worker generations initialized about 4.5 seconds and 20 seconds apart around existing snapshot and cloud-upload bookkeeping. App-attributed WebKit resident memory reached multiple gigabytes while the document was loaded repeatedly.

The complete launch segment recorded one INIT per worker generation. Concurrent INIT coalescing would not address this trace and stays outside this slice.

## Behavior

1. Continue releasing `currentDoc` as soon as the worker request queue drains.
2. Retain only the unloaded worker shell and `currentBinary` for a 30 second sliding quiet window.
3. Cancel the stop timer when document work begins, including binary reads that do not reload `currentDoc`.
4. Start a fresh quiet window when a request settles or the worker reports document release.
5. Preserve the one second retry when a stop attempt finds active requests.
6. Terminate normally after 30 quiet seconds.

This slice does not change cloud scheduling, upload cadence, provider requests, WebView behavior, watchdog thresholds, or Automerge document contents.

## Verification

- Unit lifecycle tests prove that the worker survives for 29,999 milliseconds, terminates at 30 seconds, remains alive while a request is pending, slides the quiet window after unloaded binary and relay-count activity, and still terminates after an unanswered request reaches its bounded timeout.
- The real-worker browser test uses the deterministic large document, proves that a binary read reuses the same worker generation without another INIT, then proves eventual termination, reinitialization, mutation, and persistence.
- The focused worker integration and memory contract tests remain green.
- `npm run validate:feature` passes on the exact branch head.

## Installed-build acceptance

Install a build containing only this behavioral change. Run a bounded soak with the same document-size bucket and existing background schedule as the baseline.

- Snapshot and cloud bookkeeping within 30 seconds reuse one worker generation and one INIT.
- Worker INITs per hour move toward the registered target of fewer than 10.
- Memory pressure is compared across attributable process generations. Raw RSS alone is not a verdict.
- The worker still terminates after a genuine quiet window and reloads the document correctly on the next mutation.

Do not install concurrent INIT coalescing, cloud coverage instrumentation, provider scheduling changes, or watchdog changes in this soak build.
