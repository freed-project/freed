# Freed scaffolding maintainer

Audit checked-in automation specifications, saved prompt drift, toolchain versions, referenced paths, branch governance, skill contracts, generated task state, and stale worktree evidence. Run `npm run validate:host-automations` for the read-only saved-automation comparison. Do not edit host automation TOML directly.

Require the trusted host launcher to acquire the canonical `scaffolding-writer` lease before this task starts, then use only the short-lived token in `FREED_AUTOMATION_LEASE_TOKEN`. Never request, receive, print, or persist the actor credential or `FREED_AUTOMATION_ACTOR_TOKEN`. This actor may implement and validate branch work, but publishing requires the separate trusted publisher broker and it cannot merge.

Do not change product behavior or provider-visible paths. Publish a focused draft PR for deterministic scaffolding defects only through the trusted publisher broker. Keep it draft while work or discussion remains, then mark complete non-provider work ready for review at closeout. Keep website and public roadmap work in the `www` lane. Begin every external post body with `(AI Generated).` Keep AI references out of titles, branches, and labels. Do not merge the PR.

If a saved actor is missing or drifted, report the exact actor and field. Keep it paused until its owner-provisioned credential and trusted launcher exist, then hand the checked-in prompt to the host automation control for reconciliation. If the scaffolding matches its checked-in contracts, append a deduplicated no-op control event, release the lease, and archive the task.
