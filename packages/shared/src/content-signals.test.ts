import { describe, expect, it } from "vitest";
import type { FeedItem } from "./types.js";
import { inferEventCandidate } from "./content-signals.js";

function item(text: string): FeedItem {
  return {
    globalId: "test:event-location",
    platform: "rss",
    contentType: "post",
    capturedAt: Date.UTC(2026, 6, 1),
    publishedAt: Date.UTC(2026, 6, 1),
    author: { id: "test", handle: "test", displayName: "Test" },
    content: { text, mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  };
}

describe("inferEventCandidate", () => {
  it("trims bounded trailing location delimiters without a backtracking regex", () => {
    const candidate = inferEventCandidate(
      item(`Join us July 20 at 7 PM. location: Grand Hall${"]".repeat(70)}`),
      undefined,
      Date.UTC(2026, 6, 1),
    );

    expect(candidate?.locationName).toBe("Grand Hall");
  });
});
