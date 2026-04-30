import { test, expect } from "./fixtures/app";

test("cloud sync nudge shows a countdown and closes after fifteen seconds", async ({ app }) => {
  await app.page.clock.install({ time: new Date("2026-04-30T12:00:00Z") });

  await app.goto();
  await app.waitForReady();

  const nudge = app.page.getByText("No cloud sync, your feed won't reach mobile.");
  await expect(nudge).toBeVisible();

  const countdown = app.page.locator(".cloud-sync-nudge-countdown");
  await expect(countdown).toHaveCount(1);

  await app.page.clock.fastForward(14_000);
  await expect(nudge).toBeVisible();

  await app.page.clock.fastForward(1_000);
  await expect(nudge).toBeHidden();
});
