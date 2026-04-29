import { test, expect } from "./fixtures/app";

test("integrated AI model downloads stay disabled until selected", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(settingsDialog).toBeVisible({ timeout: 5_000 });
  await settingsDialog.getByRole("button", { name: "AI", exact: true }).click();

  const providerSelector = settingsDialog.getByTestId("ai-provider-selector");
  await expect(providerSelector).toBeVisible({ timeout: 5_000 });
  await expect(providerSelector.getByRole("button", { name: /Off/ })).toHaveAttribute("aria-pressed", "true");
  await expect(settingsDialog.getByTestId("local-ai-model-settings")).toHaveCount(0);

  await providerSelector.getByRole("button", { name: /Integrated AI/ }).click();

  const localAISettings = settingsDialog.getByTestId("local-ai-model-settings");
  await expect(localAISettings).toBeVisible({ timeout: 5_000 });
  await expect(localAISettings.getByText("Integrated Model Downloads")).toBeVisible();
  await expect(localAISettings.getByText("Semantic search and ranking")).toBeVisible();
  await expect(localAISettings.getByText("Local summaries")).toBeVisible();
  await expect(localAISettings.getByText("Advanced local assistant")).toBeVisible();
  await expect(localAISettings.getByText("Not installed")).toHaveCount(3);
  await expect(localAISettings.getByRole("button", { name: "Download" })).toHaveCount(3);
});
