import { describe, expect, it } from "vitest";

import {
  parseLibraryCoreFriendCandidateReviewRequestV1,
  parseLibraryCoreFriendCandidateReviewResponseV1,
} from "./friend-candidate-review-contracts.js";

const request = {
  cancellationId: "cancel-friend-review",
  contactAccountIds: ["account-1"],
  contactPersonIds: ["person-1"],
  dismissedSuggestionIds: ["suggestion-1"],
  limit: 10,
  nowMs: 1_800_000_000_000,
  queryId: "friend_candidate_review_v1" as const,
  readerSessionId: "reader-friend-review",
  schemaVersion: 1 as const,
};

const row = {
  accountIdsJson: '["account-1"]',
  confidence: "high" as const,
  contactOverlapScore: 14,
  directRequestsScore: 9,
  displayName: "Ada Lovelace",
  id: "friend-suggestion:unlinked_account:account-1:12:1:1:0:1:0:0",
  kind: "unlinked_account" as const,
  lastActivityAt: 12,
  lifeEventsScore: 0,
  multiChannelScore: 0,
  personId: null,
  personalUpdatesScore: 13,
  placesMomentsScore: 0,
  recentActivityScore: 10,
  sampleItemIdsJson: '["item-1"]',
  score: 80,
  signalCountsJson: '{"life_update":1,"request":1}',
};

describe("Friend candidate review contract", () => {
  it("accepts one closed bounded request and response", () => {
    const parsedRequest =
      parseLibraryCoreFriendCandidateReviewRequestV1(request);
    expect(parsedRequest.ok).toBe(true);
    if (!parsedRequest.ok) return;
    expect(
      parseLibraryCoreFriendCandidateReviewResponseV1(
        {
          queryId: "friend_candidate_review_v1",
          rows: [row],
          schemaVersion: 1,
          source: {
            generationId: "a".repeat(64),
            projectionRevision: 12,
            transitionSequence: 12,
          },
        },
        parsedRequest.value,
      ).ok,
    ).toBe(true);
  });

  it("rejects unsorted inputs, excess rows, and malformed nested records", () => {
    expect(
      parseLibraryCoreFriendCandidateReviewRequestV1({
        ...request,
        contactAccountIds: ["account-2", "account-1"],
      }).ok,
    ).toBe(false);
    const parsedRequest = parseLibraryCoreFriendCandidateReviewRequestV1({
      ...request,
      limit: 1,
    });
    if (!parsedRequest.ok) throw new Error(parsedRequest.error);
    const response = {
      queryId: "friend_candidate_review_v1",
      schemaVersion: 1,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 12,
        transitionSequence: 12,
      },
    } as const;
    expect(
      parseLibraryCoreFriendCandidateReviewResponseV1(
        { ...response, rows: [row, row] },
        parsedRequest.value,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFriendCandidateReviewResponseV1(
        { ...response, rows: [{ ...row, accountIdsJson: "not-json" }] },
        parsedRequest.value,
      ).ok,
    ).toBe(false);
  });
});
