import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop feed media policy", () => {
  it("allows inline sample media only in explicit local feature previews", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(source).toContain('feedMediaPreviews: "reader-only"');
    expect(source).toContain('sampleMediaPreviews: IS_FEATURE_PREVIEW ? "inline" : undefined');
    expect(source).not.toContain('feedMediaPreviews: "inline"');
  });
});
