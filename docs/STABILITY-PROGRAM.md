# Stability Program: Provider Sync + Memory

Status: **Active. Wave 2 is underway. The measurement and automation control-plane substrate is being repaired. P1-01 (desktop cloud loop) shipped, but its July 9 effect estimate is provisional because the old soak used wall time without machine-readable cloud-eligible coverage. First land the provider-gated `cloud_sync_coverage` emitter with scoped owner approval. Then re-verify P1-01 with a build-bounded canary context before opening the P1-02 behavior slot. The scrape-memory restart cluster (P1-04/P1-05) remains the strongest raw instability signal.**
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
- **One global behavioral change.** This is one slot across every task, exclusivity key, branch, and worktree. Product PRs in Phases 0-4 land one at a time. The slot reopens only after the change is installed, its bounded soak completes, and the effect outcome is recorded. Never batch damper PRs. Runtime-neutral substrate work such as scripts, skills, docs, CI, and measurement may be grouped only when it cannot affect the observed runtime metric.
- **Alarm before damper when cheap.** If an invariant alarm for a pathology can land first, land it first: it observes the live pathology for one soak (positive control), then the fix flips it to zero.
- **Provider-visible lane.** Anything that changes WebView loads, provider navigation, request frequency, cookies, headers, or extractor scripts uses two owner gates. Gate 1 requires explicit approval of the named observable behavior, fingerprinting risk, and lower-profile alternative before implementation. General permission to proceed with the program does not count. Gate 2 starts after the candidate diff is committed. Its external JSON record cannot be future-dated, lasts at most seven days, exactly matches the provider-visible path set, maps every path to its provider scope, and binds the full committed binary diff hash. Compute the packet digest and ask the owner to confirm that exact digest in the current task. A signing-free `owner-confirmation` record must carry the stable task or thread reference and that exact `authorizationDigest`. This direct path is cooperative and relies on the explicit current-task confirmation plus CODEOWNER review, not on the JSON authenticating its author. A `control-task` record may instead use the optional signed broker for machine-verifiable authorization of the same digest. Publish with `--provider-risk-approval-file <approval.json>` only while the branch remains clean. The PR stays draft until exact-diff CODEOWNER review and a separate owner-authorized ready transition.
- **Governance.** Tasks marked `runner-safe: true` may be executed and merged by autonomous loops under existing validation gates. Tasks marked `runner-safe: false` (anything touching `src-tauri/src/lib.rs` recovery/relay/trigger regions, sync merge paths, or auth state) require owner review of the PR before merge. Automation authority and current task state come from the checked-in specifications and atomic control manifest, not from stale chat or roadmap prose.
- **Verification is counters, not vibes.** Every product task names the runtime-health counter or test that proves it. Shared metric IDs, event contracts, aggregation, minimum coverage, and thresholds live in `scripts/lib/stability-metrics.mjs`. Missing required fields or coverage produces `skipped` or `inconclusive`, never a pass.
- **Outcome recording.** On merge, append `merged` to the schema version 3 outcome ledger through the canonical task transition. Record `installed` at the install boundary. After a valid evidence window, record `verified_effective`, `verified_neutral`, `regressed`, or `inconclusive` against the exact verdict file and canonical task. `merged` is not proof of effect.

## Control-plane substrate

The stability loop now separates observation, planning, mutation, and effect
verification. See [AUTOMATION-CONTROL-PLANE.md](AUTOMATION-CONTROL-PLANE.md) for
the complete operator contract.

| Component | Contract |
| --- | --- |
| Metric registry | `scripts/lib/stability-metrics.mjs` supplies shared metric IDs, automatic guardrails, six-hour lifecycle exposure, and credited-duration comparison semantics to soak, canary, and triage. Old evidence that lacks required fields stays visibly unavailable. |
| Current task state | `~/.freed/automation/control/current-tasks.json` is schema-versioned, revisioned, and replaced atomically. |
| Audit history | `~/.freed/automation/control/events.jsonl` records task, authority, observer, and lease changes as append-only events. |
| Writer ownership | Private actor credentials authenticate automation lease acquisition. Normal publication uses the caller's existing GitHub authentication through the governed helper. Hosts may optionally add a broker-signed capability and target-scoped publisher lease for unattended publication. Active leases cannot be stolen; expired takeover is recorded. |
| Automation intent | `automation/specs/*.json` and `automation/prompts/*.md` define reviewed authority, provider policy, prompt, and soak limit. Validation requires runtime actor-policy parity. Recognized machine-local schedule and model settings remain host overlays. |
| Outcome truth | `~/.freed/automation/outcomes.jsonl` distinguishes merge, install, verified effect, neutral effect, regression, inconclusive evidence, governance blocks, supersession, and implementation failure. |
| Canary history | Each observation window gets its own ledger file. `canary-context.mjs` binds it to a full commit SHA, install boundary, collector session, app PID, app session, exact bounds, workload, host cohort, evidence fingerprint, and valid denominators. Comparisons require at least three compatible prior windows. |
| Runtime bisect | `scripts/bisect-regression.mjs` is plan-only until each checked-out commit can be built, installed, identity-verified, cold-launched, soaked in isolation, and safely restored. |
| Roadmap truth | `docs/roadmap-status.json` mirrors status from `docs/PHASE-*.md`. It does not authorize implementation. Public presentation remains in the separate `www` lane. |

