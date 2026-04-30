import { test, expect } from "./fixtures/app";

test("integrated AI settings offer a recommended local pack ladder", async ({ app, page, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("get_ai_hardware_profile", () => ({
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    availableMemoryBytes: 10 * 1024 * 1024 * 1024,
    availableAppDataBytes: 64 * 1024 * 1024 * 1024,
    os: "macos",
    arch: "aarch64",
    webGPUAvailable: true,
  }));

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
  await expect(settingsDialog.getByTestId("local-ai-model-settings")).toHaveCount(0);

  await providerSelector.getByRole("button", { name: /Integrated AI/ }).click();
  await expect(providerSelector.getByRole("button", { name: /Integrated AI/ })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1_250);
  await expect(providerSelector.getByRole("button", { name: /Integrated AI/ })).toHaveAttribute("aria-pressed", "true");
  await expect(settingsDialog.getByTestId("ai-provider-sharing-label")).toHaveText("Keeps content on this device");

  const localAISettings = settingsDialog.getByTestId("local-ai-model-settings");
  await expect(localAISettings).toBeVisible({ timeout: 5_000 });
  await expect(localAISettings.getByText("Integrated AI Download")).toBeVisible();
  await expect(localAISettings.getByText(/Choose one local pack/)).toBeVisible();
  await expect(localAISettings.getByText(/Semantic scans run on startup/)).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-light")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-pro")).toBeVisible();
  await expect(localAISettings.getByText("Recommended: Balanced")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Selected")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Recommended", { exact: true })).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText(/Classified:/)).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText(/Last scan:/)).toBeVisible();
  await expect(localAISettings.getByText("Not installed")).toHaveCount(3);
  await expect(localAISettings.getByRole("button", { name: "Download" })).toHaveCount(3);

  await localAISettings.getByTestId("local-ai-pack-balanced").getByRole("button", { name: "View Balanced model source" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX",
  );

  const summaries = settingsDialog.getByRole("switch", { name: "Summaries and extraction" });
  const topics = settingsDialog.getByRole("switch", { name: "Topics and ranking" });
  await expect(summaries).toBeDisabled();
  await expect(topics).toBeDisabled();

  await localAISettings.getByTestId("local-ai-pack-light").getByRole("button", { name: "Use pack" }).click();
  await expect(localAISettings.getByTestId("local-ai-pack-light").getByText("Selected")).toBeVisible();
  await expect(summaries).toHaveAttribute("aria-checked", "false");
  await expect(topics).toHaveAttribute("aria-checked", "false");

  await providerSelector.getByRole("button", { name: /Ollama/ }).click();
  await expect(providerSelector.getByRole("button", { name: /Ollama/ })).toHaveAttribute("aria-pressed", "true");
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveAttribute("aria-checked", "true");
  await expect(settingsDialog.getByRole("switch", { name: "Topics and ranking" })).toHaveAttribute("aria-checked", "true");

  await providerSelector.getByRole("button", { name: /Off/ }).click();
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveCount(0);
});
