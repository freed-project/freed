# Testing Standard

Status: **Active.**

This document governs which tests exist, where they run, and when they are removed. It is the companion to [STABILITY-PROGRAM.md](STABILITY-PROGRAM.md), which governs product behavior changes.

## Why this exists

The suite reached about 2,700 declared tests across 342 files and roughly 152,000 lines, of which about 107,000 lines were added since July 1. Five control-plane files alone hold about 47,000 lines. Every pull request launched 32 tooling jobs regardless of what changed.

The cost was not theoretical. Friends PR #1111 finished its relevant feature validation in 9 minutes while unrelated tooling consumed 604 runner-minutes and held the pull request for about 88 minutes. Of the last 100 Validation runs, 58 cancelled, burning roughly 60 wall-clock hours. The July 23 production release repeated broad validation five times for about 149 minutes, while packaging all four platforms took under 28 minutes.

The organization runs on the GitHub Free plan: **20 concurrent jobs, 5 concurrent macOS jobs**. A 32-job lane meant one pull request demanded 160 percent of total capacity, so pull requests could not overlap and serialized into the queue. That is the mechanism behind the numbers above.

## Admission

A new permanent test must protect a distinct user, data-integrity, security, authority, provider, release, migration, or operational contract.

Before adding one:

1. Search for existing same-layer coverage.
2. Prefer extending or strengthening an existing test.
3. State the unique failure it detects.
4. Use the cheapest deterministic layer that can detect it.
5. Identify the inputs that invalidate its result.
6. Assign it to an execution tier.
7. Measure its runtime.
8. Avoid real sleeps and production-duration timeouts in blocking lanes.
9. Delete temporary diagnostic probes before publication.

Use engineering judgment. Individual test additions do not need owner approval.

Local regression coverage does not automatically become a permanent universal release gate. A test earns a blocking lane by protecting a contract in the universal gate list below, not by having caught something once.

## Execution tiers

| Tier                | Runs on              | Contains                                                                                                       |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Changed-path     | Every pull request   | Only suites the changed paths can affect                                                                       |
| 2. Full integration | Every push to `dev`  | Every suite, unscoped. This is the proof release admission inherits                                            |
| 3. Release delta    | Tag and promotion    | Version, notes, identity, build, packaging, artifacts                                                          |
| 4. Exhaustive       | Nightly and dispatch | Stress, fault injection, full visual and performance matrices, long control-plane simulations, flake discovery |

A test may be release-critical through an exact inherited receipt without rerunning inside the release workflow.

## How tier 1 is computed

`scripts/plan-tooling-smoke.mjs` derives the applicable suites from the changed path set and emits a GitHub Actions matrix. Its temporary cap is **16 jobs** while the security-boundary runtime defect in issue #1147 remains. Return the cap to **8 jobs** when the measured suites fit the blocking timeout.

Attribution uses two signals, because neither alone is correct:

- **Transitive relative imports** from each suite's test files.
- **Repo-path string literals** named anywhere in that closure. Several validators assert facts about content they never import, such as the provider-visible path list and the roadmap status file. An import graph alone would miss them.

A path literal counts as a dependency edge only when it is concrete. Bare roots such as `packages/` and package roots such as `packages/desktop/` appear in sources as `startsWith` guards rather than references. Treating those as edges attached every UI change to the control-plane suites, which is the exact waste this planner removes.

The planner fails closed. Any change under `scripts/` or `automation/` that cannot be attributed selects every suite, as does any change to a global input such as `package.json`, `.nvmrc`, or the workflow itself. An empty plan is reported as a quick not-applicable success, and the gate then requires that the shard job was genuinely skipped rather than failed.

Phase documents, `docs/roadmap-status.json`, and the roadmap validator have an explicit focused route. They run the manifest validator and its unit test. They do not launch general tooling shards or assert that one named phase must remain current forever.

Shard budget is distributed across the selected suites by highest averages. Within each suite, complete per-file or per-test timings from `scripts/tooling-smoke-durations.json` replace source-size weights. Partial timing sets are ignored rather than mixing seconds with bytes. Every shard uploads JUnit timings so a completed integration run can refresh the exact units that need balancing.

