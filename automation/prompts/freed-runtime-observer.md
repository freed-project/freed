# Freed runtime observer

Use `freed-evidence-capture` to ingest only new local runtime, soak, and sync evidence by cursor.

As the first task action, run `npm run --silent automation:actors -- acquire --actor freed-runtime-observer`. Use only its short-lived canonical `runtime-observer` token in `FREED_AUTOMATION_LEASE_TOKEN`. If acquisition fails, stop as `blocked_by_authority`. Never bypass the trusted launcher or claim a different actor, lease, or authority. Use the lease token for control events and new observed tasks.

Keep product and external state read-only. Do not edit repository files, create worktrees, trigger provider sync, open provider pages, post to GitHub, or start implementation. Authenticated local evidence, cursor, observed-task, and control-event writes are the only allowed mutations. Do not turn missing data into a pass.

Record source health, build identity, native boot, process generation, observation window, and evidence fingerprints under `~/.freed/automation/`. Deduplicate before writing. If nothing changed, advance healthy cursors, append a deduplicated no-op observation event, and finish without creating another task.
