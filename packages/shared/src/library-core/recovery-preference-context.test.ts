import { expect, it, vi } from "vitest";
import { readLibraryCoreRecoveryPreferenceContextV1 } from "./recovery-preference-context.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "./recovery-intent-page-contracts.js";

const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const review = { source } as LibraryCoreRecoveryIntentReviewResponseV1;
const row = { operationType: "preferences_leaf_assignment", entityId: "preferences" } as LibraryCoreRecoveryIntentReviewResponseV1["rows"][number];
const envelope = (updates: unknown) => ({ entity_type: "UserPreferences", blob_references: [], payload: { updates } });
const node = (path: string, textValue: string | null = null, booleanValue: boolean | null = null) => ({ path, textValue, booleanValue,
  integerValue: null, realValue: null, updatedAt: 1, valueType: textValue !== null ? "text" : booleanValue !== null ? "boolean" : "null" });

it("preserves exact paths, whole arrays, empty groups and numeric wire values with stored/default context", async () => {
  const query = vi.fn().mockResolvedValue({ source: { ...source, transitionSequence: 7 }, rows: [
    node("o:$.display"), node("v:$.display.showEngagementCounts", null, true),
    node("o:$.weights"), node("o:$.weights.topics"), node('o:$.weights.topics."a.b"'),
    node('v:$.weights.topics."a.b".bits', "3fe0000000000000"), node('v:$.weights.topics."a.b".codec', "ieee754_binary64_hex_v1"),
  ] });
  const context = await readLibraryCoreRecoveryPreferenceContextV1(review, query as LibraryCoreNormalizedReaderRuntime["query"], () => {});
  const fraction = { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" };
  const updates = { weights: { topics: { "a.b": fraction, constructor: 2 } }, display: { showEngagementCounts: false, reading: {} }, storyWall: { selectedYears: [2020, 2021] } };
  const draft = context(row, envelope(updates));
  expect(draft.updates).toEqual(updates);
  expect(draft.fields).toEqual(expect.arrayContaining([
    { path: ["weights", "topics", "a.b"], kind: "assignment", archived: 0.125, current: { origin: "stored", value: 0.5 } },
    { path: ["weights", "topics", "constructor"], kind: "assignment", archived: 2, current: null },
    { path: ["display", "showEngagementCounts"], kind: "assignment", archived: false, current: { origin: "stored", value: true } },
    expect.objectContaining({ path: ["display", "reading"], kind: "empty_object", archived: {}, current: expect.objectContaining({ origin: "default" }) }),
    expect.objectContaining({ path: ["storyWall", "selectedYears"], kind: "assignment", archived: [2020, 2021] }),
  ]));
  expect(draft.fields).toHaveLength(5);
  const defaults = context(row, envelope({ display: { reading: { focusMode: false } } }));
  expect(defaults.fields[0]?.current?.origin).toBe("default");
  expect(context(row, envelope(updates)).fields).toEqual(draft.fields);
  expect(query).toHaveBeenCalledOnce();
});

it("refuses stale or cancelled snapshots and unsupported complete members", async () => {
  const query = vi.fn().mockResolvedValue({ source, rows: [] });
  let cancelled = false;
  const check = () => { if (cancelled) throw new Error("QUERY_CANCELLED"); };
  const context = await readLibraryCoreRecoveryPreferenceContextV1(review, query as LibraryCoreNormalizedReaderRuntime["query"], check);
  for (const input of [envelope({ display: { unknownSetting: true } }), { ...envelope({ display: {} }), blob_references: [{}] }, { ...envelope({ display: {} }), entity_type: "Person" }])
    expect(() => context(row, input)).toThrow("complete preference edit");
  expect(() => context({ ...row, operationType: "person_upsert" }, envelope({ display: {} }))).toThrow();
  cancelled = true;
  expect(() => context(row, envelope({ display: {} }))).toThrow("QUERY_CANCELLED");
  await expect(readLibraryCoreRecoveryPreferenceContextV1(review, query as LibraryCoreNormalizedReaderRuntime["query"], check)).rejects.toThrow("QUERY_CANCELLED");
  expect(query).toHaveBeenCalledOnce();
  cancelled = false;
  query.mockResolvedValueOnce({ source: { ...source, projectionRevision: 8 }, rows: [] });
  await expect(readLibraryCoreRecoveryPreferenceContextV1(review, query as LibraryCoreNormalizedReaderRuntime["query"], check)).rejects.toThrow("CURSOR_STALE");
  query.mockImplementationOnce(async () => { cancelled = true; return { source, rows: [] }; });
  await expect(readLibraryCoreRecoveryPreferenceContextV1(review, query as LibraryCoreNormalizedReaderRuntime["query"], check)).rejects.toThrow("QUERY_CANCELLED");
});
