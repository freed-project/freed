import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIPreferences } from "@freed/shared";
import type { DeviceAIPreferences } from "@freed/ui/lib/device-ai-preferences";

const recordAiRequestAttempt = vi.hoisted(() => vi.fn());

vi.mock("./runtime-health-events", () => ({ recordAiRequestAttempt }));

import { summarize } from "./ai-summarizer.js";

const OPENAI_PREFS: AIPreferences & DeviceAIPreferences = {
  provider: "openai",
  model: "gpt-4o-mini",
  ollamaUrl: "http://localhost:11434",
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

  it.each([
    { provider: "openai" as const, model: "gpt-6-astra", astra: true },
    { provider: "openai" as const, model: "gpt-4o-mini", astra: false },
    { provider: "ollama" as const, model: "gpt-6-astra", astra: false },
  ])("keeps request parameters compatible for $provider / $model", async ({ provider, model, astra }) => {
    const mockFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "Short summary", topics: ["ai"], sentiment: "neutral",
      }) } }],
    })));
    vi.stubGlobal("fetch", mockFetch);

    const result = await summarize("x".repeat(9_000), { ...OPENAI_PREFS, provider, model }, "test-key");

    expect(result?.summary).toBe("Short summary");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe(model);
    expect(body.messages[1].content).toHaveLength(8_000);
    if (astra) {
      expect(body.reasoning_effort).toBe("low");
      expect(body.max_completion_tokens).toBe(4_096);
      for (const key of ["temperature", "max_tokens", "top_p", "logprobs", "top_logprobs", "tools"]) {
        expect(body).not.toHaveProperty(key);
      }
    } else {
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(512);
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("max_completion_tokens");
    }
  });

  it("returns no summary and does not retry an unavailable Astra model", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => new Response("model_not_found", { status: 404 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(summarize("Article", { ...OPENAI_PREFS, model: "gpt-6-astra" }, "test-key")).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not count a provider request when required credentials are absent", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", mockFetch);

    await expect(summarize("Long article text", OPENAI_PREFS)).resolves.toBeNull();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordAiRequestAttempt).not.toHaveBeenCalled();
  });
});
