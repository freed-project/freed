# Never-merge cancellation probe for issue #2121

This branch is a disposable hosted status experiment. Never merge it, open a product PR for it, or promote its replacement nightly workflow. It runs no product, native, provider, or storage suite. The source branch `fix/native-acceptance-gate` remains at `bd045423`.

## Source identity and experiment differences

Included `source-ci.yml` is the complete byte-for-byte `.github/workflows/ci.yml` from reviewed local commit `6364f7c7cc60413ffabb2388fcbf6375a8eefd9e`. Its SHA256 is `53a75ca66a5bc5e8c1c37444abbc995dd00cd96f1cc85b8a0146dc075821a6cb`. No remote checkout of that commit is required. The experiment checks out its own immutable dispatch SHA and verifies the included source hash.

The aggregate retains the source's six dependency IDs, Ubuntu runner, two-minute job timeout, `always()` job and status-step conditions, complete status shell body, and exact final `if: cancelled()` guard body and one-minute timeout. The probe adds step IDs for evidence, checkout/source verification, and a final outcome classifier. It changes the display name. The six dependencies are cheap synthetic successes with synthetic planner outputs. EVENT_NAME, BASE_REF and REF are explicitly simulated as an accepted dev PR; all other result/output expressions remain source-bound. This is not execution of the production workflow or native proof.

The first real status body must return successfully before the appended rendezvous prints `PROBE_RENDEZVOUS_OPEN` to logs and the job summary, then sleeps for exactly 60 seconds. The same `always()` step remains active during that wait. It subsequently prints `PROBE_RENDEZVOUS_CLOSED` and returns normally. The final source guard then evaluates cancellation. If root misses the window, the guard skips and the classifier fails with `PROBE_NOT_PROVEN`; absence of cancellation cannot produce a successful experiment.

GitHub documents that an `always()` job and an `always()` step can continue during normal cancellation. This is the behavior under test, not an assumed hosted result: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation. If the runner instead interrupts the first step, skips the guard, or reaches a timeout, report that result as unproven. Do not change conditions to manufacture a pass.

## Local evidence

Run from the experiment checkout with pinned Node:

```sh
node --test scripts/experiments/native-gate-cancel-proof/contracts.mjs
/tmp/native-gate-actionlint-1.7.12/actionlint -shellcheck= -pyflakes= .github/workflows/tooling-nightly.yml
```

The local tests bind the source hash, compare exact aggregate bodies/conditions and allowed synthetic differences, execute the real accepted/rejected status bodies with only sleep stubbed, execute the exact failing guard, and reject missed/skipped/interrupted/timed-out evidence combinations. They do not emulate GitHub cancellation. The task-local upstream actionlint 1.7.12 archive was checksum verified. No repository dependency or permanent universal gate is added.

## Root procedure after independent exact review

1. Record the reviewed experiment commit and confirm only the experiment branch will be published. Preserve `fix/native-acceptance-gate` at `bd045423`; do not use a merge or rebase. Publish the exact experiment commit to `chore/native-gate-cancel-proof` through the approved experiment publication path. Do not open a mergeable PR. Confirm the remote branch SHA before dispatch.
2. Dispatch the already registered `tooling-nightly.yml` workflow on that branch exactly once:

   `gh workflow run tooling-nightly.yml --repo freed-project/freed --ref chore/native-gate-cancel-proof`

3. Capture the returned/discovered run identity. Verify event `workflow_dispatch`, the exact reviewed experiment head, run attempt 1, and the synthetic workflow name. Save the run/jobs JSON and all six dependency conclusions. Each must be success. Do not cancel a similarly named production run.
4. Open the aggregate's live logs. The job summary is retained evidence but may not be uploaded until the step finishes, so do not rely on it for timely cancellation. Wait for `PROBE_RENDEZVOUS_OPEN` for this exact run/attempt/SHA after source verification and successful real status output. The API merely showing the step in progress is insufficient. The marker contains UTC time and `wait_seconds=60`. If the marker is unavailable or the window has closed, do not claim the intended cancellation point; let the bounded missed-window failure settle and report it. Do not automatically rerun.
5. During that confirmed window, record UTC time and invoke normal cancellation once:

   `gh run cancel RUN_ID --repo freed-project/freed`

   Save the command response. Do not use force-cancel, dispatch another run, or rely on concurrency cancellation. The probe's isolated concurrency group includes run ID and never cancels another run.
6. After terminal settlement, save run metadata, job/step metadata and complete aggregate logs. Verify checkout and source verification success; exact source/hash/run/attempt; accepted status output; OPEN then CLOSED markers; status step conclusion success; and `Reject workflow cancellation` executed with its expected message, exit code 1, and step conclusion failure. The classifier must report `PROBE_GUARD_EXECUTED_AND_FAILED`. The aggregate and run must not be successful. A run-level cancelled conclusion alone is not evidence that the guard executed.
7. Correlate the normal-cancel request timestamp with the 60-second window. Preserve annotations and timing. A forced cancellation, infrastructure failure, source check failure, guard skipped/cancelled/timed_out, missing logs, classifier not running, or status step not successful is inconclusive for this requested path. A failed job without the guard's exact failed step/log is not proof. The classifier alone cannot authenticate the cancel API used; the root's saved normal-cancel receipt is required.
8. Return attributable evidence to #2121's integration review. This proves only the synthetic hosted path under the recorded source and conditions. It does not replace exact-head production CI, native suites, selected/unselected scheduling proof, or merge acceptance. Root decides cleanup after preserving receipts. Never merge this experiment.

## Bounds and authority

Manual dispatch only; branch-guarded synthetic jobs; contents read only; pinned checkout action with credentials not persisted; no secrets inputs, npm install, native jobs, or custom API calls in the workflow. Synthetic jobs have one-minute timeouts, the aggregate retains two minutes, and the rendezvous takes one minute. A queue delay does not count toward proof. Root alone publishes, dispatches and cancels after review. Local preparation grants none of those actions.
