import { defineConfig, devices } from "@playwright/test";
import { createHash } from "node:crypto";
import { findFreePort } from "../../scripts/lib/find-free-port.mjs";

const USE_LOCAL_SERVER = !process.env.BASE_URL;
const DEFAULT_PORT = 1422;
const WORKTREE_PORT_SPAN = 20_000;
const configuredPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "", 10);
const worktreePortOffset = createHash("sha1").update(process.cwd()).digest().readUInt16BE(0) % WORKTREE_PORT_SPAN;
const hasConfiguredPort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535;
const defaultPort = hasConfiguredPort
  ? configuredPort
  : await findFreePort(DEFAULT_PORT + worktreePortOffset);
if (!hasConfiguredPort) {
  process.env.PLAYWRIGHT_PORT = String(defaultPort);
}
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${String(defaultPort)}`;
const configuredPerfPort = Number.parseInt(process.env.PLAYWRIGHT_PERF_PORT ?? "", 10);
const perfPort = Number.isInteger(configuredPerfPort) && configuredPerfPort > 0 && configuredPerfPort <= 65_535
  ? configuredPerfPort
  : await findFreePort(defaultPort + 1);
process.env.PLAYWRIGHT_PERF_PORT = String(perfPort);
const PERF_BASE_URL = process.env.PERF_BASE_URL ?? (USE_LOCAL_SERVER
  ? `http://127.0.0.1:${String(perfPort)}`
  : BASE_URL);
const FEED_SCROLL_TIMING_TESTS = /perf-feed\.spec\.ts.*(?:Scroll performance|frame delivery during fast scroll)/;

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
      grepInvert: FEED_SCROLL_TIMING_TESTS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-feed-perf",
      testMatch: "**/perf-feed.spec.ts",
      grep: FEED_SCROLL_TIMING_TESTS,
      use: { ...devices["Desktop Chrome"], baseURL: PERF_BASE_URL },
    },
  ],

  webServer: USE_LOCAL_SERVER
    ? [{
        command: `${process.execPath} ../../node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1 --port ${String(defaultPort)} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          VITE_TEST_TAURI: "1",
          NODE_ENV: "development",
        },
      }, {
        command: `${process.execPath} ../../node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1 --port ${String(perfPort)} --strictPort`,
        url: PERF_BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          VITE_TEST_TAURI: "1",
          NODE_ENV: "production",
          FREED_E2E_PERF: "1",
        },
      }]
    : undefined,
});
