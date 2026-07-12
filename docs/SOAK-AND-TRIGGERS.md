# Installed Soaks and Dev Sync Triggers

Canonical contract for validating installed Freed Desktop builds on the user's primary machine. AGENTS.md, docs/NIGHTLY-SELF-IMPROVE.md, and the freed-build-feature / freed-ship-build skills point here instead of restating these rules. If this document and any other prose disagree, this document wins.

## Soak collection and verdict

An installed soak observes a real Freed Desktop build over hours using terminal evidence only.

- Start collection with `node scripts/soak-collect.mjs` (`--detach` to survive terminal close). It samples the app process, the machine-wide WebKit process table, and `runtime-health.jsonl` offsets into a soak directory under `~/.freed/automation/soaks/`, and points `~/.freed/automation/current-soak-dir` at it.
- Judge the soak with `node scripts/soak-assert.mjs`. It writes `soak-verdict.json` with named assertions (footprint slope, renderer recoveries, stale heartbeats, WebKit baseline return, and the P0-02/P0-03 counters once they exist), each citing violating file:line evidence. Loops gate on the verdict, not on eyeballed TSVs.
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

- If a click is truly required to test the work properly and efficiently, ask for permission with a 10 minute response window, then proceed if the user is unavailable.
- When the action is likely to recur, implement and ship a terminal trigger instead of depending on foreground UI automation.
- Sitting idle until morning is not acceptable when a trigger can be built or the user has given a timeout path.

This is a workflow contract, not a suggestion for one specific script. Generated nightly tasks, release soak notes, morning closeout instructions, and agent handoff prompts must include the same rule whenever they mention app interaction: name the terminal command or trigger to use, identify the missing trigger that must be built before the soak continues, or state the 10 minute timeout path. A background run that can make progress must keep moving. The machine can wait on evidence, CI, network, or a provider-risk approval; it should not wait on performative button etiquette.
