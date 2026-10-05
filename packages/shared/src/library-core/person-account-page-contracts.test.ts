import { parseLibraryCoreFeedPageSourceV1 } from "./feed-page-contracts.js";
import { expect, it } from "vitest";
import { encodeLibraryCorePersonAccountCursorV1, decodeLibraryCorePersonAccountCursorV1, parseLibraryCorePersonAccountPageRequestV1, parseLibraryCorePersonAccountPageResponseV1 } from "./person-account-page-contracts.js";
import vector from "./person-account-cursor-vector-v1.json";
const request = { queryId: "person_account_page_v1", schemaVersion: 1, personId: vector.personId, limit: 1, cursor: null } as const;
it("shares canonical native cursor bytes and rejects wrong Person, revision and binary order", () => {
  const source = parseLibraryCoreFeedPageSourceV1(vector.source);
  if (!source.ok) throw new Error(source.error);
  expect(encodeLibraryCorePersonAccountCursorV1(vector.personId, vector.accountId, source.value)).toBe(vector.cursor);
  expect(decodeLibraryCorePersonAccountCursorV1(vector.cursor, vector.personId)).toEqual({ accountId: vector.accountId, source: vector.source });
  expect(parseLibraryCorePersonAccountPageRequestV1({ ...request, cursor: vector.cursor, personId: "other" }).ok).toBe(false);
  expect(parseLibraryCorePersonAccountPageRequestV1({ ...request, cursor: vector.cursor + "=" }).ok).toBe(false);
  const response = { queryId: request.queryId, schemaVersion: 1, personId: request.personId, source: vector.source, rows: [{ accountId: vector.accountId }], nextCursor: vector.cursor };
  expect(parseLibraryCorePersonAccountPageResponseV1(response, request).ok).toBe(true);
  expect(parseLibraryCorePersonAccountPageResponseV1(response, { ...request, cursor: vector.cursor }).ok).toBe(false);
  expect(parseLibraryCorePersonAccountPageResponseV1({ ...response, rows: [{ accountId: "account:064" }], nextCursor: null, source: { ...vector.source, projectionRevision: 8, transitionSequence: 8 } }, { ...request, cursor: vector.cursor })).toEqual({ ok: false, error: "CURSOR_STALE" });
});
