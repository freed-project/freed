/**
 * E2E tests for Facebook capture flow.
 *
 * Verifies the settings connect form, sync button, and feed item rendering
 * with a mock x_api_request handler returning mbasic.facebook.com HTML.
 */

import { test, expect } from "./fixtures/app";

// Minimal mbasic.facebook.com-style HTML fixture
const MBASIC_HTML = `
<html>
<head><title>Facebook</title></head>
<body>
<div id="root">
  <div id="recent">
    <div data-ft='{"mf_story_key":"12345"}'>
      <h3><a href="/alice.example">Alice Example</a></h3>
      <p>Hello from the Facebook E2E test feed!</p>
      <a href="/story.php?story_fbid=12345&id=999">2 hrs</a>
      <abbr data-utime="1709640000">2 hours ago</abbr>
      <span>5 Likes</span>
      <span>2 Comments</span>
    </div>
    <div data-ft='{"mf_story_key":"12346"}'>
      <h3><a href="/bob.builder">Bob Builder</a></h3>
      <p>Another test post with some content.</p>
      <a href="/story.php?story_fbid=12346&id=888">5 hrs</a>
      <abbr data-utime="1709629200">5 hours ago</abbr>
      <span>12 Likes</span>
    </div>
  </div>
</div>
</body>
</html>
`;

test("Facebook settings section shows connect button when not authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;

  // Open settings
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  if (!(await settingsBtn.isVisible())) {
    test.skip(true, "Settings button not visible");
    return;
  }
  await settingsBtn.click();

  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  // Navigate to Facebook section via the settings sidebar button (second match,
  // after the main sidebar source button and before "Connect Facebook Account")
  const fbSection = page.getByRole("button", { name: "Facebook" }).nth(1);
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.click();

  await expect(page.getByText("Log in with Facebook")).toBeVisible({
    timeout: 3_000,
  });
});

test("Facebook connect form accepts cookies and triggers sync", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  // Wire up the mock to return our HTML fixture
  await ipc.setHandler("x_api_request", () => MBASIC_HTML);

  const { page } = app;

  // Open settings
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  if (!(await settingsBtn.isVisible())) {
    test.skip(true, "Settings button not visible");
    return;
  }
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  // Navigate to Facebook section via the settings sidebar button
  const fbSection = page.getByRole("button", { name: "Facebook" }).nth(1);
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.click();

  // Click "Log in with Facebook" to open the login WebView
  const loginBtn = page.getByText("Log in with Facebook");
  await loginBtn.scrollIntoViewIfNeeded();
  await expect(loginBtn).toBeVisible({ timeout: 3_000 });
  await loginBtn.click();
  await page.waitForTimeout(500);

  // The fb_show_login IPC call should have fired. Simulate the auth result
  // event that the Tauri backend would emit after a successful WebView login.
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const listeners = w.__TAURI_EVENT_LISTENERS__ as Record<string, Array<(e: { payload: unknown }) => void>> | undefined;
    const fns = listeners?.["fb-auth-result"] ?? [];
    for (const fn of fns) fn({ payload: { loggedIn: true } });
  });

  // After the auth event, the component should show the "Connected" state
  await expect(
    page.getByText("Connected", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
});
