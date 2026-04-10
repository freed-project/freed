import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1422";
const USE_LOCAL_SERVER = !process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // perf tests need exclusive CPU access
  forbidOnly: !!process.env.CI,
  retries: 0, // no retries on benchmarks — flakiness is data
  workers: 1,
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["list"],
    ["./tests/e2e/reporters/perf-reporter.ts"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: USE_LOCAL_SERVER
    ? {
        command: "VITE_TEST_TAURI=1 npm run dev -- --port 1422",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          VITE_TEST_TAURI: "1",
        },
      }
    : undefined,
});
