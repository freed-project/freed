import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop feed media policy", () => {
  it("keeps remote feed media previews reader-only", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(source).toContain('feedMediaPreviews: "reader-only"');
    expect(source).not.toContain('feedMediaPreviews: "inline"');
  });
});
