# Installed Soaks and Dev Sync Triggers

Canonical contract for validating installed Freed Desktop builds on the user's primary machine. AGENTS.md, docs/NIGHTLY-SELF-IMPROVE.md, and the freed-build-feature / freed-ship-build skills point here instead of restating these rules. If this document and any other prose disagree, this document wins.

## Soak collection and verdict

An installed soak observes a real Freed Desktop build over hours using terminal evidence only.

- Start measured collection with an immutable comparison context:

  ```bash
  node scripts/soak-collect.mjs --detach \
    --scenario <scenario> \
    --provider-cohort <provider-auth-pause-and-cloud-state> \
    --document-size-bucket <bucket> \
    --artifact-digest <installed-artifact-sha256>
  ```

  Omit `--artifact-digest` only when no installed artifact digest exists. The
  three workload flags are required together. They, the detected host platform,
  architecture, and RAM tier are written once to `soak-info.json`. A measured
  baseline and effect must use exactly matching values and comparable window
  durations. The collector acquires the exclusive
  `~/.freed/automation/current-soak-dir.collector-lock`, rejects a live
  collector, recovers only a safely identified stale owner, and releases only
  its own lock token. It samples the app process, the machine-wide WebKit
  process table, and `runtime-health.jsonl` into a soak directory under
  `~/.freed/automation/soaks/`. Each saved cursor binds the physical file
  generation and a SHA-256 digest of the complete source prefix, so daily
  replacement or truncate-regrow cannot skip new records when the new file is
  already as large as the old offset. The collector points
  `~/.freed/automation/current-soak-dir` at it. A transient sample exception
  does not terminate the detached collector. The first failure in an outage and
  the eventual recovery are appended to `collector-events.jsonl`; repeated
  failures stay folded into that one recovery record. Before a new outage, the
  current file rotates at one MiB. Its matching recovery stays in the same file
  and may extend it by one bounded record. Each collector process also writes a
  durable session start and graceful stop. Rotation closes and reopens a
  balanced session segment. A replacement collector uses one atomic restart
  transition to close an unclosed prior process and open its replacement, then
  recovers any persisted sample outage on its first successful sample. A
  missing stop therefore exposes an abruptly dead collector instead of letting
  the truncated tail look healthy. Source-health
  rules still decide whether a recovered sample gap is usable. An open sample
  outage, open collector session, malformed transition, or missing closed
  session keeps the verdict inconclusive. New sessions use soak-info schema 3,
  declare collector-event schema 2, and create the empty current event file at
  initialization. Older soaks and collectors remain analytical
  `inconclusive` and cannot close a lifecycle soak. Never add the declaration
  retroactively.

- At the immutable end bound, stop only the lock-owned collector and wait for
  its lock to clear before hashing evidence. Then judge the frozen session with
  `node scripts/soak-assert.mjs`. It writes `soak-verdict.json` with source health, app-alive coverage, named assertions, and one of `pass`, `fail`, or `inconclusive`. Runtime source health requires liveness events in every app-alive segment, at least 80 percent of the expected distinct samples, a bounded largest gap, and a fresh final sample. Zero-event and event-rate assertions remain `inconclusive` until that coverage and one attributable runtime identity are both present. Cloud rates also require explicit connected and eligible coverage. Empty, thin, identity-missing, mixed-build, malformed, open-collector-outage, legacy-collector, missing-event-file, or denominator-free windows remain valid analytical `inconclusive` evidence, but they cannot be recorded as task lifecycle outcomes. A lifecycle `inconclusive` requires a nonempty window attributable to the canonical installed build and a complete composite fingerprint with capability-declared, present, closed, and well-formed collector-event evidence. If that contract is unavailable, preserve the raw verdict, keep the task in `soaking`, repair capture, and retry. Create `canary-context.json` with `node scripts/canary-context.mjs --verdict <soak-dir>/soak-verdict.json --install-id <id> --installed-at <iso>`, then summarize with `node scripts/canary-summarize.mjs --context <soak-dir>/canary-context.json --collector-metrics <soak-dir>/metrics.tsv`. The generated canary JSON plus runtime-health, collector-metrics, and collector-events sidecars are one portable evidence bundle. Loops gate on these artifacts, not on eyeballed files or the build installed at report time.
