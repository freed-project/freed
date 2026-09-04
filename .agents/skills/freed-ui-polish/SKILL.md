---
name: freed-ui-polish
description: Manage an open batch of small visual UI corrections on one Freed product surface while the owner reviews screenshots or a live preview and sends iterative feedback. Use for queues of spacing, color, typography, control placement, responsive layout, or similar polish. Do not use for net-new features, broad redesigns, or an isolated change that does not need an iterative visual-review checkpoint.
---

# Freed UI Polish

Keep related visual corrections in the same feature worktree and, once published, the same pull request until the owner closes the batch.
The reviewer inspects rendered results. Only the owner moves a commit or publication checkpoint.

## Prepare the surface

Read [visual-contracts.md](references/visual-contracts.md) before changing UI. Apply those contracts to every package touched by the batch.

## Run the review loop

1. Make one narrow correction, then use the cheapest proof that answers the visual question: the live preview, a screenshot comparison, built-in Browser inspection, or a temporary geometry check.
2. Keep the task's existing preview and built-in Browser tab current. Do not relaunch on the same port or run broad cleanup merely to refresh it.
3. Hand the current rendered result to the reviewer after each correction. Agent-only inspection does not satisfy the review checkpoint.
4. Treat continued screenshots, Browser comments, or adjustment requests as an open batch. Do not create or amend a commit while it remains open unless the owner explicitly requests that commit.
5. Delay `npm run validate:feature` and Desktop e2e until the batch closes. Run tests earlier only when the owner requests that checkpoint or the live preview cannot answer a material risk. Focused checks needed to keep the preview runnable are allowed.
6. Treat the owner's statement that the batch is ready as the normal commit boundary.

## Close the batch

1. Add permanent e2e coverage for a visual change only when it protects a shared layout contract, a demonstrated regression, or behavior that cannot be checked reliably in the active task. Delete temporary tests for exact pixels, gaps, colors, shadows, padding, or one-off toolbar geometry before publishing.
2. Cover both inline and overflow states when a toolbar contract changes. Assert menu-section width when a collapsed form control is involved. Cover viewport bounds when a menu can outgrow the visible area.
3. Run focused e2e after the queue settles when the durable risk warrants it. Run `npm run validate:feature` at the publish checkpoint.
4. Update the draft pull request once after the batch is ready unless the owner requested an interim publication.
5. Preserve the preview for review. At closeout, stop only this worktree's preview; use targeted worktree cleanup if cleanup is necessary.
