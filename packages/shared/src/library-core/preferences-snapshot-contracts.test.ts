import { describe, expect, it } from "vitest";
import {
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
} from "./preferences-snapshot-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

function row(valueType: string, value: unknown) {
  return {
    booleanValue: valueType === "boolean" ? value : null,
    integerValue: valueType === "integer" ? value : null,
    path: `display.${valueType}`,
    realValue: valueType === "real" ? value : null,
    textValue: valueType === "text" ? value : null,
    updatedAt: 10,
    valueType,
  };
}

describe("preferences snapshot contracts", () => {
  it("accepts the closed request and every normalized scalar kind", () => {
    expect(
      parseLibraryCorePreferencesSnapshotRequestV1({
        queryId: "preferences_snapshot_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
    expect(
      parseLibraryCorePreferencesSnapshotResponseV1({
        queryId: "preferences_snapshot_v1",
        rows: [
          row("boolean", true),
          row("integer", 3),
          row("null", null),
          row("real", 0.5),
          row("text", "neon"),
        ],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(true);
  });

  it("rejects extra keys, mismatched value columns, and nonbinary order", () => {
    expect(
      parseLibraryCorePreferencesSnapshotRequestV1({
        queryId: "preferences_snapshot_v1",
        schemaVersion: 1,
        surprise: true,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePreferencesSnapshotResponseV1({
        queryId: "preferences_snapshot_v1",
        rows: [{ ...row("boolean", true), textValue: "also populated" }],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePreferencesSnapshotResponseV1({
        queryId: "preferences_snapshot_v1",
        rows: [
          { ...row("text", "first"), path: "😀" },
          { ...row("text", "second"), path: "\ue000" },
        ],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(false);
  });
});
