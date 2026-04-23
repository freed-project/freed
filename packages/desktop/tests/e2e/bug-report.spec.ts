import { test, expect } from "./fixtures/app";

test("fatal runtime errors show the crash reporting screen", async ({ app, ipc }) => {
  await app.goto("/");
  await app.waitForReady();

  await app.page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(app.page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await expect(app.page.getByText("Export a crash report")).toBeVisible();
  await expect(app.page.getByText("Include screenshot of interface behind this bug report")).toHaveCount(0);
  await expect(app.page.getByRole("button", { name: "Download latest Freed Desktop" })).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Open GitHub issue" })).toBeVisible();

  await app.page.getByRole("button", { name: "Download latest Freed Desktop" }).click();
  await expect.poll(async () => (await ipc.openedUrls())[0]).toBe(
    "https://freed.wtf/api/downloads/mac-arm",
  );
});

test("fatal recovery still surfaces available app updates", async ({ app }) => {
  await app.page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "26.4.1801-dev",
      body: "Fix startup recovery dead end",
    };
  });

  await app.goto("/");
  await app.waitForReady();

  await app.page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(app.page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Download & Install" })).toBeVisible({
    timeout: 2_000,
  });
});

test("bug report export actions track private diagnostics", async ({ app, ipc }) => {
  await app.goto("/");
  await app.waitForReady();

  await app.page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(app.page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Download Public Safe Bundle" })).toBeVisible();
  await expect(
    app.page.getByRole("button", { name: "Download and open GitHub issue" }),
  ).toBeEnabled();

  await app.page.getByLabel("Private diagnostics").click();
  await expect(app.page.getByLabel("Expanded logs")).toBeChecked();
  await expect(app.page.getByLabel("Snapshot metadata")).toBeChecked();
  await expect(app.page.getByLabel("Expanded stack traces")).toBeChecked();
  await expect(app.page.getByRole("button", { name: "Download Private Bundle" })).toBeVisible();

  const githubIssueButton = app.page.getByRole("button", {
    name: "Download and open GitHub issue",
  });
  await expect(githubIssueButton).toBeDisabled();
  await githubIssueButton.locator("xpath=..").hover();
  await expect(app.page.getByText("Turn off private diagnostics first")).toBeVisible();
  await expect(
    app.page.getByText(
      "GitHub issues are public. Private bundles may expose local details, so email them instead.",
    ),
  ).toBeVisible();

  const [privateDownload] = await Promise.all([
    app.page.waitForEvent("download"),
    app.page.getByRole("button", { name: "Download and email" }).click(),
  ]);
  expect(privateDownload.suggestedFilename()).toContain("private");
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toContain(
    "mailto:support@freed.wtf?",
  );

  await app.page.getByLabel("Private diagnostics").click();
  await expect(app.page.getByLabel("Expanded logs")).not.toBeChecked();
  await expect(app.page.getByLabel("Snapshot metadata")).not.toBeChecked();
  await expect(app.page.getByLabel("Expanded stack traces")).not.toBeChecked();

  const [publicDownload] = await Promise.all([
    app.page.waitForEvent("download"),
    app.page.getByRole("button", { name: "Download Public Safe Bundle" }).click(),
  ]);
  expect(publicDownload.suggestedFilename()).toContain("public-safe");
});
