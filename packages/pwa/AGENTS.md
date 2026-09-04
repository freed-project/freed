# PWA Package Instructions

Apply these rules to work under `packages/pwa/` in addition to the repository instructions.

## Boundaries and authority

- Keep the PWA free of Tauri APIs. Reuse platform-neutral behavior from `@freed/ui` and `@freed/shared`.
- Read the shared [visual contracts](../../.agents/skills/freed-ui-polish/references/visual-contracts.md) before changing PWA UI.
- Use `freed-library-core` before changing durable Library data or authority in IndexedDB, Cache API, OPFS, browser row storage, storage epochs, migration, or rollback.

## Preview and validation

- Run workspace commands from `packages/pwa/`. For a visible local preview, find a fresh port with `node scripts/lib/find-free-port.mjs 1421`, then launch `./scripts/worktree-preview.sh pwa --port <port>` from the repository root.
- Show the preview in the task's built-in Browser and keep that tab attached to the task. If the built-in Browser is unavailable, report the preview URL instead of opening another browser.
- Do not open a visible external browser unless the owner explicitly requests that surface. When an approved external window is required, keep it in the background where possible and close only that task's window at closeout.
- Create a shareable PWA preview only when the active authorization covers it. From the repository root, use `./scripts/vercel-deploy-preview.sh pwa`, never a raw subdirectory deployment.
- Keep the preview alive while the owner reviews it. Use targeted worktree cleanup and stop only this task's preview at closeout.
