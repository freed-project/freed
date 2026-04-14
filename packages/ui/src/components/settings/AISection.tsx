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
      className={`inline-block h-2 w-2 rounded-full ${reachable ? "bg-[rgb(var(--theme-feedback-success-rgb)/0.92)]" : "bg-[var(--theme-text-soft)]"}`}
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
        className="flex-1 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
        spellCheck={false}
        autoComplete="off"
      />
      {!hasSaved ? (
        <button
          onClick={handleSave}
          disabled={!keyDraft.trim() || saving}
          className="theme-accent-button rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      ) : (
        <button
          onClick={handleClear}
          className="rounded-lg px-3 py-1.5 text-xs text-[color:var(--theme-text-muted)] transition-colors hover:bg-[rgb(var(--theme-feedback-danger-rgb)/0.1)] hover:text-[rgb(var(--theme-feedback-danger-rgb))]"
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        AI Summarization
      </h3>

      {/* Provider */}
      <div>
        <label className="mb-1.5 block text-sm text-[var(--theme-text-secondary)]">Provider</label>
        <select
          value={ai.provider}
          onChange={(e) => handleProviderChange(e.target.value as AIPreferences["provider"])}
          className="theme-input theme-select w-full rounded-lg px-3 py-1.5 text-sm text-[var(--theme-text-secondary)] focus:outline-none"
        >
          {Object.entries(PROVIDER_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Ollama status + URL override */}
      {ai.provider === "ollama" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-[var(--theme-text-muted)]">
            <OllamaStatus url={ollamaUrl} />
            <span>Ollama at {ollamaUrl}</span>
            <button
              onClick={() => setShowOllamaUrl((v) => !v)}
              className="text-xs underline text-[var(--theme-text-soft)] transition-colors hover:text-[var(--theme-accent-secondary)]"
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
              className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
            />
          )}
        </div>
      )}

      {/* Model */}
      {ai.provider !== "none" && (
        <div>
          <label className="mb-1.5 block text-sm text-[var(--theme-text-secondary)]">Model</label>
          <input
            type="text"
            value={ai.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={DEFAULT_MODELS[ai.provider] ?? "Model name"}
            className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
          />
        </div>
      )}

      {/* API key -- desktop only */}
      {requiresKey && secureStorage && (
        <div>
          <label className="mb-1.5 block text-sm text-[var(--theme-text-secondary)]">API Key</label>
          <ApiKeyInput
            provider={ai.provider as "openai" | "anthropic" | "gemini"}
            getApiKey={secureStorage.getApiKey}
            setApiKey={secureStorage.setApiKey}
            clearApiKey={secureStorage.clearApiKey}
          />
          <p className="mt-1 text-[11px] text-[var(--theme-text-soft)]">
            Stored encrypted on this device only. Never synced.
          </p>
        </div>
      )}
      {requiresKey && !secureStorage && (
        <p className="theme-feedback-panel-warning theme-feedback-text-warning-muted rounded-lg px-3 py-2 text-xs">
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
