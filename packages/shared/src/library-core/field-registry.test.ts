import { describe, expect, it } from "vitest";
import type {
  LibraryCoreActivationBlocker,
  LibraryCoreFieldRegistryEntry,
} from "./protocol-registry.js";
import {
  LIBRARY_CORE_FIELD_REGISTRY,
  LIBRARY_CORE_ROOT_REGISTRY,
} from "./field-registry.js";
import { DESKTOP_CLIENT_KEY_PREFIX } from "../schema.js";

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const entryAt = (path: string): LibraryCoreFieldRegistryEntry => {
  const entry = LIBRARY_CORE_FIELD_REGISTRY.find(
    (candidate) => candidate.path.text === path,
  );
  expect(entry, `missing registry entry ${path}`).toBeDefined();
  return entry!;
};

describe("Library Core legacy field census", () => {
  it("has exact, unique, machine-ordered root coverage and blocks every cutover", () => {
    const expectedRoots = [
      "<unknown-root>",
      "accounts",
      "desktopClient:*",
      "feedItems",
      "friends",
      "meta",
      "persons",
      "preferences",
      "rssFeeds",
    ].sort(compareCodeUnits);
    const roots = LIBRARY_CORE_ROOT_REGISTRY.map((entry) => entry.root);
    const keys = LIBRARY_CORE_ROOT_REGISTRY.map((entry) => entry.registryKey);

    expect(roots).toEqual(expectedRoots);
    expect(new Set(roots).size).toBe(roots.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort(compareCodeUnits));
    expect(
      LIBRARY_CORE_ROOT_REGISTRY.every(
        (entry) =>
          entry.cutover === "blocked" &&
          entry.plannedLocality === null &&
          entry.plannedAuthority === null &&
          entry.blockers.includes("planned_locality_undecided") &&
          entry.blockers.includes("planned_authority_undecided"),
      ),
    ).toBe(true);
  });

  it("has unique field keys in deterministic UTF-16 code-unit order", () => {
    const keys = LIBRARY_CORE_FIELD_REGISTRY.map((entry) => entry.registryKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort(compareCodeUnits));
  });

  it("keeps current legacy authority separate from unresolved planned authority", () => {
    const feedRoot = LIBRARY_CORE_ROOT_REGISTRY.find(
      (entry) => entry.root === "feedItems",
    );
    const friendRoot = LIBRARY_CORE_ROOT_REGISTRY.find(
      (entry) => entry.root === "friends",
    );

    expect(feedRoot).toMatchObject({
      currentLocality: "legacy-synchronized",
      currentAuthority: "legacy-automerge-document",
      plannedLocality: null,
      plannedAuthority: null,
      cutover: "blocked",
    });
    expect(friendRoot).toMatchObject({
      entity: "LegacyFriend",
      kind: "legacy-root",
      currentLocality: "legacy-compatibility",
      currentAuthority: "legacy-automerge-read-only",
      plannedLocality: null,
      plannedAuthority: null,
      cutover: "blocked",
    });

    expect(entryAt("feedItems.{globalId}.content.text")).toMatchObject({
      currentLocality: "legacy-synchronized",
      currentAuthority: "legacy-automerge-document",
      plannedLocality: null,
      plannedAuthority: null,
      storageTier: null,
      deleteBehavior: null,
    });
    expect(entryAt("feedItems.{globalId}.priority")).toMatchObject({
      currentLocality: "legacy-derived",
      currentAuthority: "derived-runtime",
      plannedLocality: null,
      plannedAuthority: null,
    });
  });

  it("covers the retained LegacyFriend shape without current Person-only fields", () => {
    expect(entryAt("friends.{friendId}.sources[].platform")).toMatchObject({
      entity: "LegacyFriend",
      currentLocality: "legacy-compatibility",
      currentAuthority: "legacy-automerge-read-only",
    });
    expect(entryAt("friends.{friendId}.contact.email")).toMatchObject({
      entity: "LegacyFriend",
      localPresence: "optional",
      ancestorOptional: true,
    });
    expect(
      LIBRARY_CORE_FIELD_REGISTRY.some(
        (entry) =>
          entry.path.text === "friends.{friendId}.relationshipStatus" ||
          entry.path.text === "friends.{friendId}.graphX" ||
          entry.path.text === "friends.{friendId}.sampleDataFingerprint.marker",
      ),
    ).toBe(false);
  });

  it("keeps one recursive legacy-Automerge fallback per retained root", () => {
    const fallbacks = LIBRARY_CORE_FIELD_REGISTRY.filter((entry) =>
      entry.path.segments.some(
        (segment) => segment.kind === "unregistered-descendant",
      ),
    );
    expect(fallbacks).toHaveLength(8);
    expect(
      fallbacks.every((entry) =>
        entry.path.segments.some(
          (segment) =>
            segment.kind === "unregistered-descendant" &&
            segment.recursive === true,
        ),
      ),
    ).toBe(true);
    expect(
      fallbacks.every(
        (entry) =>
          entry.currentLocality === "legacy-compatibility" &&
          entry.currentAuthority === "legacy-automerge-read-only" &&
          entry.opaqueRetention === null &&
          entry.activation.blockers.includes(
            "opaque_retention_unimplemented",
          ) &&
          entry.activation.blockers.includes(
            "unregistered_descendant_requires_classification",
          ),
      ),
    ).toBe(true);
  });

  it("models arrays, maps, dynamic roots, and immediate presence without ancestor collapse", () => {
    const pathSegmentKinds = new Set(
      LIBRARY_CORE_FIELD_REGISTRY.flatMap((entry) =>
        entry.path.segments.map((segment) => segment.kind),
      ),
    );
    expect(pathSegmentKinds).toEqual(
      new Set([
        "array-element",
        "dynamic-map-key",
        "dynamic-root-key",
        "entity-key",
        "fixed-map-key",
        "property",
        "unknown-root",
        "unregistered-descendant",
      ]),
    );

    expect(
      entryAt("feedItems.{globalId}.contentSignals.version"),
    ).toMatchObject({
      localPresence: "required",
      ancestorOptional: true,
    });
    const scoreEntry = LIBRARY_CORE_FIELD_REGISTRY.find((entry) =>
      entry.path.text.includes("contentSignals.scores"),
    );
    expect(scoreEntry).toMatchObject({
      localPresence: "optional",
      ancestorOptional: true,
      path: {
        segments: expect.arrayContaining([
          expect.objectContaining({
            kind: "fixed-map-key",
            name: "contentSignal",
          }),
        ]),
      },
    });
    expect(
      entryAt("feedItems.{globalId}.userState.highlights[].text"),
    ).toMatchObject({
      localPresence: "required",
      ancestorOptional: true,
    });

    const desktopRoot = LIBRARY_CORE_ROOT_REGISTRY.find(
      (entry) => entry.root === "desktopClient:*",
    );
    expect(desktopRoot?.path.segments[0]).toEqual({
      kind: "dynamic-root-key",
      prefix: DESKTOP_CLIENT_KEY_PREFIX,
      name: "installationId",
    });
  });

  it("does not invent protocol codecs, ranges, or closed string values", () => {
    const numberEntries = LIBRARY_CORE_FIELD_REGISTRY.filter(
      (entry) => entry.legacyValueShape === "typescript-number",
    );

    expect(numberEntries.length).toBeGreaterThan(0);
    expect(
      numberEntries.every(
        (entry) =>
          entry.valueCodec === null &&
          entry.numericRange === null &&
          entry.activation.blockers.includes("protocol_codec_undecided") &&
          entry.activation.blockers.includes("field_range_undecided"),
      ),
    ).toBe(true);
    expect(
      LIBRARY_CORE_FIELD_REGISTRY.some(
        (entry) => (entry.valueCodec as string | null) === "finite-number",
      ),
    ).toBe(false);

    const stringEntries = LIBRARY_CORE_FIELD_REGISTRY.filter(
      (entry) => entry.legacyValueShape === "typescript-string",
    );
    expect(stringEntries.length).toBeGreaterThan(0);
    expect(
      stringEntries.every(
        (entry) =>
          entry.valueCodec === null &&
          entry.allowedValues === null &&
          entry.activation.blockers.includes("protocol_codec_undecided") &&
          entry.activation.blockers.includes("allowed_values_undecided"),
      ),
    ).toBe(true);
  });

  it("pairs every null future decision with its specific blocker", () => {
    const blockerByField = {
      executableValidation: "executable_validation_undecided",
      plannedLocality: "planned_locality_undecided",
      plannedAuthority: "planned_authority_undecided",
      storageTier: "storage_tier_undecided",
      allowedOperationTypes: "allowed_operations_undecided",
      mergeAlgebra: "merge_algebra_undecided",
      omissionSemantics: "omission_semantics_undecided",
      explicitClear: "explicit_clear_undecided",
      deleteBehavior: "delete_behavior_undecided",
      restoreSemantics: "restore_semantics_undecided",
      relationshipCascade: "relationship_cascade_undecided",
      migrationRule: "legacy_migration_rule_undecided",
      backupBehavior: "backup_behavior_undecided",
      exportBehavior: "export_behavior_undecided",
      redactionBehavior: "redaction_behavior_undecided",
      provenanceBehavior: "provenance_behavior_undecided",
      materializedProjection: "materialized_projection_undecided",
      queryEligible: "query_eligibility_undecided",
    } as const satisfies Partial<
      Record<keyof LibraryCoreFieldRegistryEntry, LibraryCoreActivationBlocker>
    >;

    for (const entry of LIBRARY_CORE_FIELD_REGISTRY) {
      expect(entry.activation.status).toBe("blocked");
      expect(entry.activation.blockers).toEqual(
        [...entry.activation.blockers].sort(compareCodeUnits),
      );
      for (const [field, blocker] of Object.entries(blockerByField)) {
        if (entry[field as keyof LibraryCoreFieldRegistryEntry] === null) {
          expect(
            entry.activation.blockers,
            `${entry.registryKey} lacks ${blocker}`,
          ).toContain(blocker);
        }
      }
      if (entry.localPresence === null || entry.ancestorOptional === null) {
        expect(entry.activation.blockers).toContain(
          "presence_semantics_undecided",
        );
      }
      if (entry.valueCodec === null) {
        expect(entry.activation.blockers).toContain("protocol_codec_undecided");
      }
      if (entry.allowedValues === null) {
        expect(entry.activation.blockers).toContain("allowed_values_undecided");
      }
      if (entry.numericRange === null) {
        expect(entry.activation.blockers).toContain("field_range_undecided");
      }
    }
  });
});
