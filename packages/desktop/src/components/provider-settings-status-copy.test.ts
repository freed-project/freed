import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentDir = join(process.cwd(), "src/components");
const socialSettingsSources = [
  "FacebookSettingsSection.tsx",
  "InstagramSettingsSection.tsx",
  "LinkedInSettingsSection.tsx",
  "XSettingsSection.tsx",
].map((file) => readFileSync(join(componentDir, file), "utf8"));

describe("provider settings status copy", () => {
  it("suppresses health messages when a primary sync error is visible", () => {
    for (const source of socialSettingsSources) {
      expect(source).toContain("<ProviderHealthSectionSummary");
      expect(source).toContain('showMessages={surface === "debug-card" && !syncError && !actionError}');
    }
  });
});
