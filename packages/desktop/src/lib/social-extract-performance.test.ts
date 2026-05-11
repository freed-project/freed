import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("social feed extraction performance guards", () => {
  it("does not force layout by reading innerText in feed extractors", () => {
    const scripts = ["fb-extract.js", "ig-extract.js", "li-extract.js"];

    for (const script of scripts) {
      const source = readFileSync(join(process.cwd(), "src-tauri/src", script), "utf8");
      expect(source).not.toContain("innerText");
    }
  });
});
