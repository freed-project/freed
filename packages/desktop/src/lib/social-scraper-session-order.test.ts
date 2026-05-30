import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const rustSource = readFileSync(resolve(testDir, "../../src-tauri/src/lib.rs"), "utf8");

function functionBody(functionName: string): string {
  const start = rustSource.indexOf(`async fn ${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextCommand = rustSource.indexOf("\n#[tauri::command]", start + 1);
  expect(nextCommand).toBeGreaterThan(start);
  return rustSource.slice(start, nextCommand);
}

describe("social scraper session backpressure", () => {
  it("runs memory gates before acquiring the shared scraper session", () => {
    const guardedCommands = [
      "fb_check_auth",
      "fb_scrape_feed",
      "fb_scrape_groups",
      "ig_check_auth",
      "ig_scrape_feed",
      "fb_visit_url",
      "ig_visit_url",
      "fb_like_post",
      "ig_like_post",
      "li_check_auth",
      "li_scrape_feed",
      "check_essay_provider_auth",
      "scrape_essay_provider",
    ];

    for (const command of guardedCommands) {
      const body = functionBody(command);
      const memoryGateIndex = body.indexOf("ensure_social_scrape_memory(");
      const sessionIndex = body.indexOf("acquire_background_scraper_session(");

      expect(memoryGateIndex, `${command} should check memory`).toBeGreaterThanOrEqual(0);
      expect(sessionIndex, `${command} should acquire a scraper session`).toBeGreaterThanOrEqual(0);
      expect(memoryGateIndex, `${command} should not hold the scraper slot while memory cleanup runs`).toBeLessThan(
        sessionIndex,
      );
    }
  });
});
