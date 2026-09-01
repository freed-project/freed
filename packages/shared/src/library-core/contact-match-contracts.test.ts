import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreContactMatchRequestV1,
  parseLibraryCoreContactMatchResponseV1,
} from "./contact-match-contracts.js";

const request = {
  emails: ["ada@example.com"],
  names: ["ada", "ada lovelace"],
  queryId: "contact_match_v1" as const,
  schemaVersion: 1 as const,
};

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

describe("contact match contracts", () => {
  it("accepts one closed bounded request and response", () => {
    expect(parseLibraryCoreContactMatchRequestV1(request)).toMatchObject({ ok: true });
    expect(parseLibraryCoreContactMatchResponseV1({
      accountIds: ["account-ada"],
      confidence: "high",
      personId: "person-ada",
      queryId: "contact_match_v1",
      schemaVersion: 1,
      source,
    }, request)).toMatchObject({ ok: true });
  });

  it("rejects unordered, duplicate, oversized, and open values", () => {
    expect(parseLibraryCoreContactMatchRequestV1({
      ...request,
      names: ["zed", "ada"],
    }).ok).toBe(false);
    expect(parseLibraryCoreContactMatchRequestV1({
      ...request,
      names: ["ada", "ada"],
    }).ok).toBe(false);
    expect(parseLibraryCoreContactMatchResponseV1({
      accountIds: Array.from({ length: 33 }, (_, index) => `account-${index.toString().padStart(2, "0")}`),
      confidence: "high",
      personId: null,
      queryId: "contact_match_v1",
      schemaVersion: 1,
      source,
    }, request).ok).toBe(false);
    expect(parseLibraryCoreContactMatchResponseV1({
      accountIds: [],
      confidence: "medium",
      extra: true,
      personId: null,
      queryId: "contact_match_v1",
      schemaVersion: 1,
      source,
    }, request).ok).toBe(false);
  });
});
