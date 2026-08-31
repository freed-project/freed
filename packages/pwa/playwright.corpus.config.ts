import { defineConfig } from "@playwright/test";
import {
  pwaCorpusHardeningBaseUrl,
  pwaCorpusHardeningBrowser,
  pwaCorpusHardeningPort,
} from "./tests/corpus-hardening-e2e-settings";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/sqlite-opfs-corpus-hardening.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 3_600_000,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: pwaCorpusHardeningBaseUrl,
    browserName: pwaCorpusHardeningBrowser,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `FREED_PWA_CORPUS_HARDENING=1 npm run dev -- --force --host 127.0.0.1 --port ${pwaCorpusHardeningPort.toLocaleString(
      "en-US",
      {
        useGrouping: false,
      },
    )}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: pwaCorpusHardeningBaseUrl,
  },
});
