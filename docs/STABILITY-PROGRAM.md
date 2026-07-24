# Stability Program

Status: **Active.**

GitHub Issues carrying the `debt` label are the sole canonical stability and technical debt backlog. Search that backlog before creating an issue. Use one issue for each independently closable root cause. The issue records the evidence, scope, gates, completion criteria, and disposition.

`~/.freed/automation/control/current-tasks.json` is active execution authority only. It is not a backlog. Every debt-derived task in that manifest must reference its canonical GitHub issue through `details.githubIssue`. Evidence, leases, events, outcomes, and soak artifacts remain operational records and must not become a second queue.

## Why this program exists

Between April and July 2026, about 78 percent of non-release commits on `dev` were corrective. More than 52 WebKit memory fixes did not converge, and watchdog thresholds changed repeatedly without isolating demand-side causes. A verified audit found these root-cause areas:

1. Full-document sync and unbounded Automerge history amplify storage, IPC, cloud, and renderer costs. Track the active work in issues #1082 through #1088.
2. Renderer recovery can destroy the orchestrator or an active provider session before work settles. Track the active work in issues #1070, #1071, #1080, #1081, #1089, and #1097.
3. Watchdog measurements cannot reliably identify WebKit roles or CPU state. Track the active work in issues #1090 and #1091.
4. PWA changes do not converge back to Freed Desktop over the LAN relay. Track the active work in issues #1072, #1073, #1093, and #1094.
5. Provider authentication failures and connection checks can be misclassified. Track the active work in issues #1077 through #1079 and #1098.

The original audit findings and task prompts were migrated to those issues. Git history preserves the retired source files and completed dispositions.

## Program rules

- **Watchdog freeze.** Do not change watchdog thresholds, recovery reasons, or process-attribution heuristics until the measurement and attribution work in issues #1089 through #1091 is complete. When a soak shows recovery churn, prefer a demand-side fix.
- **One global behavioral change.** Product behavior changes land one at a time. The slot reopens only after the change is installed, its bounded soak completes, and its effect outcome is recorded. Runtime-neutral scripts, skills, docs, CI, and measurement may proceed together only when they cannot affect the observed runtime metric.
- **Alarm before damper when cheap.** If an invariant alarm can observe the pathology first, land it as a positive control before changing behavior.
- **Provider-visible lane.** Any change to provider loads, navigation, request frequency, cookies, headers, extractor scripts, or provider API calls requires both provider-risk gates defined in `AGENTS.md`. Draft publication does not authorize live provider traffic.
- **Governance.** Runner-safe work may proceed under the checked-in actor authority and normal validation gates. Recovery, relay, sync merge, auth state, and other owner-review surfaces remain owner reviewed. Automation authority comes from checked-in specifications and the active execution manifest, not from issue status or prose.
- **Verification is counters, not intuition.** Every product issue names the registered runtime-health counter or test that proves it. Shared metric IDs, event contracts, aggregation, minimum coverage, and thresholds live in `scripts/lib/stability-metrics.mjs`. Missing required fields or coverage produces `skipped` or `inconclusive`.
- **Outcome recording.** Record `merged` only through the canonical task transaction. Record `installed` at the install boundary. After a valid evidence window, record `verified_effective`, `verified_neutral`, `regressed`, or `inconclusive` against the exact verdict and task. A merge is not proof of effect.
- **Debt deferral.** During an active delivery, use the smallest check needed to classify a new finding. If it is not a release blocker, create or update its GitHub issue and resume the active plan. Do not expand the delivery into adjacent investigation or implementation.

## Control-plane boundaries

