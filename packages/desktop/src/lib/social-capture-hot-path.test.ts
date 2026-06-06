import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fbSource = readFileSync(join(process.cwd(), "src/lib/fb-capture.ts"), "utf8");
const igSource = readFileSync(join(process.cwd(), "src/lib/instagram-capture.ts"), "utf8");

describe("social capture hot paths", () => {
  it("archives continuous media from the current sync batch only", () => {
    expect(fbSource).toContain(
      'archiveRecentProviderMedia(\n        "facebook",\n        filteredItems,',
    );
    expect(igSource).toContain(
      'archiveRecentProviderMedia(\n        "instagram",\n        result.items,',
    );
  });

  it("keeps local social sync stages timed for freeze diagnostics", () => {
    for (const source of [fbSource, igSource]) {
      expect(source).toContain("fetch finished duration=");
      expect(source).toContain("store write complete");
      expect(source).toContain("media vault complete");
      expect(source).toContain("formatSocialCaptureDuration");
    }
  });
});
