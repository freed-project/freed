# Stability Program: Provider Sync + Memory

Status: **Active — Wave 1**
Created: 2026-07-02 (dev @ v26.7.203-dev)
Evidence: [stability-findings.json](stability-findings.json) — 37 findings, each adversarially verified at file:line
Task queue: [stability-tasks/](stability-tasks/) — one self-contained prompt per task

## Why this program exists

Between April and July 2026, ~78% of non-release commits on `dev` were corrective. 52+ WebKit-memory fixes never converged; watchdog thresholds flipped on the same lines within hours. A deep verified analysis (2026-07-02) traced the recurring themes to root causes, not individual bugs:

1. **All sync dataflow is full-document and the document grows forever.** Every synced mutation ships the entire Automerge snapshot as a boxed `number[]` through two JS heaps plus JSON Tauri IPC (~16-20x doc size transient). History is unbounded. Archive pruning, the only automatic eviction, is disabled whenever cloud credentials exist.
2. **The renderer is the orchestrator and the watchdog destroys the orchestrator.** Verified self-sustaining loops: cloud upload→merge→STATE_UPDATE→upload (runs forever on idle machines); post-scrape recovery destroys the main renderer before the scrape invoke returns (captured posts discarded, throttle wiped, rescrape follows); memory preflight recycles all scraper windows with no active-session check (kills in-flight scrapes and IG/LI logins); trigger-replay TOCTOU double-runs scrapes after recycles.
3. **The watchdog cannot see what it supervises.** WebKit process attribution is a heuristic that cannot tell the main renderer from scrapers; `cpu_usage` is always 0.0 so hot-CPU recovery is dead code and idle gates are vacuous; diagnostics run un-timed subprocesses under the renderer-health write lock.
4. **PWA→desktop LAN sync does not exist.** The relay never merges client pushes into the desktop doc; the PWA pushes once per connection. Phone→desktop convergence rides entirely on the pathological cloud loop.
5. **Auth failures are misclassified.** X 401/403 → "transport" retried forever; logged-out IG/LI spin full hidden-WebView scrapes eternally (memory cost + provider-visible risk pattern).

Every claim above cites code in [stability-findings.json](stability-findings.json). Do not re-derive; cite finding IDs.

## Program rules (binding for all agents and loops)

- **Watchdog freeze.** No changes to watchdog thresholds, recovery reasons, or process-attribution heuristics until Phase 4 completes. If a soak shows recovery churn, the answer is a demand-side task, not a threshold.
- **One behavioral change per soak cycle.** Product PRs in Phases 0-4 land one at a time; the overnight soak attributes the delta. Never batch damper PRs. Wave 1 substrate work (scripts, skills, docs, CI) is exempt — it does not touch runtime behavior.
- **Alarm before damper when cheap.** If an invariant alarm for a pathology can land first, land it first: it observes the live pathology for one soak (positive control), then the fix flips it to zero.
- **Provider-visible lane.** Anything that changes WebView loads, provider navigation, request frequency, cookies, headers, or extractor scripts requires explicit owner approval before implementation. Tasks in this queue marked `provider-visible: true` stop and ask first.
- **Governance.** Tasks marked `runner-safe: true` may be executed and merged by autonomous loops under existing validation gates. Tasks marked `runner-safe: false` (anything touching `src-tauri/src/lib.rs` recovery/relay/trigger regions, sync merge paths, or auth state) require owner review of the PR before merge.
- **Verification is counters, not vibes.** Every product task names the runtime-health counter or test that proves it. A task is not done until its counter moves (or its test exists and passes).
- **Outcome recording.** On merge, append the outcome to the ledger (see task W1-01) so the nightly planner learns.

## Wave 1 — Substrate + instrumentation (no soak budget; parallelizable)