| Surface | Contract |
| --- | --- |
| Canonical backlog | Open GitHub Issues carrying the `debt` label. |
| Metric registry | `scripts/lib/stability-metrics.mjs` supplies shared metric IDs, guardrails, exposure rules, and comparison semantics. |
| Active task state | `~/.freed/automation/control/current-tasks.json` authorizes current execution. Debt-derived tasks reference the canonical issue through `details.githubIssue`. |
| Audit history | `~/.freed/automation/control/events.jsonl` records task, authority, observer, and lease changes. |
| Writer ownership | Kernel-attested trusted launchers issue short-lived actor leases. General actors store no credential in Keychain. |
| Automation intent | `automation/specs/*.json` and `automation/prompts/*.md` define reviewed authority, provider policy, prompts, and soak limits. |
| Outcome truth | `~/.freed/automation/outcomes.jsonl` distinguishes merge, install, verified effect, neutral effect, regression, inconclusive evidence, governance blocks, supersession, and implementation failure. |
| Canary history | Content-addressed canary records bind exact builds, sessions, time bounds, workloads, cohorts, denominators, and raw evidence. |
| Roadmap truth | `docs/roadmap-status.json` mirrors phase status from `docs/PHASE-*.md`. It does not authorize implementation or track debt. |

The stability controller reconciles open debt issues with healthy evidence and active execution state. The nightly runner executes only controller-selected, eligible issues. When the backlog is empty, the controller selects the next package or subsystem from a persisted discovery cursor, inspects only that declared dependency boundary, and files evidence-backed issues. It records the completed boundary and cutoff, then stops. Newly discovered debt cannot be implemented in the same run.

## Scorecard

All values come from attributable runtime-health counters. Idle measurements use an installed overnight soak unless the metric states otherwise.

The first baseline was recorded on 2026-07-07 from a 6.05 hour idle soak of v26.7.301-dev. Its cloud counts remain descriptive because the historical window did not record machine-readable cloud-eligible coverage. Issue #1066 owns that missing denominator and the build-bounded re-verification of the shipped Freed Desktop cloud damper.

| Metric | Baseline | Target |
| --- | --- | --- |
| Idle cloud uploads per hour | Historical raw counts: 67 unchanged uploads in 6.05 wall hours and 98 of 102 unchanged in a later active window. Post-damper raw counts: 2 of 8 unchanged attempts and 36 skips across 3.3 wall hours. No historical window recorded verified cloud-eligible hours. | Fewer than 5 per verified cloud-eligible hour |
| Scrapes with extracted items but zero persisted | 0 of 4 in the first baseline. A later active soak caught 1 lost result after extracting at least 5 items. | 0 |
| Windows destroyed while a session is active | 0 active-session kills and 4 idle-window kills in the first baseline. A later launch window recorded 12 kills. | 0 |
| LAN convergence from phone to Freed Desktop with cloud off | Not available because the inbound relay path does not exist. | Under 10 seconds in both directions |
| RSS poll job timeouts per day | No authoritative counter in the first baseline. | 0 |
| Dead-session WebView spins per day and provider | One LinkedIn event timeout and one X API error in the first scheduled sweep. | At most 3, then pause and prompt |
| Worker initializations per app-alive hour | 19.3 while idle and 82 during a launch backlog. | Fewer than 10 |
| App memory-pressure p95 during worker lifecycle soak | A new dense, attributable baseline is required. | No more than 128 MiB growth against the matched baseline |
| Renderer recoveries per day | One attempt in 6 idle hours. A launch window recorded 5 attempts and 3 restart requests in 57 minutes. | 0 |
| Invariant alarms per day by name | The pre-damper baseline recorded `cloud_loop=7` and `preflight_kill=1`. After the Freed Desktop cloud damper, `cloud_loop=0`; scrape restart alarms became dominant. | Each trends to 0 as its root cause closes |
| Corrective commit share | About 78 percent of non-release commits in the audit window. | Trending down |

## Execution sequence

1. Select an open `debt` issue with healthy, attributable evidence.
2. Confirm there is no duplicate issue for the same root cause.
3. Create or reconcile the active execution task with the canonical issue reference.
4. Apply authority, provider-risk, and one-behavior-slot gates.
5. Implement through the appropriate governed workflow.
6. Validate the named counter or test.
7. Record merge, install, and effect outcomes separately.
8. Close the GitHub issue only when its completion criteria and required evidence are satisfied.

The canonical soak and trigger contract is [SOAK-AND-TRIGGERS.md](SOAK-AND-TRIGGERS.md). The complete task, lease, outcome, and artifact contract is [AUTOMATION-CONTROL-PLANE.md](AUTOMATION-CONTROL-PLANE.md).