The checked-in agents have deliberately narrow roles. Runtime observer and
release verifier keep product and external state read-only while writing only
their allowed local evidence and control records. Stability controller is
plan-only, nightly runner is merge-safe for eligible work, and scaffolding
maintainer is PR-only. Only the nightly runner has a behavioral soak allowance,
and that allowance is one.

## Wave 1 — Substrate + instrumentation (no soak budget; parallelizable)

| Task | Title | runner-safe | Status |
| ---- | ----- | ----------- | ------ |
| [W1-01](stability-tasks/W1-01-automation-state-out-of-tmp.md) | Move automation state out of /tmp; authenticate canonical task outcomes | yes | ☑ |
| [W1-02](stability-tasks/W1-02-soak-collector-and-assert.md) | Check in soak collector + soak-assert with machine-readable verdict | yes | ☑ |
| [W1-03](stability-tasks/W1-03-doctor-preflight.md) | scripts/doctor.mjs machine preflight for all loops | yes | ☑ |
| [W1-04](stability-tasks/W1-04-fix-ship-build-skill.md) | Rewrite freed-ship-build skill against actual release scripts | no | ☑ |
| [W1-05](stability-tasks/W1-05-build-feature-skill-counters.md) | freed-build-feature: verification-counters step + outcome recording | no | ☑ |
| [W1-06](stability-tasks/W1-06-provider-visible-single-source.md) | Single-source provider-visible path list; publish-time enforcement | no | ☑ |
| [W1-07](stability-tasks/W1-07-docs-truth-pass.md) | Regenerate ARCHITECTURE.md; fix AGENTS.md roadmap rule; canonical soak doc | yes | ☑ |
| [P0-01](stability-tasks/P0-01-perf-gate-pipefail.md) | Make the CI perf gate actually fail (tee swallows exit code) | yes | ☑ |
| [P0-02](stability-tasks/P0-02-window-kill-records.md) | Structured window_destroyed kill records | no | ☑ |
| [P0-03](stability-tasks/P0-03-loop-counters.md) | Loop counters: uploads w/ heads-unchanged, broadcasts, worker INITs, scrape outcomes | no | ◐ counters and consumers landed; provider-gated cloud coverage emitter pending |
| [P0-04](stability-tasks/P0-04-runtime-health-rotation.md) | Daily runtime-health rotation replacing the 5 MiB halving cap | no | ☑ |

Done when: every counter in the scorecard below has a baseline number from one overnight soak.

## Wave 2: Dampers + ops pipeline (one global behavior slot)

| Task | Title | runner-safe | Status |
| ---- | ----- | ----------- | ------ |
| [P1-01](stability-tasks/P1-01-cloud-loop-damper-desktop.md) | Break the desktop cloud upload loop (mutation filter + heads guard) | no | ◐ shipped v26.7.900-dev, build-bounded verification pending |
| [P1-02](stability-tasks/P1-02-cloud-loop-damper-pwa.md) | Break the PWA cloud loop (mutation tag + heads guard) | no | ☐ |
| [P1-03](stability-tasks/P1-03-gdrive-self-write-filter.md) | GDrive self-write filtering + no-op upload skip | no | ☐ |
| [P1-04](stability-tasks/P1-04-preflight-recycle-guard.md) | Preflight recycle guard + login-in-progress latch | no | ☐ |
| [P1-05](stability-tasks/P1-05-recovery-invoke-latch.md) | Recovery never outruns a scrape invoke; persist lastScrapeAt | no | ☐ |
| [W2-01](stability-tasks/W2-01-invariant-alarms.md) | Invariant alarms: cloud_loop, scrape_zero_persist, preflight_kill, auth_zombie, relay_divergence, watchdog_thrash | no | ◐ observing — cloud_loop positive control CONFIRMED (v26.7.701-dev); breakers + relay_divergence deferred |
| [W2-02](stability-tasks/W2-02-triage-loop.md) | Triage loop: alarms + canary + red CI → ranked task files; CI-failure issue hook | yes | ☑ |
| [W2-03](stability-tasks/W2-03-canary-replay-bisect.md) | canary-summarize, watchdog-replay, bisect-regression scripts | yes | ☑ |
| [W2-04](stability-tasks/W2-04-new-skills.md) | Eight governed stability skills, validated commands, and versioned artifact handoffs | yes | ☑ |

Ordering inside Wave 2: W2-01 passive alarms may land before their matching P1 dampers as a positive control. P1-01 through P1-05 and every deferred W2-01 circuit breaker use the same global behavior slot and land one per completed installed-build soak outcome, in numeric order. W2-02/03/04 are runtime-neutral substrate and may run in parallel threads.

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