## Platform routing

Three files gate every test behind a single module-level `process.platform === "darwin"` check. Running them on Ubuntu spent time and asserted nothing, and one of them was observed blocking indefinitely at 0 percent CPU. They run on the macOS lane only:

- `scripts/automation-actor-native.test.mjs`
- `scripts/release-tag-publisher-native.test.mjs`
- `scripts/trusted-publisher-host.test.mjs`

`scripts/worktree-publish.test.mjs` deliberately stays in the Linux lane. It gates 7 of its 35 tests per-test, so the other 28 are real coverage. It also runs on the macOS lane, where its darwin cases execute for the first time.

`scripts/automation-actor-linux.test.mjs` runs its five native launcher tests only
on Linux. It compiles the reviewed Go source, exercises the real file descriptor
channel and process boundary, and verifies that the production helper emits
static tools. macOS records the suite as skipped because the Swift launcher has
its own native lane.

`run-tooling-smoke-shard.test.mjs` asserts that the sharded suites, the general suite, and the macOS lane together claim every repository test file. Nothing can fall out of the lane silently.

## Timeouts

Shards run with a per-test timeout of 5 minutes. `node --test` defaults to no timeout, which let one blocked test pin a shard until the job-level timeout with no useful signal. Any tooling test slower than this in a blocking lane is a defect, not a long test.

## Performance gates

Tier 1 and Tier 2 may block on deterministic performance contracts such as
bounded work, allocation, residency, rebuild counts, and output size.

Raw elapsed time, animation-frame rate, LongTask entries, heap demand, and GPU
timing from a virtualized browser belong in Tier 4 unless the lane fixes the
hardware, browser, renderer, workload, and statistical comparison rule. A
missing or unsupported instrument is inconclusive. It must never be recorded as
zero work.

The raw Desktop browser performance suite runs in the nightly full matrix. Feature, `dev`, and production validation keep deterministic work and output budgets, but do not block on one virtual browser timing sample.

## Universal release gate

Keep this list small. These are the only checks that gate every release:

- Protected source and tree identity
- Exact green integration receipt
- Provider approval receipt when applicable
- Promotion and backflow validity
- Version consistency
- Approved release notes and release receipt
- Publisher and tag authority
- Four-platform compilation and packaging
- Signing and notarization
- Updater manifest and artifact hashes
- Concise packaged startup, migration, updater, and data-open smoke

Do not rerun unrelated unit, e2e, visual, performance, automation, outcome-ledger, Website, Rust, or provider suites when their inputs are unchanged.

The Website is a separate lane. It ships from `www` through its own job against the reviewed marketing branch, so it is not built or tested inside the Desktop release lane.

## Continuous maintenance

Collect per-suite runtime, flake rate, runner cost, skipped-platform coverage, and unique defect catches. The nightly lane uploads timings and opens one deduplicated debt issue when a suite goes flaky or drifts by more than 2x.

Continuously:

- Remove obsolete fixtures
- Merge duplicate same-layer assertions
- Move useful but expensive tests to nightly
- Quarantine inconsistent noncritical tests with one debt issue and owner
- Rewrite real-time waits using injected clocks
- Restore quarantined tests after sustained clean evidence

Never quarantine data integrity, authority, provider safety, signing, release identity, or updater protection without an equivalent deterministic blocker.

No test stays in a blocking lane merely because it has always been there.

A test that accepts success, failure, timeout, or continued loading detects no defect and must be deleted. The same applies to debug probes, permanently skipped tests, and fixture-dependent assertions that silently skip whenever the fixture is absent. Required controls and fixtures must fail clearly when missing.

## Targets

| Lane                       | Target                                  |
| -------------------------- | --------------------------------------- |
| Ordinary pull request      | Under about 10 minutes                  |
| Complex pull request       | Under 20 minutes at the 95th percentile |
| Latest `dev` integration   | Under 25 minutes                        |
| Release-delta admission    | Under 10 minutes                        |
| Tag to published artifacts | Under about 40 minutes                  |

No UI-only pull request runs control-plane suites.
