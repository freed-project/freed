import { expect, it, vi } from "vitest";
import { createLibraryCoreRecoveryPreferenceDraftV1, readLibraryCoreRecoveryPreferenceCurrentV1 } from "./recovery-preference-context.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const review = { source } as LibraryCoreRecoveryIntentReviewResponseV1;
const row = { operationType: "preferences_leaf_assignment", entityId: "preferences" } as LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
const envelope = (updates: unknown) => ({ entity_type: "UserPreferences", blob_references: [], payload: { updates } });
const node = (path: string, textValue: string | null = null) => ({ path, textValue, booleanValue: null, integerValue: null, realValue: null, updatedAt: 1, valueType: textValue !== null ? "text" : "null" });
const response = (path: readonly string[], kind: string, rows: unknown[]) => ({ queryId: "preference_value_v1", schemaVersion: 1, path, kind, rows, source: { ...source, transitionSequence: 7 } });

it("preserves complete original assignments without retaining current preference values", () => {
  const updates = { weights: { topics: { "a.b": { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" }, constructor: 2 } }, display: { showEngagementCounts: false, reading: {} }, storyWall: { selectedYears: [2020, 2021] } };
  const draft = createLibraryCoreRecoveryPreferenceDraftV1(row, envelope(updates));
  expect(draft.updates).toEqual(updates);
  expect(draft.fields).toHaveLength(5);
  expect(draft.fields).toEqual(expect.arrayContaining([
    { path: ["weights", "topics", "a.b"], kind: "assignment", archived: 0.125 },
    { path: ["display", "reading"], kind: "empty_object", archived: {} },
    { path: ["storyWall", "selectedYears"], kind: "assignment", archived: [2020, 2021] },
  ]));
  for (const input of [envelope({ display: { unknownSetting: true } }), { ...envelope({ display: {} }), blob_references: [{}] }, { ...envelope({ display: {} }), entity_type: "Person" }]) expect(() => createLibraryCoreRecoveryPreferenceDraftV1(row, input)).toThrow("complete preference edit");
  expect(() => createLibraryCoreRecoveryPreferenceDraftV1(row, envelope({ display: {} }), () => { throw new Error("QUERY_CANCELLED"); })).toThrow("QUERY_CANCELLED");
});

it("reads only the selected literal path and distinguishes values, defaults and groups", async () => {
  const path = ["weights", "topics", "a.b"];
  const query = vi.fn().mockResolvedValue(response(path, "value", [node("o:$._"), node("v:$._.bits", "3fe0000000000000"), node("v:$._.codec", "ieee754_binary64_hex_v1")]));
  const read = (selected: string[]) => readLibraryCoreRecoveryPreferenceCurrentV1(review, selected, query as LibraryCoreNormalizedReaderRuntime["query"], () => {});
  expect(await read(path)).toEqual({ kind: "value", origin: "stored", value: 0.5 });
  expect(query).toHaveBeenCalledWith({ queryId: "preference_value_v1", schemaVersion: 1, path, generationId: source.generationId, sourceRevision: 7 });
  const focus = ["display", "reading", "focusMode"];
  query.mockResolvedValueOnce(response(focus, "absent", []));
  expect(await read(focus)).toMatchObject({ kind: "value", origin: "default" });
  query.mockResolvedValueOnce(response(path, "absent", []));
  expect(await read(path)).toEqual({ kind: "absent" });
  query.mockResolvedValueOnce(response(path, "object_group", [node("o:$._")]));
  expect(await read(path)).toEqual({ kind: "object_group", origin: "stored" });
});

it("refuses stale or cancelled selected reads without substituting defaults", async () => {
  const path = ["display", "showEngagementCounts"];
  const query = vi.fn().mockResolvedValue(response(path, "absent", []));
  let cancelled = true;
  const read = () => readLibraryCoreRecoveryPreferenceCurrentV1(review, path, query as LibraryCoreNormalizedReaderRuntime["query"], () => { if (cancelled) throw new Error("QUERY_CANCELLED"); });
  await expect(read()).rejects.toThrow("QUERY_CANCELLED"); expect(query).not.toHaveBeenCalled();
  cancelled = false;
  query.mockResolvedValueOnce({ ...response(path, "absent", []), source: { ...source, projectionRevision: 8 } });
  await expect(read()).rejects.toThrow("CURSOR_STALE");
  query.mockImplementationOnce(async () => { cancelled = true; return response(path, "absent", []); });
  await expect(read()).rejects.toThrow("QUERY_CANCELLED");
});
