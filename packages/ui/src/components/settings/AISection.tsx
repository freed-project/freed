/**
 * AI settings section for the Settings panel
 *
 * Shows provider selection, model input, Ollama status, API key entry
 * (desktop only), and feature toggles. Rendered inside SettingsDialog
 * as the "AI" section.
 *
 * Provider preferences write to Automerge (synced).
 * API keys write to secureStorage (device-local, never synced).
 */

import { useState, useEffect, useCallback } from "react";
import type { AIPreferences } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { SettingsToggle } from "../SettingsToggle.js";

const DEFAULT_MODELS: Record<string, string> = {
  none: "",
  ollama: "qwen2.5:1.5b",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.0-flash",
};

const PROVIDER_LABELS: Record<string, string> = {
  none: "None (disabled)",
  ollama: "Ollama (free, runs locally)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

/** Dot indicator showing Ollama reachability */
function OllamaStatus({ url }: { url: string }) {
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2_000) })
      .then((r) => { if (!cancelled) setReachable(r.ok); })
      .catch(() => { if (!cancelled) setReachable(false); });
    return () => { cancelled = true; };
  }, [url]);

  if (reachable === null) return null;
  return (
    <span
      title={reachable ? "Ollama is running" : "Ollama not reachable"}
      className={`inline-block w-2 h-2 rounded-full ${reachable ? "bg-emerald-500" : "bg-[#52525b]"}`}
    />
  );
}

/** Masked API key input -- write-only after save, displays bullets */
function ApiKeyInput({
  provider,
  getApiKey,
  setApiKey,
  clearApiKey,
}: {
  provider: "openai" | "anthropic" | "gemini";
  getApiKey: (p: string) => Promise<string | null>;
  setApiKey: (p: string, key: string) => Promise<void>;
  clearApiKey: (p: string) => Promise<void>;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getApiKey(provider).then((k) => setHasSaved(!!k));
  }, [provider, getApiKey]);

  const handleSave = async () => {
    if (!keyDraft.trim()) return;
    setSaving(true);
    try {
      await setApiKey(provider, keyDraft.trim());
      setKeyDraft("");
      setHasSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await clearApiKey(provider);
    setHasSaved(false);
    setKeyDraft("");
  };

  return (
    <div className="flex gap-2 items-center">
      <input
        type="password"
        value={hasSaved && !keyDraft ? "••••••••••••••••" : keyDraft}
        onChange={(e) => {
          setHasSaved(false);
          setKeyDraft(e.target.value);
        }}
        onFocus={() => {
          if (hasSaved) setHasSaved(false);
        }}
        placeholder="Paste API key"
        className="flex-1 bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-[#a1a1aa] placeholder-[#3f3f46] font-mono focus:outline-none focus:border-[#8b5cf6]/50 transition-colors"
        spellCheck={false}
        autoComplete="off"
      />
      {!hasSaved ? (
        <button
          onClick={handleSave}
          disabled={!keyDraft.trim() || saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      ) : (
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs rounded-lg text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function AISection() {
  const { secureStorage } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const ai: AIPreferences = preferences.ai ?? {
    provider: "none",
    model: "",
    autoSummarize: false,
    extractTopics: false,
  };

  const [showOllamaUrl, setShowOllamaUrl] = useState(false);
  const ollamaUrl = ai.ollamaUrl ?? "http://localhost:11434";

  const update = useCallback(
    (patch: Partial<AIPreferences>) => {
      updatePreferences({ ai: { ...ai, ...patch } });
    },
    [ai, updatePreferences],
  );

  const handleProviderChange = (provider: AIPreferences["provider"]) => {
    update({
      provider,
      model: ai.model || DEFAULT_MODELS[provider] || "",
    });
  };

  const requiresKey = ai.provider === "openai" || ai.provider === "anthropic" || ai.provider === "gemini";

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider">
        AI Summarization
      </h3>

      {/* Provider */}
      <div>
        <label className="block text-sm text-[#a1a1aa] mb-1.5">Provider</label>
        <select
          value={ai.provider}
          onChange={(e) => handleProviderChange(e.target.value as AIPreferences["provider"])}
          className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-[#a1a1aa] focus:outline-none focus:border-[#8b5cf6]/50 transition-colors"
        >
          {Object.entries(PROVIDER_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Ollama status + URL override */}
      {ai.provider === "ollama" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-[#71717a]">
            <OllamaStatus url={ollamaUrl} />
            <span>Ollama at {ollamaUrl}</span>
            <button
              onClick={() => setShowOllamaUrl((v) => !v)}
              className="text-[#52525b] hover:text-[#8b5cf6] text-xs underline transition-colors"
            >
              {showOllamaUrl ? "Hide" : "Change"}
            </button>
          </div>
          {showOllamaUrl && (
            <input
              type="url"
              value={ai.ollamaUrl ?? ""}
              onChange={(e) => update({ ollamaUrl: e.target.value || undefined })}
              placeholder="http://localhost:11434"
              className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-[#a1a1aa] placeholder-[#3f3f46] font-mono focus:outline-none focus:border-[#8b5cf6]/50 transition-colors"
            />
          )}
        </div>
      )}

      {/* Model */}
      {ai.provider !== "none" && (
        <div>
          <label className="block text-sm text-[#a1a1aa] mb-1.5">Model</label>
          <input
            type="text"
            value={ai.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={DEFAULT_MODELS[ai.provider] ?? "Model name"}
            className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-[#a1a1aa] placeholder-[#3f3f46] font-mono focus:outline-none focus:border-[#8b5cf6]/50 transition-colors"
          />
        </div>
      )}

      {/* API key -- desktop only */}
      {requiresKey && secureStorage && (
        <div>
          <label className="block text-sm text-[#a1a1aa] mb-1.5">API Key</label>
          <ApiKeyInput
            provider={ai.provider as "openai" | "anthropic" | "gemini"}
            getApiKey={secureStorage.getApiKey}
            setApiKey={secureStorage.setApiKey}
            clearApiKey={secureStorage.clearApiKey}
          />
          <p className="mt-1 text-[11px] text-[#52525b]">
            Stored encrypted on this device only. Never synced.
          </p>
        </div>
      )}
      {requiresKey && !secureStorage && (
        <p className="text-xs text-[#71717a] bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          API key storage is only available in the desktop app. On the PWA, saves are sent to your desktop for AI processing.
        </p>
      )}

      {/* Toggles */}
      {ai.provider !== "none" && (
        <div className="space-y-3 pt-1">
          <SettingsToggle
            label="Auto-summarize new saves"
            description="Summarize articles as they are cached. May incur API costs with cloud providers."
            checked={ai.autoSummarize}
            onChange={(v) => update({ autoSummarize: v })}
          />
          <SettingsToggle
            label="Extract topics for ranking"
            description="Use AI to extract topics that feed the priority ranking algorithm."
            checked={ai.extractTopics}
            onChange={(v) => update({ extractTopics: v })}
          />
        </div>
      )}
    </div>
  );
}
