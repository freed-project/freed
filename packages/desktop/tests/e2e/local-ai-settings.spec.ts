import { test, expect } from "./fixtures/app";

test("integrated AI settings select a single local pack without flicker", async ({ app, page }) => {
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
  await expect(settingsDialog.getByTestId("ai-provider-sharing-label")).toHaveText("Shares nothing");
  await expect(providerSelector.getByRole("button", { name: /Off/ })).toHaveAttribute("aria-pressed", "true");
  await expect(providerSelector.getByText("Choose one AI path")).toHaveCount(0);
  await expect(providerSelector.getByText("Shares nothing")).toHaveCount(0);
  await expect(settingsDialog.getByTestId("local-ai-model-settings")).toHaveCount(0);

  await providerSelector.getByRole("button", { name: /Integrated AI/ }).click();
  await expect(providerSelector.getByRole("button", { name: /Integrated AI/ })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1_250);
  await expect(providerSelector.getByRole("button", { name: /Integrated AI/ })).toHaveAttribute("aria-pressed", "true");
  await expect(providerSelector.getByRole("button", { name: /Off/ })).toHaveAttribute("aria-pressed", "false");
  await expect(settingsDialog.getByTestId("ai-provider-sharing-label")).toHaveText("Keeps content on this device");

  const localAISettings = settingsDialog.getByTestId("local-ai-model-settings");
  await expect(localAISettings).toBeVisible({ timeout: 5_000 });
  await expect(localAISettings.getByText("Integrated AI Download")).toBeVisible();
  await expect(localAISettings.getByText("Integrated AI local pack")).toBeVisible();
  await expect(localAISettings.getByText("Local summaries")).toHaveCount(0);
  await expect(localAISettings.getByText("Advanced local assistant")).toHaveCount(0);
  await expect(localAISettings.getByText("Not installed")).toHaveCount(1);
  await expect(localAISettings.getByRole("button", { name: "Download" })).toHaveCount(1);

  const summaries = settingsDialog.getByRole("switch", { name: "Summaries and extraction" });
  const topics = settingsDialog.getByRole("switch", { name: "Topics and ranking" });
  await expect(summaries).toHaveAttribute("aria-checked", "true");
  await expect(topics).toHaveAttribute("aria-checked", "true");

  await summaries.click();
  await expect(summaries).toHaveAttribute("aria-checked", "false");

  await providerSelector.getByRole("button", { name: /Ollama/ }).click();
  await expect(providerSelector.getByRole("button", { name: /Ollama/ })).toHaveAttribute("aria-pressed", "true");
  await expect(summaries).toHaveAttribute("aria-checked", "false");
  await expect(topics).toHaveAttribute("aria-checked", "true");

  await providerSelector.getByRole("button", { name: /Off/ }).click();
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveCount(0);

  await providerSelector.getByRole("button", { name: /OpenAI/ }).click();
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveAttribute("aria-checked", "true");
  await expect(settingsDialog.getByRole("switch", { name: "Topics and ranking" })).toHaveAttribute("aria-checked", "true");
});