| Task | Title | runner-safe | Status |
| ---- | ----- | ----------- | ------ |
| [W1-01](stability-tasks/W1-01-automation-state-out-of-tmp.md) | Move loop state out of /tmp; auto-record outcomes on merge | yes | ☐ |
| [W1-02](stability-tasks/W1-02-soak-collector-and-assert.md) | Check in soak collector + soak-assert with machine-readable verdict | yes | ☑ |
| [W1-03](stability-tasks/W1-03-doctor-preflight.md) | scripts/doctor.mjs machine preflight for all loops | yes | ☑ |
| [W1-04](stability-tasks/W1-04-fix-ship-build-skill.md) | Rewrite freed-ship-build skill against actual release scripts | no | ☑ |
| [W1-05](stability-tasks/W1-05-build-feature-skill-counters.md) | freed-build-feature: verification-counters step + outcome recording | no | ☑ |
| [W1-06](stability-tasks/W1-06-provider-visible-single-source.md) | Single-source provider-visible path list; publish-time enforcement | no | ☑ |
| [W1-07](stability-tasks/W1-07-docs-truth-pass.md) | Regenerate ARCHITECTURE.md; fix AGENTS.md roadmap rule; canonical soak doc | yes | ☑ |
| [P0-01](stability-tasks/P0-01-perf-gate-pipefail.md) | Make the CI perf gate actually fail (tee swallows exit code) | yes | ☐ |
| [P0-02](stability-tasks/P0-02-window-kill-records.md) | Structured window_destroyed kill records | no | ☑ |
| [P0-03](stability-tasks/P0-03-loop-counters.md) | Loop counters: uploads w/ heads-unchanged, broadcasts, worker INITs, scrape outcomes | no | ☐ |
| [P0-04](stability-tasks/P0-04-runtime-health-rotation.md) | Daily runtime-health rotation replacing the 5 MiB halving cap | no | ☑ |

Done when: every counter in the scorecard below has a baseline number from one overnight soak.

## Wave 2 — Dampers + ops pipeline (soak-gated, one product PR per cycle)

| Task | Title | runner-safe | Status |
| ---- | ----- | ----------- | ------ |
| [P1-01](stability-tasks/P1-01-cloud-loop-damper-desktop.md) | Break the desktop cloud upload loop (mutation filter + heads guard) | no | ☐ |
| [P1-02](stability-tasks/P1-02-cloud-loop-damper-pwa.md) | Break the PWA cloud loop (mutation tag + heads guard) | no | ☐ |
| [P1-03](stability-tasks/P1-03-gdrive-self-write-filter.md) | GDrive self-write filtering + no-op upload skip | no | ☐ |
| [P1-04](stability-tasks/P1-04-preflight-recycle-guard.md) | Preflight recycle guard + login-in-progress latch | no | ☐ |
| [P1-05](stability-tasks/P1-05-recovery-invoke-latch.md) | Recovery never outruns a scrape invoke; persist lastScrapeAt | no | ☐ |
| [W2-01](stability-tasks/W2-01-invariant-alarms.md) | Invariant alarms: cloud_loop, scrape_zero_persist, preflight_kill, auth_zombie, relay_divergence, watchdog_thrash | no | ☐ |
| [W2-02](stability-tasks/W2-02-triage-loop.md) | Triage loop: alarms + canary + red CI → ranked task files; CI-failure issue hook | yes | ☐ |
| [W2-03](stability-tasks/W2-03-canary-replay-bisect.md) | canary-summarize, watchdog-replay, bisect-regression scripts | yes | ☐ |
| [W2-04](stability-tasks/W2-04-new-skills.md) | New skills: freed-soak, freed-triage, freed-canary | yes | ☐ |

Ordering inside Wave 2: W2-01 alarms may land before their matching P1 dampers (positive control). P1-01 through P1-05 land one per soak cycle, in numeric order. W2-02/03/04 are substrate and run in parallel threads.

## Wave 3 — Convergence (plan after Wave 2 evidence; summaries only)

Must land AFTER the P1 dampers or the relay and cloud loops amplify each other.

- Relay inbound path: deliver client-pushed docs to the desktop via the existing MERGE_DOC path; stop echoing pushes to their sender. Acceptance: cloud OFF, phone edit visible on desktop <10s (impossible today).
- PWA outbound on change: debounced broadcastDoc from the doc-change subscriber, skipping relay-sourced merges.
- PWA socket lifecycle: connection-generation guard, jittered backoff; Rust relay server-initiated pings, Drop-guard client count, accept-loop log-and-continue, persist current_doc across restarts.
- GDrive poll resilience: capped-backoff restart on non-auth errors (one 403 currently kills change detection for the session).
- initDoc wipe guard: clear local doc only on confirmed corrupt-document parse error; snapshot before any wipe.

