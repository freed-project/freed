import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

async function setDocumentVisibility(
  page: Page,
  visibilityState: "hidden" | "visible",
) {
  await page.evaluate((nextVisibilityState) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => nextVisibilityState,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => nextVisibilityState === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
}

test("background atmosphere releases renderer layers while document is hidden", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const atmosphere = app.page.getByTestId("background-atmosphere");
  await expect(atmosphere).toBeVisible();

  await setDocumentVisibility(app.page, "hidden");
  await expect(atmosphere).toHaveCount(0);

  await setDocumentVisibility(app.page, "visible");
  await expect(atmosphere).toBeVisible();
});
