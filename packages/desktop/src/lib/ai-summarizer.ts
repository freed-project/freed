/**
 * AI summarization adapter
 *
 * Provides a unified `summarize()` interface across:
 *   - Integrated local model packs (disabled here until a local generation runner is wired)
 *   - Ollama (OpenAI-compatible local endpoint)
 *   - OpenAI (cloud)
 *   - Anthropic (Messages API)
 *   - Gemini (Google generative language API)
 *   - No-op fallback when disabled or unavailable
 *
 * Security model: API keys are passed in as arguments -- they come from
 * `secureStorage.getApiKey()` in the calling code and are never stored here.
 *
 * The sync-safe AI preferences (provider, model, toggles) live in Automerge.
 * The secrets (keys) live in tauri-plugin-store only.
 */

import type { AIPreferences } from "@freed/shared";

export interface AISummary {
  summary: string;
  topics: string[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
}

const SYSTEM_PROMPT = `You are a concise article summarizer. Given article text, return ONLY valid JSON with this exact shape:
{"summary":"2-4 sentence summary","topics":["topic1","topic2"],"sentiment":"positive"|"negative"|"neutral"|"mixed"}
Do not include markdown, code fences, or any text outside the JSON object.`;

// ─── Provider adapters ────────────────────────────────────────────────────────

/** Call the OpenAI-compatible chat completions endpoint (covers Ollama + OpenAI) */
async function callOpenAICompatible(
  baseUrl: string,
  model: string,
  text: string,
  authHeader: string,
): Promise<string> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 8_000) },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI-compatible API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

/** Call the Anthropic Messages API */
async function callAnthropic(
  model: string,
  text: string,
  apiKey: string,
): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text.slice(0, 8_000) }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as { content: { text: string }[] };
  return data.content[0]?.text ?? "";
}

/** Call the Gemini generative language API */
async function callGemini(
  model: string,
  text: string,
  apiKey: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: text.slice(0, 8_000) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── JSON parse helper ────────────────────────────────────────────────────────

function parseAISummary(raw: string): AISummary | null {
  try {
    // Strip accidental markdown fences in case the model misbehaves
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<AISummary>;

    if (
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.topics) ||
      !["positive", "negative", "neutral", "mixed"].includes(parsed.sentiment ?? "")
    ) {
      return null;
    }

    return {
      summary: parsed.summary,
      topics: (parsed.topics as unknown[]).filter((t): t is string => typeof t === "string"),
      sentiment: parsed.sentiment as AISummary["sentiment"],
    };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Summarize article text using the configured AI provider.
 *
 * Returns null when:
 * - provider is "none"
 * - autoSummarize is disabled
 * - the API call fails (logged, never throws)
 * - the response cannot be parsed as a valid AISummary
 */
export async function summarize(
  text: string,
  prefs: AIPreferences,
  apiKey?: string | null,
): Promise<AISummary | null> {
  if (
    prefs.provider === "none" ||
    prefs.provider === "integrated" ||
    !prefs.autoSummarize ||
    !text.trim()
  ) {
    return null;
  }

  try {
    let raw: string;
    const model = prefs.model;

    switch (prefs.provider) {
      case "ollama": {
        const baseUrl = `${prefs.ollamaUrl ?? "http://localhost:11434"}/v1`;
        raw = await callOpenAICompatible(baseUrl, model, text, "Bearer ollama");
        break;
      }
      case "openai": {
        if (!apiKey) return null;
        raw = await callOpenAICompatible(
          "https://api.openai.com/v1",
          model,
          text,
          `Bearer ${apiKey}`,
        );
        break;
      }
      case "anthropic": {
        if (!apiKey) return null;
        raw = await callAnthropic(model, text, apiKey);
        break;
      }
      case "gemini": {
        if (!apiKey) return null;
        raw = await callGemini(model, text, apiKey);
        break;
      }
      default: {
        const _exhaustive: never = prefs.provider;
        return _exhaustive;
      }
    }

    return parseAISummary(raw);
  } catch (err) {
    console.warn("[ai-summarizer] Failed:", err);
    return null;
  }
}

/**
 * Check whether Ollama is reachable at the configured URL.
 * Returns true when the /api/tags endpoint responds with 200.
 */
export async function checkOllamaReachable(
  ollamaUrl = "http://localhost:11434",
): Promise<boolean> {
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    return resp.ok;
  } catch {
    return false;
  }
}
