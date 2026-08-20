import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIBRARY_CORE_FIELD_REGISTRY } from "./field-registry.js";
import {
  LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS,
  LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS,
} from "./operation-field-manifest.js";

const synchronizedLegacyKeys = (prefix: string): readonly string[] =>
  LIBRARY_CORE_FIELD_REGISTRY.filter(
    (entry) =>
      entry.registryKey.startsWith(prefix) &&
      entry.currentLocality === "legacy-synchronized",
  ).map((entry) => entry.registryKey);

describe("active operation field manifests", () => {
  it("remain byte-for-byte compatible with the historical synchronized census", () => {
    for (const [prefix, manifest] of [
      [
        "library-core-v1:preferences.",
        LIBRARY_CORE_PREFERENCE_OPERATION_FIELD_KEYS,
      ],
      ["library-core-v1:rssFeeds.", LIBRARY_CORE_RSS_FEED_OPERATION_FIELD_KEYS],
      ["library-core-v1:persons.", LIBRARY_CORE_PERSON_OPERATION_FIELD_KEYS],
      ["library-core-v1:accounts.", LIBRARY_CORE_ACCOUNT_OPERATION_FIELD_KEYS],
      [
        "library-core-v1:feedItems.",
        LIBRARY_CORE_FEED_ITEM_OPERATION_FIELD_KEYS,
      ],
    ] as const) {
      expect(manifest).toStrictEqual(synchronizedLegacyKeys(prefix));
    }
  });

  it("keeps the retired field registry out of the production operation graph", () => {
    const touchedFieldsSource = readFileSync(
      fileURLToPath(new URL("./operation-touched-fields.ts", import.meta.url)),
      "utf8",
    );
    const manifestSource = readFileSync(
      fileURLToPath(new URL("./operation-field-manifest.ts", import.meta.url)),
      "utf8",
    );

    expect(touchedFieldsSource).not.toMatch(
      /from ["']\.\/field-registry\.js["']/,
    );
    expect(manifestSource).not.toMatch(/legacy-automerge-document/);
    expect(manifestSource).not.toMatch(/currentLocality/);
  });
});
