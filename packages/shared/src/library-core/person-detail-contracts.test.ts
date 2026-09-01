import { describe, expect, it } from "vitest";
import {
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
} from "./person-detail-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

describe("person detail contracts", () => {
  it("accepts one closed bounded Person with stable nested row identities", () => {
    const request = {
      personId: "person-1",
      queryId: "person_detail_v1" as const,
      schemaVersion: 1 as const,
    };
    const parsed = parseLibraryCorePersonDetailResponseV1(
      {
        linkedAccountCount: 1,
        linkedAccounts: [
          {
            address: null,
            avatarUrl: null,
            createdAt: 11,
            discoveredFrom: "captured_item",
            displayName: "Ada",
            email: null,
            externalId: "ada",
            firstSeenAt: 11,
            handle: "@ada",
            id: "account-1",
            importedAt: null,
            kind: "social",
            lastSeenAt: 20,
            phone: null,
            profileUrl: null,
            provider: "x",
            updatedAt: 20,
          },
        ],
        person: {
          avatarUrl: null,
          bio: "Mathematician",
          careLevel: 5,
          createdAt: 10,
          id: "person-1",
          name: "Ada",
          notes: null,
          reachOutIntervalDays: 14,
          reachOuts: [
            {
              channel: "text",
              loggedAt: 20,
              notes: "Hello",
              reachOutId: "operation-2",
            },
          ],
          relationshipStatus: "friend",
          sampleBatchId: null,
          sampleGeneratedAt: null,
          sampleGeneratorVersion: null,
          tags: ["science"],
          updatedAt: 20,
        },
        queryId: "person_detail_v1",
        schemaVersion: 1,
        source,
      },
      request,
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        linkedAccountCount: 1,
        linkedAccounts: [{ id: "account-1" }],
        person: { id: "person-1", reachOuts: [{ reachOutId: "operation-2" }] },
      },
    });
  });

  it("rejects unknown fields and oversized identities", () => {
    expect(
      parseLibraryCorePersonDetailRequestV1({
        personId: "person-1",
        queryId: "person_detail_v1",
        schemaVersion: 1,
        surprise: true,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCorePersonDetailResponseV1(
        {
          linkedAccountCount: 0,
          linkedAccounts: [],
          person: null,
          queryId: "person_detail_v1",
          schemaVersion: 1,
          source,
        },
        { personId: "person-1", queryId: "person_detail_v1", schemaVersion: 1 },
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCorePersonDetailRequestV1({
        personId: "x".repeat(2_049),
        queryId: "person_detail_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
  });
});
