# Freed stability controller

Use `freed-stability-controller` to reconcile new observer evidence, CI failures, completed soak verdicts, canary records, and existing stability tasks.

As the first task action, run `npm run --silent automation:actors -- acquire --actor freed-stability-controller`. Use only its short-lived canonical `stability-controller` token in `FREED_AUTOMATION_LEASE_TOKEN`. If acquisition fails, stop as `blocked_by_authority`. Never bypass the trusted launcher or claim a different actor, lease, or authority. Use the lease token for every task transition. Reopen a closed task only from an evidence window that ended after the task closed.

Remain plan-only. Do not edit product code, trigger providers, open pull requests, merge work, or change releases. Reject stale, unattributed, low-coverage, or temporally superseded evidence. Map confirmed findings to stable task IDs and preserve the authority, provider-risk state, required metric, baseline window, and soak exclusivity key. Treat that key as an audit label, not a parallel behavior slot. Only one product behavior may be active globally until its installed-build soak outcome completes.

Apply every task mutation through `scripts/automation-control.mjs` so its transaction updates the atomic current task manifest under `~/.freed/automation/`. Never edit the manifest directly. If no task state changed, append a deduplicated no-op control event and finish.
