import { expect, test } from "@playwright/test";

for (const legacyPath of ["/updates", "/updates/why-freed-exists"]) {
  test(`${legacyPath} redirects to the current changelog`, async ({ page }) => {
    const redirectResponse = await page.request.get(legacyPath, {
      maxRedirects: 0,
    });
    const location = redirectResponse.headers().location;
    expect(redirectResponse.status()).toBe(307);
    expect(location).toBeDefined();
    expect(new URL(location!, "http://freed.local").pathname).toBe("/changelog");

    const response = await page.goto(legacyPath);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/changelog$/);
    await expect(page.getByRole("heading", { name: "Updates", exact: true })).toBeVisible();
  });
}

test("internal updates links point directly to the changelog", async ({ page }) => {
  await page.goto("/vision");
  await expect(
    page.getByRole("link", { name: "Active development", exact: true }),
  ).toHaveAttribute("href", "/changelog");

  await page.goto("/privacy");
  await expect(
    page.getByRole("link", { name: "Updates", exact: true }).first(),
  ).toHaveAttribute("href", "/changelog");
});
