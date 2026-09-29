import { coerceLibraryCoreGeneratedSqliteQueryRow, parseLibraryCoreGeneratedSqliteQueryRow } from "./sqlite-contract.generated.js";
import { expect, it } from "vitest";
import { libraryCorePreferenceSelectionJsonV1, parseLibraryCorePreferenceValueRequestV1, parseLibraryCorePreferenceValueResponseV1, type LibraryCorePreferenceValueRequestV1 } from "./preference-value-contracts.js";
const request: LibraryCorePreferenceValueRequestV1 = { queryId: "preference_value_v1", schemaVersion: 1, path: ["weights", "topics", 'a.b"\\[é]'], generationId: "a".repeat(64), sourceRevision: 7 };
const source = { generationId: request.generationId, projectionRevision: 7, transitionSequence: 7 };
const row = (path: string, integerValue: number | null = null) => ({ path, valueType: integerValue === null ? "null" : "integer", integerValue, booleanValue: null, realValue: null, textValue: null, updatedAt: 1 });
const response = (kind: string, rows: unknown[]) => ({ queryId: "preference_value_v1", schemaVersion: 1, path: request.path, kind, rows, source });

// Tier 1: a selected literal key must not address a sibling or execute a property setter.
it("closes selected paths and derives literal selection objects without prototype mutation", () => {
  expect(JSON.parse(libraryCorePreferenceSelectionJsonV1(request))).toEqual({ weights: { topics: { [request.path[2]!]: null } } });
  const prototypePath = { ...request, path: ["weights", "topics", "__proto__"] };
  expect(Object.hasOwn(JSON.parse(libraryCorePreferenceSelectionJsonV1(prototypePath)).weights.topics, "__proto__")).toBe(true);
  for (const path of [[], [1], Array(1), ["a\ud800b"], Array(33).fill("x"), ["x".repeat(8192)]]) expect(parseLibraryCorePreferenceValueRequestV1({ ...request, path }).ok).toBe(false);
  expect(JSON.parse(libraryCorePreferenceSelectionJsonV1({ ...request, path: ["weights", "topics", "a\u0000b"] })).weights.topics["a\u0000b"]).toBe(null);
  expect(parseLibraryCorePreferenceValueRequestV1({ ...request, sql: "select 1" }).ok).toBe(false);
});

// Tier 1: incomplete arrays and summaries must never masquerade as usable current values.
it("distinguishes complete assignments, absent values and object summaries at the exact source", () => {
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [row("v:$._", 3)]), request).ok).toBe(true);
  expect(parseLibraryCorePreferenceValueResponseV1(response("absent", []), request).ok).toBe(true);
  expect(parseLibraryCorePreferenceValueResponseV1(response("object_group", [row("o:$._")]), request).ok).toBe(true);
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [row("o:$._")]), request).ok).toBe(false);
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [row("a:$._", 2), row("v:$._[0]", 1)]), request).ok).toBe(false);
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [row("a:$._", 2), row("v:$._[0]", 1), row("v:$._[1]", 2)]), request).ok).toBe(true);
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [row("v:$.other", 3)]), request).ok).toBe(false);
  expect(parseLibraryCorePreferenceValueResponseV1({ ...response("absent", []), path: ["weights", "topics", "a", "b"] }, request).ok).toBe(false);
  expect(parseLibraryCorePreferenceValueResponseV1({ ...response("absent", []), source: { ...source, projectionRevision: 8 } }, request)).toEqual({ ok: false, error: "CURSOR_STALE" });
});

// Tier 1: finite SQLite reals and strict wire booleans share one generated descriptor.
it("uses the generated finite-real descriptor without widening wire coercion", () => {
  const real = { ...row("v:$._"), valueType: "real", realValue: 0.5 };
  expect(parseLibraryCorePreferenceValueResponseV1(response("value", [real]), request).ok).toBe(true);
  for (const realValue of [NaN, Infinity, -Infinity, "0.5"]) {
    expect(coerceLibraryCoreGeneratedSqliteQueryRow("preference_value_v1", { ...real, realValue })).toBeNull();
    expect(parseLibraryCorePreferenceValueResponseV1(response("value", [{ ...real, realValue }]), request).ok).toBe(false);
  }
  const boolean = { ...row("v:$._"), valueType: "boolean", booleanValue: 1 };
  expect(coerceLibraryCoreGeneratedSqliteQueryRow("preference_value_v1", boolean)?.booleanValue).toBe(true);
  expect(parseLibraryCoreGeneratedSqliteQueryRow("preference_value_v1", boolean)).toBeNull();
});
