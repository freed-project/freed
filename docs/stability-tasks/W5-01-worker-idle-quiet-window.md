# W5-01: Automerge worker idle quiet window

runner-safe: false | provider-visible: false | soak-gated: YES

Finding: F20, repeated full Automerge initialization during sequential local bookkeeping.

Prerequisites: the deterministic large-document worker harness from PR 950,
the schema 3 collector, metric registry, fingerprint, and outcome converter
from PR 949, and separately approved native runtime identity stamping. PR 949
stamps renderer-originated counters, but native heartbeat, memory, recovery,
window, and alarm records remain untagged until the gated native change lands.

## Evidence

The exploratory Freed Desktop 26.7.1000 trace at
`~/.freed/automation/soaks/2026-07-11-1914` loaded a 15,466,044-byte Automerge
document repeatedly. Sequential worker generations initialized about 4.5
seconds and 20 seconds apart around existing snapshot and cloud-upload
bookkeeping. App-attributed WebKit resident memory reached multiple gigabytes
while the document was loaded repeatedly.

The complete launch segment recorded one INIT per worker generation. Concurrent
INIT coalescing would not address this trace and stays outside this slice. This
trace has only 4.65 credited app-alive hours, unhealthy collector density,
legacy schema 1 evidence, and incomplete build identity. It is diagnostic
evidence only and must not be used as the W5-01 comparison denominator.

## Behavior

1. Continue releasing `currentDoc` as soon as the worker request queue drains.
2. Retain only the unloaded worker shell and `currentBinary` for a 30 second sliding quiet window.
3. Cancel the stop timer when document work begins, including binary reads that do not reload `currentDoc`.
4. Start a fresh quiet window when a request settles or the worker reports document release.
5. Preserve the one second retry when a stop attempt finds active requests.
6. Terminate normally after 30 quiet seconds.

This slice does not change cloud scheduling, upload cadence, provider requests, WebView behavior, watchdog thresholds, or Automerge document contents.

## Verification

- Unit lifecycle tests prove that the worker survives for 29,999 milliseconds, terminates at 30 seconds, remains alive while a request is pending, slides the quiet window after unloaded binary and acknowledged relay-count activity, cannot terminate during a slow document reinitialization, resets a reinitialization after its bounded timeout, and still terminates after other unanswered requests reach their bounded timeout.
- The real-worker browser test uses the deterministic large document, proves that a binary read reuses the same worker generation without another INIT, then proves eventual termination, reinitialization, mutation, and persistence.
- The focused worker integration and memory contract tests remain green.
- `npm run validate:feature` passes on the exact branch head.

## Installed-build acceptance

The current schema 3 current-behavior window at
`~/.freed/automation/soaks/2026-07-12-1758` is also analytical because Freed
Desktop 26.7.1000 predates the complete immutable runtime identity envelope. It
can calibrate collection and document the causal trace, but it cannot be
promoted into a lifecycle outcome or used as the measured-effect denominator.

After PR 949 and the separately approved native identity stamp land, install a
measurement-only build from `dev` that does not contain W5-01. The central
native runtime-health writer must stamp every metric-relevant event with one
app version, full commit SHA, release channel, and native process-session ID.
Derived invariant alarms must preserve the same identity. Run the build for at
least six credited app-alive hours and require a closed, healthy schema 3
verdict with a complete fingerprint, attributable build identity, and an
artifact digest. Before W5-01 is installed, amend this task and the PR body with
the exact frozen baseline verdict path and SHA-256. If that baseline is
inconclusive, repair measurement and rerun it. Do not install the W5-01 behavior
against an inadmissible denominator.

Then install a different build containing only this behavioral change. Run it
for at least six credited app-alive hours with this exact comparison context:

- Scenario: `background-current-behavior-no-manual-triggers`
- Provider cohort: `social-state-unverified_gdrive-active_dropbox-unobserved`
- Document-size bucket: `automerge-14-to-16-mib`
- Host: Darwin, arm64, 64 GiB memory tier
- Duration: 0.8 through 1.25 times the frozen baseline, with an exact six-hour pair preferred

- Focused unit and real-worker tests prove that adjacent binary, snapshot, and cloud bookkeeping within 30 seconds reuse one worker generation. Installed runtime evidence does not claim operation-to-generation attribution.
- `worker_init_rate` is below 10 events per app-alive hour and improves by more than the registered 0.25 events per app-alive hour tolerance.
- `worker_idle_terminated` records distinguish normal quiet-window termination from pending-request retries and request-timeout cleanup. Scheduled delay, actual timer elapsed time, and timer overrun diagnose event-loop delay that can be consistent with renderer throttling. They do not prove its cause.
- Memory pressure is compared across attributable process generations. Raw RSS alone is not a verdict.
- The worker still terminates after a genuine quiet window and reloads the document correctly on the next mutation.

Build the lifecycle outcome only from the two frozen raw verdicts:

```bash
node scripts/build-outcome-verdict.mjs \
  --soak-verdict <effect-soak>/soak-verdict.json \
  --task-id W5-01 \
  --outcome verified_effective \
  --metric worker-init-rate \
  --baseline-reference <baseline-soak>/soak-verdict.json \
  --out <effect-soak>/outcome-verdict.json
```

The converter must accept the different build commits, exact comparison
context, comparable duration, complete fingerprints, and evidence-derived
improvement. A hand-calculated rate is not a lifecycle outcome.

Do not install concurrent INIT coalescing, cloud coverage instrumentation, provider scheduling changes, or watchdog changes in this soak build.
