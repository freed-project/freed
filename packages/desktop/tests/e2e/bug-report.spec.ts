import { test, expect } from "./fixtures/app";

test("fatal runtime errors show the crash reporting screen", async ({ app }) => {
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
  await expect(app.page.getByRole("button", { name: "Open GitHub issue" })).toBeVisible();
});
