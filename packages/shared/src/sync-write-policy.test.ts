import { describe, expect, it } from "vitest";

import { sanitizeFeedItemWrite } from "./sync-write-policy.js";

describe("synchronized write policy", () => {
  it("retains normalized nested content and excludes device-local ranking", () => {
    const sanitized = sanitizeFeedItemWrite({
      content: { text: "kept", mediaUrls: [], mediaTypes: [] },
      preservedContent: {
        text: "also kept",
        preservedAt: 1,
        wordCount: 2,
        readingTime: 1,
      },
      priority: 10,
      priorityComputedAt: 20,
    });

    expect(sanitized.content).toBeDefined();
    expect(sanitized.preservedContent).toBeDefined();
    expect(sanitized).not.toHaveProperty("priority");
    expect(sanitized).not.toHaveProperty("priorityComputedAt");
  });
});
