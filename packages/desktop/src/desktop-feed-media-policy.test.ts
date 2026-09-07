import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop feed media policy", () => {
  it("allows inline media only in explicit local feature previews", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(source).toContain('feedMediaPreviews: IS_FEATURE_PREVIEW ? "inline" : "reader-only"');
    expect(source).not.toContain('feedMediaPreviews: "inline"');
  });
});
