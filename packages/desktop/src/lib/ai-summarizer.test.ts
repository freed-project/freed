import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIPreferences } from "@freed/shared";
import { summarize } from "./ai-summarizer.js";

const OPENAI_PREFS: AIPreferences = {
  provider: "openai",
  model: "gpt-4o-mini",
  autoSummarize: true,
  extractTopics: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ai summarizer", () => {
  it("passes abort signals through to provider fetch calls", async () => {
    const signal = new AbortController().signal;
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "Short summary",
            topics: ["ai"],
            sentiment: "neutral",
          }),
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await summarize("Long article text", OPENAI_PREFS, "test-key", { signal });

    expect(result?.summary).toBe("Short summary");
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal }));
  });
});
