import { test, expect } from "@playwright/test";

test("debug: check page content", async ({ page }) => {
  // Capture console messages
  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    consoleLogs.push(`${msg.type()}: ${msg.text()}`);
  });

  // Capture page errors
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await page.goto("/");

  // Wait for possible content
  await page.waitForTimeout(3000);

  // Get page content
  const html = await page.content();
  console.log("Page HTML:", html.substring(0, 2000));

  // Get visible text
  const bodyText = await page.locator("body").textContent();
  console.log("Body text:", bodyText);

  // Log console messages
  console.log("Console logs:", consoleLogs);
  console.log("Page errors:", pageErrors);

  // Check if root div has content
  const rootContent = await page.locator("#root").innerHTML();
  console.log("Root content:", rootContent.substring(0, 500));

  // Take screenshot
  await page.screenshot({ path: "debug-screenshot.png", fullPage: true });

  // Expect something to render
  expect(rootContent.length).toBeGreaterThan(0);
});