Baseline measured 2026-07-07 from a 6.05 h idle overnight soak of v26.7.301-dev (`~/.freed/automation/soaks/2026-07-07-0655`, machine awake via caffeinate, GDrive connected, no PWA relay client). The raw window contains the F01/F06 cloud-loop signature, but its historical `soak-assert` verdict is now **inconclusive** for rate claims because it divided by wall time and did not record app-alive or cloud-eligible coverage. A prior launch-hour window (2026-07-05, 57 min, same build) supplies provisional under-load observations only. That run ended with the app self-restarting under memory pressure and then exiting silently about 90 seconds later with no crash report. It is recorded in `soaks/2026-07-05-2251/soak-context.md` and is not a comparable canary baseline.

| Metric | Baseline (fill from first Wave-1 soak) | Target |
| ------ | -------------------------------------- | ------ |
| Idle cloud uploads/hour | Historical raw counts: 67 unchanged uploads in 6.05 wall hours and 98/102 unchanged in a later active window. Post-P1-01 raw counts: 2/8 unchanged attempts and 36 skips across 3.3 wall hours, with cloud_loop 0. These strongly suggest improvement, but no window recorded machine-readable cloud-eligible hours, so the rate and target verdict remain provisional. | <5 per verified cloud-eligible hour |
| Scrapes extracted>0, persisted==0 | Baseline 0 of 4. **v26.7.900-dev active soak caught 1 (F03): a scrape extracted ≥5, persisted 0 — post-scrape recovery destroyed the renderer before persistence. Target P1-05.** | 0 |
| Windows destroyed while session active | 0 active-session kills; 4 idle-window kills (3 job_complete, 1 watchdog_memory); launch hour: 12 kills (7 job_complete, 5 watchdog_memory incl. main renderer at age 2059 s) | 0 |
| LAN convergence phone↔desktop, cloud off | impossible (no relay client connected during soak; relay port LISTEN only) | <10s both ways |
| "job timed out kind=rss-poll" per day | 0 records in runtime-health/diagnostics over the window — not yet counter-instrumented, needs W2-01 for an authoritative number | 0 |
| Dead-session WebView spins/day/provider | night's single scheduled sweep: li 1 full 100 s WebView spin → event_timeout, x 1 api_error (auth misclassification, F-auth theme) | ≤3 then pause+prompt |
| Worker INITs/hour during content backlog | 19.3/h while idle (117 / 6.05 h); 82/h during launch-hour backlog | <10 |
| App memory-pressure p95 during worker lifecycle soak | New registry-v4 baseline required from dense, attributable `native_runtime_memory_sample` evidence in one credited app-alive, page-load, and renderer generation | Worker-init improvements permit no more than 128 MiB p95 growth versus the matched baseline |
| Renderer recoveries/day (thresholds frozen) | 1 attempt / 6 h idle (≈4/day); launch hour: 5 attempts + 3 restart requests in 57 min, ending in silent app death | →0 |
| invariant_alarms/day by name (W2-01) | **Pre-damper baseline (v26.7.701-dev, 6.23 h soak 2026-07-07/08): cloud_loop=7, preflight_kill=1.** cloud_loop fires hard during active windows (alarm details 14 to 19 unchanged uploads/15 min, about 4 times the 5-in-15min threshold) and goes quiet in deep idle. That pattern is a calibration note for the breaker cycle. preflight_kill caught a real held-session teardown (window_destroyed job_complete scraperSessionHeld=true, F04). The same window had 98 unchanged uploads in 102 attempts, a crude wall-time rate of about 16/h. It is not a valid cloud-eligible rate. **After P1-01 (v26.7.900-dev): cloud_loop fell from 7 to 0.** New dominant alarms are the scrape-restart cluster: preflight_kill (scrape memory kills) and scrape_zero_persist (F03: extract>=5, persist 0). Next targets are P1-04/P1-05. | each trends to 0 as its damper lands |
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

1. Load the atomic current task manifest and the current canonical triage generation. Pick the highest-ranked fresh runnable canonical task whose active wave, `runner-safe` value, recorded authority, provider state, and evidence permit action. Markdown checkboxes present program status but never authorize execution. Respect one global product behavior until its installed-build soak outcome completes.
2. The task file is the prompt: it carries context, exact defect, change, files, and verification. Cite finding IDs from stability-findings.json in the PR body.
3. On merge, check the box here in the same PR when possible and record the canonical task's `merged` transition. Record `installed` after installation, then transition to `soaking` before evidence collection. Record the measured effect only after the task's valid soak window, then update the scorecard baseline/current columns.
4. If a task's premise no longer matches the code (line drift, prior fix), verify against the finding's evidence text, then update the task file in the same PR. Do not silently skip.
5. Provider-visible tasks stop and ask the owner first, naming the provider, observable behavior, fingerprinting risk, and lowest-profile alternative. Store the scoped approval JSON outside the repository and bind it to the exact committed diff.
