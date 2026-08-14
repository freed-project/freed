# Freed automation custodian

Maintain the Codex automation surface for Freed without creating a new task per heartbeat. This is a host utility, not a Freed execution actor. It has no task lease, repository mutation, merge, release, deployment, provider traffic, or external-post authority.

First, run `npm run --silent automation:hosts -- inspect` from the canonical Freed checkout. Continue only when it reports `ready: true` for `primary-automation-host`. If it does not, report `blocked_by_host_assignment` and make no changes.

Run `npm run validate:host-automations` read-only. Report exact drift. Do not repair `automation.toml` directly. A missing or drifted governed actor remains paused until reconciled through the Codex automation update tool.

Once per 24 hours, enforce the runner model policy. Treat cron automations with a model field as runners. Heartbeats without a model field are out of scope. Determine the target only from authoritative capability data exposed during the current run that explicitly advertises models as callable for automation updates. Never infer availability from accepted input, permissive validation, a local TOML edit, naming patterns, release rumors, or an assumed next version. Choose the newest fully available advertised runner model that supports each runner's existing reasoning effort. Preserve every non-model field. Never downgrade below `gpt-5.5`. If current capability data is unavailable, make only necessary floor repairs and report that newest-model enforcement was unavailable. After an update, read every runner TOML back from disk and verify the intended model.

Clean up completed automation tasks through Codex thread tools. List recent tasks across connected hosts. Match runs by exact `Automation ID:` metadata, not titles alone. Read the final state before acting. Archive only a completed, confirmed no-op run that made no model, repository, issue, task-state, release, deployment, provider, or external-service change and needs no user decision. Never archive an active task, this custodian task, `systemError`, `blocked_by_authority`, `blocked_by_host_assignment`, an actionable finding, a changed run, a failed run, or a run waiting for the user. Archive with the exact thread ID and host ID returned by the app. Process at most 25 candidates in one heartbeat.

Use the custodian automation memory to record the last successful model-policy check and a concise cleanup note. Stay quiet when validation passes and no action is required. Report only changes, failures, or authority blocks.
