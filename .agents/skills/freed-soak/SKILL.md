---
name: freed-soak
description: Run an installed-build soak of Freed Desktop terminal-first — launch with open -g, start the soak collector, optionally kick provider syncs with dev-sync-trigger, and judge the window with soak-assert. Use when asked to soak a build, observe an installed release overnight, or produce a soak verdict for the stability program.
disable-model-invocation: true
---

# Soak

Observe an installed Freed Desktop build over hours using terminal evidence only, then judge the window with a machine-readable verdict. The canonical contract lives in [docs/SOAK-AND-TRIGGERS.md](../../../docs/SOAK-AND-TRIGGERS.md); if this skill and that document disagree, the document wins. Program rules in [docs/STABILITY-PROGRAM.md](../../../docs/STABILITY-PROGRAM.md) bind every soak: **no watchdog changes, one behavioral change per soak cycle, provider-visible work needs owner approval first.**

## Workflow

1. Confirm what is installed and running: `defaults read /Applications/Freed.app/Contents/Info.plist CFBundleShortVersionString` and `pgrep -fl "Freed.app/Contents/MacOS"`. If the app is not running, launch it in the background with `open -g /Applications/Freed.app` — never a foregrounding click path.
2. Start collection: `node scripts/soak-collect.mjs --detach`. It samples the app process, the WebKit process table, and runtime-health offsets into `~/.freed/automation/soaks/<timestamp>/` and repoints `~/.freed/automation/current-soak-dir`. For unattended overnight windows, hold the machine awake with `caffeinate -is` (record its pid; kill it at soak end).
3. Write a `soak-context.md` into the soak dir at start: build version, why this soak is running, cloud/provider/relay connection state (verified from local logs — sync-health.json, runtime-health.jsonl — never by opening the app UI), and which program cycle this window belongs to (baseline, positive control, post-damper).
4. If a provider sync must be triggered for signal, use `node scripts/dev-sync-trigger.mjs <provider>` per the canonical doc, including its locked-machine spacing rules. Dev-channel builds enable the trigger automatically.
5. Never stall overnight waiting for a click: follow the 10-minute-timeout contract — ask with a 10-minute response window, then proceed; ship a terminal trigger for anything recurring.
6. While the soak runs, heartbeat hourly: app + collector pids alive, `metrics.tsv` growing. If the app died, append the death time and any runtime-health/crash evidence to `soak-context.md`, relaunch with `open -g`, and record the relaunch — deaths are evidence, not something to fix mid-soak.
7. After the target window (≥6h for program soaks), judge it: `node scripts/soak-assert.mjs`. It writes `soak-verdict.json` with named, file:line-cited assertions. Report the verdict path and the assertion table.
8. Close out: stop caffeinate, decide whether the collector keeps running for the next cycle, and record the verdict's headline counters wherever the requesting cycle needs them (scorecard column, canary ledger via freed-canary, or a PR).

## Success criteria (counters, not vibes)

- A `soak-verdict.json` exists for the window with every assertion judged (pass/fail/skipped), each failure citing file:line evidence.
- `soak-context.md` records build, purpose, connection state, and any mid-soak deaths/relaunches.
- The window is attributable: one build, known start/end, collector samples covering it.
