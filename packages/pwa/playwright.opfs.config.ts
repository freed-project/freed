import { defineConfig, devices } from "@playwright/test";
import {
  pwaOpfsE2eBaseUrl,
  pwaOpfsE2ePort,
} from "./tests/opfs-e2e-settings";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/sqlite-opfs-durability.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  workers: 1,
  reporter: "line",
  use: {
    ...devices["iPhone 14"],
    baseURL: pwaOpfsE2eBaseUrl,
    browserName: "webkit",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${pwaOpfsE2ePort.toLocaleString("en-US", {
      useGrouping: false,
    })}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: pwaOpfsE2eBaseUrl,
  },
});
