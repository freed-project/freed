import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
} from "./account-detail-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

const request = {
  accountId: "account-1",
  queryId: "account_detail_v1" as const,
  schemaVersion: 1 as const,
};

const account = {
  address: null,
  avatarUrl: null,
  createdAt: 10,
  discoveredFrom: "capture",
  displayName: "Ada",
  email: null,
  externalId: "ada-remote",
  firstSeenAt: 10,
  followRosterActive: true,
  followRosterRoles: ["follower", "following"],
  followRosterSyncedAt: 20,
  handle: "ada",
  id: "account-1",
  importedAt: null,
  kind: "social",
  lastSeenAt: 20,
  personId: "person-1",
  phone: null,
  profileUrl: "https://example.com/ada",
  provider: "x",
  sampleBatchId: null,
  sampleGeneratedAt: null,
  sampleGeneratorVersion: null,
  updatedAt: 20,
};

describe("account detail contracts", () => {
  it("accepts one closed bounded Account with ordered follow roles", () => {
    expect(
      parseLibraryCoreAccountDetailResponseV1(
        { account, queryId: "account_detail_v1", schemaVersion: 1, source },
        request,
      ),
    ).toMatchObject({ ok: true, value: { account: { id: "account-1" } } });
  });

  it("rejects unknown request fields and unstable role order", () => {
    expect(
      parseLibraryCoreAccountDetailRequestV1({ ...request, surprise: true }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreAccountDetailResponseV1(
        {
          account: {
            ...account,
            followRosterRoles: ["following", "follower"],
          },
          queryId: "account_detail_v1",
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(false);
  });
});