## Wave 4 — Auth truth + scheduler (summaries)

- X: structured status from x_api_request; 401/403 → stage auth after N consecutive failures.
- IG/LI: desktop-side cookie-presence precheck (FB pattern; zero provider-visible edits). Extract-script page-state mapping is a separate provider-visible task requiring approval.
- provider-health: count extract_empty/event_timeout; dead sessions escalate to terminal needs-reconnect (≤3 attempts then pause+prompt).
- Un-nest social scrapes from the rss-poll job (sibling jobs; Rust mutex still serializes WebView work).
- runBackgroundJob holds activeJob until real settlement (copy the side-effect-scheduler pattern).

## Wave 5 — Memory demand-side (summaries)

- Raw-bytes transport: transferable Uint8Array postMessage + Tauri raw ArrayBuffer invoke (deletes the 16-20x number[]/JSON amplification).
- Worker lifecycle: time-based idle unload (30-60s) instead of unload-on-queue-drain + 1s kill; persist compaction bookkeeping across unloads.
- UPDATE_FEED_ITEM through ITEM_PATCH; batch imports persist once.
- Cloud merge moves into the Automerge worker.
- Re-enable eviction for cloud users from markCloudSuccess (guarded by destructive-merge guard + snapshots).
- Adjuncts: cap + timeout on fetch_binary_url; fix FB groups listener leaks on error paths.

## Wave 6 — Structural (design docs first; owner sign-off required)

- Real Automerge sync protocol on the relay (versioned envelope, v1 fallback). Live peers only; cloud stays snapshot+heads-check.
- Epoch-based history compaction (needs written, generatively tested merge spec).
- Rust owns orchestration: persisted cooldowns → native scrape-result buffer → Rust job queue. Carve lib.rs into modules only as each slice ships.
- Deterministic PID→window attribution; per-window memory series; subprocess timeouts; move recovery decision out from under the health lock; then re-derive watchdog thresholds once, validated by offline replay.
- Meta extraction canary (classify auth-broken / DOM-shifted / legit-empty per run). GraphQL interception only if the treadmill continues, via the provider-visible approval lane.

## Scorecard

All from runtime-health counters, idle overnight soak unless noted.

| Metric | Baseline (fill from first Wave-1 soak) | Target |
| ------ | -------------------------------------- | ------ |
| Idle cloud uploads/hour | | <5 |
| Scrapes extracted>0, persisted==0 | | 0 |
| Windows destroyed while session active | | 0 |
| LAN convergence phone↔desktop, cloud off | impossible | <10s both ways |
| "job timed out kind=rss-poll" per day | every cycle | 0 |
| Dead-session WebView spins/day/provider | | ≤3 then pause+prompt |
| Worker INITs/hour during content backlog | | <10 |
| Renderer recoveries/day (thresholds frozen) | | →0 |
| fix:/perf: share of non-release commits | ~78% | trending down |

## What NOT to do

- No watchdog threshold tuning (frozen until Wave 6 attribution work).
- No new supervision/recovery layers; each prior one spawned its own fix chain.
- No Automerge doc sharding; compaction + moving hot state out captures the win.
- No hand-rolled incremental relay frames; full-doc + raw bytes now, real sync protocol in Wave 6, nothing in between.
- No Facebook extractor hardening passes during this program (2-day half-life); diagnostics only.
- Do not fix Dropbox incidentally; decide finish-or-delete explicitly.
- Do not batch soak-gated PRs.

## How loops consume this document

1. Pick the lowest-numbered unchecked task whose wave is active and whose `runner-safe` matches your authority. Respect one-product-PR-per-soak-cycle.
2. The task file is the prompt: it carries context, exact defect, change, files, and verification. Cite finding IDs from stability-findings.json in the PR body.
3. On merge: check the box here in the same PR when possible, append the outcome ledger entry, and update the scorecard baseline/current columns when a soak produces numbers.
4. If a task's premise no longer matches the code (line drift, prior fix), verify against the finding's evidence text, then update the task file in the same PR. Do not silently skip.
5. Provider-visible tasks stop and ask the owner first, naming the provider and the observable behavior change.
