import { describe, expect, it } from "vitest";
import {
  LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS,
} from "./operation-field-manifest.js";

describe("active operation field manifests", () => {
  it("keeps every executable manifest nonempty, sorted, unique, and scoped", () => {
    for (const [prefix, manifest] of [
      ["library-core-v1:preferences.", LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS],
      ["library-core-v1:rssFeeds.", LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS],
      ["library-core-v1:persons.", LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS],
      ["library-core-v1:accounts.", LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS],
      ["library-core-v1:feedItems.", LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS],
    ] as const) {
      expect(manifest.length).toBeGreaterThan(0);
      expect(new Set(manifest).size).toBe(manifest.length);
      expect([...manifest]).toStrictEqual([...manifest].sort());
      expect(manifest.every((key) => key.startsWith(prefix))).toBe(true);
    }
  });

  it("excludes device-local preference and graph coordinates", () => {
    expect(LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS).not.toContain(
      "library-core-v1:preferences.display.themeId",
    );
    for (const manifest of [
      LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS,
      LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS,
    ]) {
      expect(manifest.some((key) => key.endsWith(".graphX"))).toBe(false);
      expect(manifest.some((key) => key.endsWith(".graphY"))).toBe(false);
    }
  });
});
