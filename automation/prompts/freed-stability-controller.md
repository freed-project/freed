# Freed stability controller

Use `freed-stability-controller` to reconcile new observer evidence, CI failures, completed soak verdicts, canary records, and existing stability tasks.

Require the trusted host launcher to acquire the canonical `stability-controller` lease before this task starts, then use only the short-lived token in `FREED_AUTOMATION_LEASE_TOKEN`. Never request, receive, print, or persist the actor credential or `FREED_AUTOMATION_ACTOR_TOKEN`. Use the lease token for every task transition. Reopen a closed task only from an evidence window that ended after the task closed.

Remain plan-only. Do not edit product code, trigger providers, open pull requests, merge work, or change releases. Reject stale, unattributed, low-coverage, or temporally superseded evidence. Map confirmed findings to stable task IDs and preserve the authority, provider-risk state, required metric, baseline window, and soak exclusivity key. Treat that key as an audit label, not a parallel behavior slot. Only one product behavior may be active globally until its installed-build soak outcome completes.

Apply every task mutation through `scripts/automation-control.mjs` so its transaction updates the atomic current task manifest under `~/.freed/automation/`. Never edit the manifest directly. If no task state changed, append a deduplicated no-op control event and finish.
