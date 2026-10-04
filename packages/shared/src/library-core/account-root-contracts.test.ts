import { expect, it } from "vitest";
import { parseLibraryCoreAccountRootRequestV1, parseLibraryCoreAccountRootResponseV1 } from "./account-root-contracts.js";
const request = { queryId: "account_root_v1", schemaVersion: 1, accountId: "account:one" } as const;
const account = { id: request.accountId, kind: "social", provider: "instagram", externalId: "one", discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 };
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
const response = (root: unknown) => ({ ...request, account: root, source });
it("retains full Account text and provenance beyond display limits without accepting unknown fields", () => {
  const root = { ...account, address: "x".repeat(20000), followRosterActive: true, followRosterRoles: ["following"], sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "sample", generatedAt: 1, generatorVersion: 1 } };
  const parsed = parseLibraryCoreAccountRootResponseV1(response(root), request);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.account).toEqual(root);
  root.followRosterRoles.push("follower");
  expect(parsed.value.account?.followRosterRoles).toEqual(["following"]);
  for (const value of [{ ...account, address: "x".repeat(65536) }, { ...account, id: "wrong" }, { ...account, futureField: true }])
    expect(parseLibraryCoreAccountRootResponseV1(response(value), request).ok).toBe(false);
  expect(parseLibraryCoreAccountRootResponseV1(response(null), request).ok).toBe(true);
  expect(parseLibraryCoreAccountRootRequestV1({ ...request, cursor: null }).ok).toBe(false);
});
