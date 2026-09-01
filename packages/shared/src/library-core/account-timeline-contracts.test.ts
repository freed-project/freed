import { describe, expect, it, vi } from "vitest";
import {
  encodeLibraryCoreAccountTimelineCursorV1,
  libraryCoreAccountTimelineAccountDigestV1,
  parseLibraryCoreAccountTimelineRequestV1,
  parseLibraryCoreAccountTimelineResponseV1,
} from "./account-timeline-contracts.js";

const source = Object.freeze({
  generationId: "a".repeat(64),
  projectionRevision: 4,
  transitionSequence: 4,
});
const request = Object.freeze({
  accountId: "account-1",
  cancellationId: "account-timeline-cancel",
  cursor: null,
  limit: 50,
  queryId: "account_timeline_v1" as const,
  readerSessionId: "account-timeline-reader",
  schemaVersion: 1 as const,
});

describe("Library Core account timeline contract", () => {
  it("binds the closed page and cursor to one Account", () => {
    expect(parseLibraryCoreAccountTimelineRequestV1(request).ok).toBe(true);
    const nextCursor = encodeLibraryCoreAccountTimelineCursorV1({
      accountDigest: libraryCoreAccountTimelineAccountDigestV1("account-1"),
      generationId: source.generationId as never,
      globalId: "x:item-1" as never,
      projectionRevision: 4,
      sortAt: 10,
      transitionSequence: 4,
    });
    const response = {
      nextCursor: null,
      queryId: "account_timeline_v1" as const,
      rows: [],
      schemaVersion: 1 as const,
      source,
      totalCount: 1,
    };
    expect(
      parseLibraryCoreAccountTimelineResponseV1(response, request).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreAccountTimelineRequestV1({
        ...request,
        accountId: "account-2",
        cursor: nextCursor,
      }).ok,
    ).toBe(false);
  });

  it("rejects accessors without invoking them", () => {
    const getter = vi.fn(() => "account-1");
    const hostile = { ...request };
    Object.defineProperty(hostile, "accountId", {
      enumerable: true,
      get: getter,
    });

    expect(parseLibraryCoreAccountTimelineRequestV1(hostile).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
});
