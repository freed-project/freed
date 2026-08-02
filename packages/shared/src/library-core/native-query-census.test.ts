import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LIBRARY_CORE_QUERY_IDS } from "./query-registry.js";

/**
 * The Gate A census claims to be an exhaustive inventory of Library Core
 * queries, and activation is gated on it. Nothing enforced that claim against
 * the native reader, so three shipping queries were absent from it at once:
 * `background_item_page_v1` (the bounded scan behind every corpus reader),
 * `library_facet_summary_v1`, and `library_surface_items_v1`.
 *
 * This asserts the census against the Rust sources by string literal rather
 * than by import, the same way the provider-visible path list and the roadmap
 * status file are validated. A native query the census does not know about is
 * a census defect, not a missing feature.
 */
const NATIVE_SOURCE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "desktop",
  "src-tauri",
  "src",
);

const QUERY_ID_CONSTANT =
  /const\s+[A-Z0-9_]*QUERY_ID\s*:\s*&str\s*=\s*"([a-z0-9_]+)"/g;

function nativeQueryIds(): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(NATIVE_SOURCE_DIRECTORY)) {
    if (!entry.endsWith(".rs")) continue;
    const source = readFileSync(join(NATIVE_SOURCE_DIRECTORY, entry), "utf8");
    for (const match of source.matchAll(QUERY_ID_CONSTANT)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

describe("Library Core native query census", () => {
  it("finds the native query identity constants it is meant to police", () => {
    // Guards the regex itself. If this drops to zero the suite would pass
    // vacuously while enforcing nothing.
    const ids = nativeQueryIds();
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids).toContain("feed_page_v1");
  });

  it("registers every query identity the native reader ships", () => {
    const registered = new Set<string>(LIBRARY_CORE_QUERY_IDS);
    const unregistered = nativeQueryIds().filter((id) => !registered.has(id));
    expect(
      unregistered,
      `Native reader ships query identities the Gate A census does not list: ${unregistered.join(", ")}. ` +
        "Register them in LIBRARY_CORE_QUERY_IDS with their traced bounds. " +
        "The census gates activation, so an unlisted live query makes it untrue.",
    ).toEqual([]);
  });
});
