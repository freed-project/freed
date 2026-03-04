import { defineConfig, devices } from "@playwright/test";

// Allow pointing at a deployed preview URL for CI / manual smoke runs.
// Usage: BASE_URL=https://freed-xxx.vercel.app npx playwright test
const BASE_URL = process.env.BASE_URL ?? "http://localhost:1421";
const USE_LOCAL_SERVER = !process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Desktop smoke tests (existing)
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/safari-viewport.spec.ts",
    },

    // Safari viewport / address-bar tests — WebKit engine, iPhone 14 dimensions.
    // This is the closest we can get to real iPhone Safari without a real device.
    // dvh/lvh CSS units, overflow:visible scroll, and sticky headers all behave
    // identically to iOS Safari in WebKit. The address-bar collapse animation
    // itself requires a real device; everything else is testable here.
    {
      name: "webkit-iphone",
      use: {
        ...devices["iPhone 14"],
        browserName: "webkit",
      },
      testMatch: "**/safari-viewport.spec.ts",
    },
  ],

  webServer: USE_LOCAL_SERVER
    ? {
        command: "npm run dev -- --port 1421",
        url: "http://localhost:1421",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      }
    : undefined,
});
