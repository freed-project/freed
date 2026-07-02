# Social Scrape Optimization Loop

Date: July 2, 2026

## Purpose

Freed's social providers need a repeatable optimization loop, not one-off debugging. The loop starts from local runtime evidence, ranks the safest next engineering work, and keeps provider-visible changes behind explicit review.

## Command

```bash
npm run social:scrape-loop
```

By default, the command reads:

- `~/Library/Application Support/wtf.freed.desktop/runtime-health.jsonl`
- `~/Library/Application Support/wtf.freed.desktop/runtime-diagnostics.jsonl`
- `~/Library/Application Support/wtf.freed.desktop/sync-health.json`

It writes the latest JSON report to:

- `/tmp/freed-social-scrape-loop/latest-report.json`

Useful options:

```bash
npm run social:scrape-loop -- --tail 10000
npm run social:scrape-loop -- --json
npm run social:scrape-loop -- --watch --interval-minutes 15
```

## Locking

The loop uses an atomic lock file by default:

- `/tmp/freed-social-scrape-loop/run.lock`

Normal loop runs acquire this lock automatically and skip if another run is active. Heartbeat automations that may keep working after the report should claim the same lock before editing or validating:

```bash
npm run social:scrape-loop -- --claim-lock --json
```

The command prints a token when it acquires the lock. Release it when the pass is done:

```bash
npm run social:scrape-loop -- --release-lock <token>
```

Locks older than 120 minutes are treated as stale by default so a crashed run does not stop the loop forever.

## What It Ranks

- WebKit resident memory peaks and renderer recovery attempts.
- Social scrape preflights, scrape plans, blocked preflights, and cooldowns.
- Post-block memory recovery for each provider, including the lowest later WebKit RSS sample.
- Providers that recovered under budget after a blocked preflight but did not record a later scrape plan.
- Post-block runtime state, including whether background work was paused, safe mode was active, or another background job occupied the scheduler.
- Provider-health pause and latest attempt state from the local health store.
- Stale provider-health memory errors after runtime memory recovered and the scheduler was idle.
- Provider-specific silent extraction, empty extraction, auth, and placeholder failures when those stages are present in logs.
- Missing provider evidence, such as no X preflights in the analyzed window.
- Preflight-without-plan evidence, such as a provider repeatedly reaching preflight but never recording a scrape plan.

## Safety Boundary

The loop is local-only by default. It does not open provider pages, refresh feeds, scroll, click, retry, traverse stories, hydrate comments, preload media, or alter provider timing. Those changes remain provider-visible and need explicit risk approval before implementation.

The loop always reports these blocked risk decisions:

- Extra authenticated feed navigation or refreshes.
- Scripted scrolling, clicking, retries, or story traversal.
- Automatic media preload, comment hydration, reply expansion, or profile backfill.

## Operating Rhythm

The Codex heartbeat automation `Freed social scrape optimization loop` wakes this thread every 15 minutes. Each pass should:

1. Claim the social scrape loop lock. If the lock is already held, skip the pass.
2. Run the loop report against fresh local logs.
3. Implement the highest-impact local-only fix.
4. Validate the focused surface.
5. Keep provider-visible recommendations as explicit review decisions.
6. Update the draft PR or open a follow-up PR targeting `dev`.
7. Release the social scrape loop lock.
