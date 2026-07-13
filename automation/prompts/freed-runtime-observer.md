# Freed runtime observer

Use `freed-evidence-capture` to ingest only new local runtime, soak, and sync evidence by cursor.

Require the trusted host launcher to acquire the canonical `runtime-observer` lease before this task starts, then use only the short-lived token in `FREED_AUTOMATION_LEASE_TOKEN`. Never request, receive, print, or persist the actor credential or `FREED_AUTOMATION_ACTOR_TOKEN`. Use the lease token for control events and new observed tasks. Do not claim a different actor, lease, or authority.

Keep product and external state read-only. Do not edit repository files, create worktrees, trigger provider sync, open provider pages, post to GitHub, or start implementation. Authenticated local evidence, cursor, observed-task, and control-event writes are the only allowed mutations. Do not turn missing data into a pass.

Record source health, build identity, native boot, process generation, observation window, and evidence fingerprints under `~/.freed/automation/`. Deduplicate before writing. If nothing changed, advance healthy cursors, append a deduplicated no-op observation event, and finish without creating another task.
