import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LIBRARY_CORE_FIELD_REGISTRY } from "./field-registry.js";
import { FEED_ITEM_READ_ASSIGNMENT_MATERIALIZER } from "./operation-materializer-contracts.js";
import { LIBRARY_CORE_OPERATION_REGISTRY } from "./operation-registry.js";

/**
 * Holds each declared materializer to the native code that implements it.
 *
 * A materializer contract is a description. The implementation is Rust, inside
 * the journal commit, and TypeScript exhaustiveness cannot cross that boundary.
 * Without this test the registry could claim an operation is materialized while
 * the table it names does not exist, or exists and is written by nobody.
 *
 * Same shape as the query census binding: read the source, assert the claim,
 * and guard the extraction so a broken read fails loudly rather than passing
 * vacuously.
 */

const repositoryRoot = join(import.meta.dirname, "..", "..", "..", "..");

const readNativeModule = (relativePath: string): string => {
  const source = readFileSync(join(repositoryRoot, relativePath), "utf8");
  // Guard the guard. A path that resolved to something tiny or missing would
  // make every `toContain` below trivially suspicious.
  expect(source.length).toBeGreaterThan(10_000);
  return source;
};

const DECLARED_MATERIALIZERS = Object.values(LIBRARY_CORE_OPERATION_REGISTRY)
  .map((definition) => definition.materializer)
  .filter((materializer) => materializer !== null);

describe("declared materializers are bound to native implementations", () => {
  it("has at least one materializer to check", () => {
    // Otherwise every assertion below is vacuous.
    expect(DECLARED_MATERIALIZERS.length).toBeGreaterThan(0);
  });

  it.each(DECLARED_MATERIALIZERS)(
    "$materializerId writes $targetTable in its named module",
    (materializer) => {
      const source = readNativeModule(materializer.nativeModulePath);

      // The table it claims to write must be written there.
      expect(source).toContain(`INSERT INTO ${materializer.targetTable}`);
      // Upserting on the declared column is what makes the operation
      // idempotent under replay, so the conflict target is part of the claim.
      expect(source).toContain(`ON CONFLICT(${materializer.conflictColumn})`);
      // And the operation type must be the one the native commit records.
      expect(source).toContain(materializer.operationType);
    },
  );

  it.each(DECLARED_MATERIALIZERS)(
    "$materializerId names a merge algebra that the field registry knows",
    (materializer) => {
      // The upsert and the field algebra must be the same rule. If a
      // materializer named an algebra nothing declares, the two could diverge
      // and a replayed operation would converge differently from a merged one.
      const known = LIBRARY_CORE_FIELD_REGISTRY.some(
        (entry) => entry.mergeAlgebra === materializer.mergeAlgebraId,
      );
      expect({ algebra: materializer.mergeAlgebraId, known }).toStrictEqual({
        algebra: materializer.mergeAlgebraId,
        known: true,
      });
    },
  );

  it("declares the target table in the authoritative schema", () => {
    // A materializer writing a table the schema never creates would fail only
    // at runtime, on the machine that ran the migration.
    const schema = readFileSync(
      join(repositoryRoot, "packages/shared/src/library-core/authoritative-schema-v1.sql"),
      "utf8",
    );
    expect(schema.length).toBeGreaterThan(1_000);
    for (const materializer of DECLARED_MATERIALIZERS) {
      expect(schema).toContain(`CREATE TABLE ${materializer.targetTable}`);
    }
  });

  it("keeps the read assignment materializer pinned to its traced values", () => {
    // The first materializer, spelled out so a silent retarget is visible in a
    // diff rather than only in a failing string match.
    expect(FEED_ITEM_READ_ASSIGNMENT_MATERIALIZER).toStrictEqual({
      materializerId: "feed_item_read_state_v1",
      schemaVersion: 1,
      operationType: "feed_item_read_assignment",
      targetTable: "library_core_feed_item_read_state",
      conflictColumn: "entityId",
      mergeAlgebraId: "minimum_present_nonnegative_safe_integer_v1",
      nativeModulePath:
        "packages/desktop/src-tauri/src/library_core_journal.rs",
    });
  });
});
