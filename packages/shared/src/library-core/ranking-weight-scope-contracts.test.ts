import { expect, it } from "vitest";
import {
  parseLibraryCoreRankingWeightScopeRequestV1,
  parseLibraryCoreRankingWeightScopeResponseV1,
  type LibraryCoreRankingWeightScopeRequestV1,
} from "./ranking-weight-scope-contracts.js";

const request: LibraryCoreRankingWeightScopeRequestV1 = {
  queryId: "ranking_weight_scope_v1", schemaVersion: 1, generationId: "a".repeat(64), sourceRevision: 7,
  paths: [["weights", "recency"], ["weights", "topics", "a.b\"\\[é]"], ["weights", "authors", "__proto__"]],
};
const source = { generationId: request.generationId, projectionRevision: 7, transitionSequence: 7 };
const response = { queryId: request.queryId, schemaVersion: 1, paths: request.paths, values: [50, 0.25, null], source };

// Tier 1: a ranking scope cannot become an arbitrary preference or unbounded map read.
it("bounds literal ranking paths without granting other preference scopes", () => {
  expect(parseLibraryCoreRankingWeightScopeRequestV1(request).ok).toBe(true);
  expect(parseLibraryCoreRankingWeightScopeRequestV1({ ...request, paths: [["weights", "authors", "💡".repeat(2048)]] }).ok).toBe(true);
  expect(parseLibraryCoreRankingWeightScopeRequestV1({ ...request, paths: [["weights", "authors", "x".repeat(4097)]] }).ok).toBe(false);
  for (const paths of [[], Array(65).fill(["weights", "recency"]), [request.paths[0], request.paths[0]],
    [["fbCapture", "excludedGroupIds", "one"]], [["weights", "topics"]], [["weights", "topics", "one", "bits"]],
    [["weights", "topics", "\ud800"]], [["weights", "topics", 1n]]]) {
    expect(parseLibraryCoreRankingWeightScopeRequestV1({ ...request, paths }).ok).toBe(false);
  }
  const paths = Array.from({ length: 64 }, (_, i) => ["weights", "topics", `${i}${"x".repeat(2048)}`]);
  expect(parseLibraryCoreRankingWeightScopeRequestV1({ ...request, paths }).ok).toBe(false);
  expect(parseLibraryCoreRankingWeightScopeRequestV1({ ...request, sql: "SELECT 1" }).ok).toBe(false);
});

// Tier 1: missing weights may default; malformed or differently sourced weights may not.
it("preserves exact ordered finite values and distinguishes absence from invalid data", () => {
  expect(parseLibraryCoreRankingWeightScopeResponseV1(response, request)).toEqual({ ok: true, value: response });
  for (const values of [[50, 0.25], [50, undefined, null], [50, NaN, null], [50, Infinity, null], [50, "0.25", null], Array(3)])
    expect(parseLibraryCoreRankingWeightScopeResponseV1({ ...response, values }, request).ok).toBe(false);
  for (const paths of [[...request.paths].reverse(), [["weights", "topics", 1n]], Array(65)])
    expect(parseLibraryCoreRankingWeightScopeResponseV1({ ...response, paths }, request).ok).toBe(false);
  for (const changed of [{ ...source, projectionRevision: 8 }, { ...source, transitionSequence: 8 }, { ...source, generationId: "b".repeat(64) }])
    expect(parseLibraryCoreRankingWeightScopeResponseV1({ ...response, source: changed }, request)).toEqual({ ok: false, error: "CURSOR_STALE" });
});
