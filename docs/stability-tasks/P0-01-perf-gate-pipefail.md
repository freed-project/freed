# P0-01: Make the CI perf regression gate actually fail

runner-safe: true | provider-visible: false | soak-gated: no
Findings: see stability-findings.json (scaffolding: "CI perf regression gate never fails the build")

## Context

In `.github/workflows/ci.yml`, the perf regression step pipes `perf-compare` output through `tee` without `pipefail`, so the compare script's `exit(1)` is swallowed and the job passes. The one automated perf gate in the repo is advisory without anyone knowing.

## Change

Either set `shell: bash` with `set -o pipefail` for that step, or split it: run perf-compare writing to a file, then upload/print the file in a separate step. Prefer the split (simpler to reason about, keeps full output as an artifact).

## Verify

- Push a throwaway branch with an intentionally regressed value in `packages/desktop/tests/e2e/perf-baselines.json`; the Validation workflow must go red on the perf step. Revert the throwaway.
- Normal PRs stay green.