- The bounded `cloud_sync_coverage` event remains provider-gated and has no approved runtime emitter yet. Cloud-rate assertions must remain `inconclusive` until that emitter lands through the scoped provider approval lane. Do not infer eligibility from wall time, a configured account, or an unopened settings screen.
- The source fingerprint binds ordered runtime records, raw collector metrics, ordered collector outage events, collector and runtime liveness coverage, every rate denominator, build identity, app session, collector session, and app PID. Runtime coverage includes observed and expected distinct counts, density, largest gap, final freshness, and covered app-alive segment counts. Duplicate counted events stay distinct. Native heartbeat, memory, recovery, and alarm events still need the provider-reviewed identity-stamping instrumentation. Until that lands, a window containing those untagged records remains `inconclusive`.
- The nightly planner (docs/NIGHTLY-SELF-IMPROVE.md) reads the same pointer and soak files as evidence.

## No focus stealing

Do not use System Events, coordinate clicks, Computer Use, or browser automation to drive the installed app unless the user explicitly approves that disruption. Use terminal diagnostics first: app logs, `runtime-health.jsonl`, crash reports, process samples, memory samples, and local app-data files.

Launch installed builds with `open -g /Applications/Freed.app` so cold startup stays in the background. Explicit user actions such as tray Show, dock reopen, and recovery retry still foreground the app.

## Dev sync triggers

When a provider sync needs a manual kick, use a GitHub dev-channel prerelease, or launch a local build with `FREED_ENABLE_DEV_SYNC_TRIGGERS=1`, then run:

```bash
node scripts/dev-sync-trigger.mjs youtube   # or facebook, instagram, linkedin
```

- The trigger calls the same in-app social refresh path as the UI. It must keep existing auth, pause state, provider cooldowns, and rate limits intact.
- It is picked up by the native process, so it works when WebKit has suspended a backgrounded renderer.
- The trigger file is a live request, not a durable queue. Requests expire after the helper timeout; if a stale request was ignored, re-run the helper instead of expecting Freed Desktop to replay old provider traffic on the next launch.
- The helper is not a traffic generator. If the renderer was rebuilt after the provider run already finished, inspect the health log or wait for the provider cooldown instead of queueing a new request. The native watcher only replays a request when the renderer was rebuilt before the trigger finished.
- Deferral spacing is provider-safe: Facebook can retry sooner, Instagram needs the 10 minute interval, and LinkedIn and YouTube use the longer 30 minute interval.

For a YouTube acceptance run, require a terminal result of `completed`, a `youtube_roster_outcome` runtime-health record with `trigger: "dev_trigger"`, `result: "success"`, `complete: true`, `unresolvedCount: 0`, and a nonzero `resolvedCount`, plus the matching successful scrape outcome. This proves full reconciliation of the signed-in subscription roster and capture of the recent videos rendered by the Subscriptions page. It does not crawl every subscribed channel's historical upload archive.

### Gating

Dev-channel prereleases enable the trigger automatically (the release workflow sets `VITE_ENABLE_DEV_SYNC_TRIGGERS=1` for dev builds). In the production channel the raw file trigger stays gated to dev-channel installs, debug builds, or explicit `FREED_ENABLE_DEV_SYNC_TRIGGERS=1` launches until it has a user-facing permission model: any local process that can write to the app data folder could otherwise start authenticated provider syncs, which changes observable Facebook, Instagram, LinkedIn, or YouTube traffic without an explicit user action.

## Locked machine

When the Mac is locked, no provider scrape can start, and frequent retries still churn local renderer state, so the helper waits sparsely. The default locked retry is 10 minutes. For long unattended soaks, run:

```bash
FREED_DEV_SYNC_TRIGGER_TIMEOUT_MS=21600000 node scripts/dev-sync-trigger.mjs <provider>
```

so the helper keeps waiting for unlock without 30 second local churn.

## The 10 minute timeout contract

Long-running or background work must not stop overnight because the next useful step would be a click in Freed Desktop.

- If a routine local click is truly required to test already authorized work, ask for permission with a 10 minute response window. If the user is unavailable, continue only within authority already granted.
- When the action is likely to recur, implement and ship a terminal trigger instead of depending on foreground UI automation.
- Sitting idle until morning is not acceptable when a trigger can be built or the user has given a timeout path.
- A timeout never authorizes provider traffic, authentication, external posting, deployment, destructive state changes, or a new product behavior. Those actions still require their normal explicit gates.

This is a workflow contract, not a suggestion for one specific script. Generated nightly tasks, release soak notes, morning closeout instructions, and agent handoff prompts must include the same rule whenever they mention app interaction: name the terminal command or trigger to use, identify the missing trigger that must be built before the soak continues, or state the 10 minute timeout path. A background run that can make progress must keep moving. The machine can wait on evidence, CI, network, or a provider-risk approval; it should not wait on performative button etiquette.
