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
import type { AIPreferences, LocalAIModelId } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import type {
  LocalAIModelDownloadProgress,
  LocalAIModelViewState,
} from "../../context/PlatformContext.js";
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

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${NUMBER_FORMAT.format(Number(value.toFixed(maximumFractionDigits)))} ${units[unitIndex]}`;
}

function formatLocalTime(timestamp?: number): string {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function applyDownloadProgress(
  models: LocalAIModelViewState[],
  progress: LocalAIModelDownloadProgress,
): LocalAIModelViewState[] {
  return models.map((model) => {
    if (model.manifest.id !== progress.id) return model;
    return {
      ...model,
      state: {
        ...model.state,
        status: "downloading",
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        updatedAt: Date.now(),
      },
    };
  });
}

function statusLabel(model: LocalAIModelViewState): string {
  const { status } = model.state;
  if (status === "available" && model.state.revision !== model.manifest.revision) {
    return "Update available";
  }
  switch (status) {
    case "available":
      return "Ready";
    case "downloading":
      return "Downloading";
    case "paused":
      return "Paused";
    case "error":
      return "Needs attention";
    case "unsupported":
      return "Unsupported";
    case "not_downloaded":
    default:
      return "Not installed";
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "available":
      return "bg-[rgb(var(--theme-feedback-success-rgb)/0.12)] text-[rgb(var(--theme-feedback-success-rgb))]";
    case "downloading":
      return "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_16%,transparent)] text-[var(--theme-accent-secondary)]";
    case "error":
    case "unsupported":
      return "bg-[rgb(var(--theme-feedback-danger-rgb)/0.12)] text-[rgb(var(--theme-feedback-danger-rgb))]";
    case "paused":
      return "bg-[rgb(var(--theme-feedback-warning-rgb)/0.16)] text-[rgb(var(--theme-feedback-warning-rgb))]";
    default:
      return "bg-[var(--theme-bg-muted)] text-[var(--theme-text-muted)]";
  }
}

function LocalModelCard({
  model,
  busy,
  onDownload,
  onPause,
  onRemove,
  onOpenSource,
}: {
  model: LocalAIModelViewState;
  busy: boolean;
  onDownload: (id: LocalAIModelId) => void;
  onPause: (id: LocalAIModelId) => void;
  onRemove: (id: LocalAIModelId) => void;
  onOpenSource: (url: string) => void;
}) {
  const progressTotal = model.state.totalBytes || model.manifest.estimatedDownloadBytes;
  const progress = progressTotal > 0
    ? Math.min(100, Math.round((model.state.downloadedBytes / progressTotal) * 100))
    : 0;
  const isDownloading = model.state.status === "downloading";
  const isAvailable = model.state.status === "available";
  const isUnsupported = model.state.status === "unsupported";
  const needsUpdate = isAvailable && model.state.revision !== model.manifest.revision;
  const actionDisabled = busy || isUnsupported;

  return (
    <div className="rounded-lg border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_82%,transparent)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--theme-text-primary)]">{model.manifest.title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(model.state.status)}`}>
              {statusLabel(model)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{model.manifest.description}</p>
        </div>
        <p className="shrink-0 rounded-full bg-[var(--theme-bg-muted)] px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)]">
          {model.manifest.capability}
        </p>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-[var(--theme-text-muted)] sm:grid-cols-2">
        <p>Download: <span className="text-[var(--theme-text-secondary)]">{formatBytes(model.manifest.estimatedDownloadBytes)}</span></p>
        <p>Storage: <span className="text-[var(--theme-text-secondary)]">{formatBytes(model.state.storageBytes || model.manifest.estimatedStorageBytes)}</span></p>
        <p>Indexed: <span className="text-[var(--theme-text-secondary)]">{NUMBER_FORMAT.format(model.state.health?.lastIndexedItemCount ?? 0)} items</span></p>
        <p>Last run: <span className="text-[var(--theme-text-secondary)]">{formatLocalTime(model.state.health?.lastRunAt)}</span></p>
      </div>

      <p className="mt-2 text-xs text-[var(--theme-text-soft)]">{model.manifest.hardwareNote}</p>

      {isDownloading && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--theme-bg-muted)]">
            <div
              className="h-full rounded-full bg-[var(--theme-accent-secondary)] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">
            {formatBytes(model.state.downloadedBytes)} of {formatBytes(progressTotal)}
          </p>
        </div>
      )}

      {model.state.lastError && (
        <p className="mt-3 rounded-lg bg-[rgb(var(--theme-feedback-danger-rgb)/0.08)] px-3 py-2 text-xs text-[rgb(var(--theme-feedback-danger-rgb))]">
          {model.state.lastError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isDownloading ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPause(model.manifest.id)}
            className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          >
            Pause
          </button>
        ) : isAvailable && !needsUpdate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(model.manifest.id)}
            className="theme-feedback-button-danger rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={() => onDownload(model.manifest.id)}
            className="theme-accent-button rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          >
            {needsUpdate ? "Update" : model.state.status === "paused" ? "Resume" : "Download"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenSource(model.manifest.sourceUrl)}
          className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-xs transition-colors"
        >
          Source
        </button>
      </div>
    </div>
  );
}

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
  const { secureStorage, localAIModels, openUrl } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const ai: AIPreferences = preferences.ai ?? {
    provider: "none",
    model: "",
    autoSummarize: false,
    extractTopics: false,
  };

  const [showOllamaUrl, setShowOllamaUrl] = useState(false);
  const [localModels, setLocalModels] = useState<LocalAIModelViewState[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [busyModelId, setBusyModelId] = useState<LocalAIModelId | null>(null);
  const ollamaUrl = ai.ollamaUrl ?? "http://localhost:11434";

  const refreshLocalModels = useCallback(async () => {
    if (!localAIModels) return;
    setLocalModelsLoading(true);
    try {
      setLocalModels(await localAIModels.listModels());
    } finally {
      setLocalModelsLoading(false);
    }
  }, [localAIModels]);

  useEffect(() => {
    void refreshLocalModels();
  }, [refreshLocalModels]);

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

  const handleDownloadLocalModel = useCallback((id: LocalAIModelId) => {
    if (!localAIModels) return;
    setBusyModelId(id);
    void localAIModels
      .downloadModel(id, (progress) => {
        setLocalModels((current) => applyDownloadProgress(current, progress));
      })
      .then(setLocalModels)
      .finally(() => setBusyModelId(null));
  }, [localAIModels]);

  const handlePauseLocalModel = useCallback((id: LocalAIModelId) => {
    if (!localAIModels) return;
    setBusyModelId(id);
    void localAIModels.pauseDownload(id).then(setLocalModels).finally(() => setBusyModelId(null));
  }, [localAIModels]);

  const handleRemoveLocalModel = useCallback((id: LocalAIModelId) => {
    if (!localAIModels) return;
    setBusyModelId(id);
    void localAIModels.removeModel(id).then(setLocalModels).finally(() => setBusyModelId(null));
  }, [localAIModels]);

  const handleOpenSource = useCallback((url: string) => {
    if (openUrl) {
      openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [openUrl]);

  return (
    <div className="space-y-4">
      {localAIModels && (
        <div className="space-y-3" data-testid="local-ai-model-settings">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
              Optional Local AI
            </h3>
            <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
              Model packs stay out of the installer and are downloaded only when you turn them on here.
            </p>
          </div>
          {localModelsLoading && localModels.length === 0 ? (
            <p className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
              Checking local model state...
            </p>
          ) : (
            <div className="space-y-3">
              {localModels.map((model) => (
                <LocalModelCard
                  key={model.manifest.id}
                  model={model}
                  busy={busyModelId === model.manifest.id}
                  onDownload={handleDownloadLocalModel}
                  onPause={handlePauseLocalModel}
                  onRemove={handleRemoveLocalModel}
                  onOpenSource={handleOpenSource}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Cloud And Ollama Summaries
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
