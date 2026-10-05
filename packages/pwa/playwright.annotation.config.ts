import { defineConfig } from "@playwright/test";

// Isolated synthetic Library. No app bootstrap, provider requests or live data.
export default defineConfig({
  testDir: "./tests",
  testMatch: "annotation-opfs-restart.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:1435", headless: true },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1435 --strictPort",
    url: "http://127.0.0.1:1435",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
