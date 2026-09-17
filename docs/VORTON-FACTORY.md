# Vorton Factory

`vorton.factory.json` is the version 1 repository workflow contract for Vorton
Factory. FreedOS links the shared module as **Factory**. The controller lives in
Vorton; Paseo owns agent execution and account quota enforcement.

The root schema is a portable copy of Vorton's
`modules/factory/vorton.factory.schema.json`. Other projects can copy the schema
and config, then change the repository, base branch, label vocabulary, and
validation commands. No project adapter is required. Update schema copies together
when changing the versioned contract. A standard JSON Schema draft-07 validator
can check the document offline; Vorton's `factory:validate` command also checks
branch names and contradictory labels.

Use `factory:ready` only after the supported authorization checks admit the issue.
Priority labels order eligible issues; they do not authorize work. The configured
order is `priority:critical`, `priority:high`, `priority:normal`, then `priority:low`.
Until the council assigns a priority, eligible issues fall back to oldest
approval, then issue number. Conflicting priorities require
reconciliation before dispatch. Missing approval evidence holds an issue.

The controller must load configuration from a trusted base commit, pin that
commit for the attempt, and reject unsupported versions or unknown fields.
Never reload execution policy from the worker's candidate branch. Resolve the
base branch with Git before use. Validation commands are argument arrays run
from the worktree root without a shell. They still execute repository code and
must run inside the worker's execution boundary.

Factory validation uses `node scripts/doctor.mjs --strict --factory-worker`.
This checks the pinned Node toolchain, PATH Node, Git, curl and Python without
reading controller credentials, legacy automation authority or publisher state.
A wrong or missing PATH Node fails this worker check. The normal host scope and
`--require-publisher` retain their existing checks; worker scope cannot satisfy
publisher readiness. The trusted controller remains responsible for ownership,
quota admission, approval and publication. Worker preflight grants none of these.

The instruction validator excludes the root `.codex` runtime directory, which
the worker boundary makes unreadable. Keep repository instruction files in the
normal root and scoped source paths. Nested source directories retain instruction
validation.

Configuration grants no authority and activates no schedule. Preserve Freed's
claim, provider approval, behavioral concurrency, and publication requirements.
Review must approve the exact published commit. Workers cannot merge, deploy,
release, or close issues. Account identities, secrets, quota thresholds, local
paths, and controller lease settings do not belong in this file.

This change supplies configuration only. The controller must enforce these
rules before unattended work is enabled.
