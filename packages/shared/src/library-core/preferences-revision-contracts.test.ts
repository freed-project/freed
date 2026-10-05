import { expect, it } from "vitest";
import { parseLibraryCorePreferencesRevisionRequestV1, parseLibraryCorePreferencesRevisionResponseV1 } from "./preferences-revision-contracts.js";
import { createLibraryCoreSqliteQueryWorkerRequest, parseLibraryCoreSqliteQueryResponse, parseLibraryCoreSqliteWorkerRequest } from "./sqlite-worker-protocol.js";

// Tier 1: a revision marker is closed and cannot refer to changes beyond its source.
it("preserves the generation with the preference revision through the worker boundary", () => {
  const request = { queryId: "preferences_revision_v1", schemaVersion: 1 } as const;
  const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
  const response = { ...request, revision: 6, source };
  expect(parseLibraryCorePreferencesRevisionRequestV1(request).ok).toBe(true);
  expect(parseLibraryCorePreferencesRevisionRequestV1({ ...request, sql: "SELECT 1" }).ok).toBe(false);
  const envelope = createLibraryCoreSqliteQueryWorkerRequest("preference-revision", request);
  expect(parseLibraryCoreSqliteWorkerRequest(envelope)).toEqual(envelope);
  expect(parseLibraryCoreSqliteQueryResponse(response, request)).toEqual(response);
  for (const revision of [-1, 8, 0.5, Infinity, "6"]) expect(parseLibraryCorePreferencesRevisionResponseV1({ ...response, revision }).ok).toBe(false);
  expect(parseLibraryCorePreferencesRevisionResponseV1({ ...response, source: { ...source, transitionSequence: 8 } }).ok).toBe(false);
  const replaced = { ...response, revision: 0, source: { ...source, generationId: "b".repeat(64) } };
  expect(parseLibraryCoreSqliteQueryResponse(replaced, request)).toEqual(replaced);
});
