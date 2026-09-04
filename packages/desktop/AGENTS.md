# Desktop Package Instructions

Apply these rules to work under `packages/desktop/` in addition to the repository instructions.

## Boundaries and previews

- Import shared product behavior from `@freed/ui` and `@freed/shared`. Never import from `@freed/pwa`.
- Read the shared [visual contracts](../../.agents/skills/freed-ui-polish/references/visual-contracts.md) before changing Desktop UI.
- Use a mocked Desktop preview for ordinary UI work. From the repository root, find a fresh port with `node scripts/lib/find-free-port.mjs 1422`, then launch `./scripts/worktree-preview.sh desktop --port <port>`.
- Use `./scripts/worktree-preview.sh desktop --native` from the repository root only when real Tauri behavior matters, and report its preview label. A local native candidate does not require a version bump, tag, release, or GitHub workflow.
- Show a user-facing preview in the task's built-in Browser and keep that tab attached to the task. If the built-in Browser is unavailable, report the preview URL instead of opening another browser.
- Do not open a visible external browser unless the owner explicitly requests that surface. When an approved external window is required, keep it in the background where possible and close only that task's window at closeout.
- Keep the preview alive while the owner reviews it. Use targeted worktree cleanup and stop only this task's preview at closeout.

## Desktop testing

- Read [tests/e2e/README.md](tests/e2e/README.md) before adding, removing, or debugging Desktop e2e coverage. Run its commands from `packages/desktop` and keep browser automation headless unless the owner explicitly approved an external browser window.
- Keep permanent e2e tests for durable release risks and complete workflows. Delete one-off pixel, spacing, color, shadow, padding, and toolbar-geometry probes before publishing unless they became a shared layout contract, a demonstrated regression test, or an explicit maintained visual test.
- When a Tauri command is added, update both the injected test fixture and the module mock described in the e2e policy.

## Stateful failures

- For a live, rare, intermittent, or stateful failure, use `freed-evidence-capture` before changing the system so logs, process state, build identity, and local data are preserved.
- Route memory regressions to `freed-memory-profile`, deterministic sync or provider-lifecycle reproduction to `freed-sync-replay`, and installed-build observation to the soak policy in `../../docs/SOAK-AND-TRIGGERS.md`.
- A mitigation for a hard-to-reproduce failure must make the next occurrence attributable. Add bounded telemetry and test the state machine, thresholds, retry limits, and recovery transitions that distinguish plausible causes.
