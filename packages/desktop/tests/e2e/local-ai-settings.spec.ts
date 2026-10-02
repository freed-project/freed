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
  await expect(localAISettings.getByText(/Local classification runs only when Topics and ranking is enabled/)).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-light")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-pro")).toBeVisible();
  await expect(localAISettings.getByText("Recommended: Balanced")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Selected")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Recommended", { exact: true })).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Classified: Off")).toBeVisible();
  await expect(localAISettings.getByTestId("local-ai-pack-balanced").getByText("Last scan: Not enabled")).toBeVisible();
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
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveAttribute("aria-checked", "false");
  await expect(settingsDialog.getByRole("switch", { name: "Topics and ranking" })).toHaveAttribute("aria-checked", "false");

  await providerSelector.getByRole("button", { name: /Off/ }).click();
  await expect(settingsDialog.getByRole("switch", { name: "Summaries and extraction" })).toHaveCount(0);
});

// Tier 1: client-owned credentials, explicit cloud actions and independent Jev settings.
test("Jev browser settings manage a tab-local key without paid requests or summary-provider changes", async ({ app, page }) => {
  let requests = 0;
  await page.route("**/api/jev-preview/**", async route => {
    requests += 1;
    expect(route.request().headers().authorization).toBe("Bearer jev-settings-test-key");
    await route.fulfill({ json: { model: "jev-1.13.0", contentSignals: { method: "ai" } } });
  });
  await app.goto();
  await app.waitForReady();
  await page.locator("button").filter({ hasText: /settings/i }).first().click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const section = page.getByRole("region", { name: "Jev settings" });
  await section.getByLabel("jev API key").fill("jev-settings-test-key");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByPlaceholder("Key saved. Paste a replacement")).toBeVisible();
  expect(requests).toBe(0);
  await section.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(section.getByRole("status").filter({ hasText: "Paid Jev requests require Freed Desktop spending controls." })).toBeVisible();
  expect(requests).toBe(0);
  await expect(page.getByTestId("ai-provider-selector").getByRole("button", { name: /Off/ })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("jev-settings-test-key");
  await section.getByLabel("jev API key").fill("replacement-test-key");
  await section.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(section.getByLabel("jev API key")).toHaveValue("");
  await section.getByRole("button", { name: "Jev classification", exact: true }).click();
  await section.getByRole("tab", { name: "People I can help", exact: true }).click();
  await section.getByRole("button", { name: "Preview example matches", exact: true }).click();
  await expect(section.locator("[data-jev-opportunity-id]")).toHaveCount(4);
  await section.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(section.getByPlaceholder("Paste API key")).toBeVisible();
  await expect(section.getByText("Key not configured", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "Find matches with Jev", exact: true })).toBeDisabled();
  expect(requests).toBe(0);
  await section.getByLabel("jev API key").fill("reload-only-test-key");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByPlaceholder("Key saved. Paste a replacement")).toBeVisible();
  await page.reload();
  await app.waitForReady();
  await page.locator("button").filter({ hasText: /settings/i }).first().click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(section.getByPlaceholder("Paste API key")).toBeVisible();
  await section.getByRole("button", { name: "Jev classification", exact: true }).click();
  await expect(section.getByText("Key not configured", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("reload-only-test-key");
  expect(requests).toBe(0);
});
