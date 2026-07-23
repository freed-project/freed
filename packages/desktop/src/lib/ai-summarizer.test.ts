import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIPreferences } from "@freed/shared";

const recordAiRequestAttempt = vi.hoisted(() => vi.fn());

vi.mock("./runtime-health-events", () => ({ recordAiRequestAttempt }));

import { summarize } from "./ai-summarizer.js";

const OPENAI_PREFS: AIPreferences = {
  provider: "openai",
  model: "gpt-4o-mini",
  autoSummarize: true,
  extractTopics: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ai summarizer", () => {
  it("passes abort signals through to provider fetch calls", async () => {
    const signal = new AbortController().signal;
    const mockFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
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
    expect(recordAiRequestAttempt).toHaveBeenCalledWith({
      provider: "openai",
      purpose: "summarize",
    });
  });

  it("does not count a provider request when required credentials are absent", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", mockFetch);

    await expect(summarize("Long article text", OPENAI_PREFS)).resolves.toBeNull();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordAiRequestAttempt).not.toHaveBeenCalled();
  });
});
