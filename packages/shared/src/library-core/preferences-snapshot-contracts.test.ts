import { describe, expect, it } from "vitest";
import {
  libraryCorePreferenceNodesToValueV1,
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
  type LibraryCorePreferenceNodeV1,
  type LibraryCorePreferenceValueType,
} from "./preferences-snapshot-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

function row(
  valueType: LibraryCorePreferenceValueType,
  value: boolean | number | string | null,
): LibraryCorePreferenceNodeV1 {
  return {
    booleanValue: valueType === "boolean" ? (value as boolean) : null,
    integerValue: valueType === "integer" ? (value as number) : null,
    path: `v:$.display.${valueType}`,
    realValue: valueType === "real" ? (value as number) : null,
    textValue: valueType === "text" ? (value as string) : null,
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
          { ...row("integer", 0), path: "a:$.storyWall.hiddenItemIds" },
          { ...row("null", null), path: "o:$.weights.topics" },
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
        rows: [{ ...row("text", "not a count"), path: "a:$.bad" }],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePreferencesSnapshotResponseV1({
        queryId: "preferences_snapshot_v1",
        rows: [
          { ...row("text", "first"), path: 'v:$."😀"' },
          { ...row("text", "second"), path: 'v:$."\ue000"' },
        ],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePreferencesSnapshotResponseV1({
        queryId: "preferences_snapshot_v1",
        rows: [
          {
            ...row("integer", 513),
            path: "a:$.storyWall.hiddenItemIds",
          },
        ],
        schemaVersion: 1,
        source,
      }).ok,
    ).toBe(false);
  });

  it("reassembles bounded objects, arrays, and quoted keys without prototypes", () => {
    const value = libraryCorePreferenceNodesToValueV1([
      { ...row("integer", 1), path: "a:$.storyWall.hiddenItemIds" },
      { ...row("null", null), path: "o:$.display" },
      { ...row("null", null), path: "o:$.display.reading" },
      { ...row("null", null), path: "o:$.storyWall" },
      { ...row("null", null), path: 'o:$."weights.with.dot"' },
      { ...row("boolean", true), path: "v:$.display.reading.focusMode" },
      { ...row("text", "neon"), path: "v:$.display.themeId" },
      { ...row("text", "item-1"), path: "v:$.storyWall.hiddenItemIds[0]" },
      { ...row("integer", 42), path: 'v:$."weights.with.dot"."__proto__"' },
    ]);

    expect(value).toEqual({
      display: { reading: { focusMode: true }, themeId: "neon" },
      storyWall: { hiddenItemIds: ["item-1"] },
      "weights.with.dot": { ["__proto__"]: 42 },
    });
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.getPrototypeOf(value["weights.with.dot"])).toBeNull();
  });

  it("rejects conflicting node kinds for one logical path", () => {
    expect(() =>
      libraryCorePreferenceNodesToValueV1([
        { ...row("null", null), path: "o:$.display" },
        { ...row("text", "bad"), path: "v:$.display" },
      ]),
    ).toThrow("one path more than once");
  });
});
