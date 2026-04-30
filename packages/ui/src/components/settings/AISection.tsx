/**
 * AI settings section for the Settings panel.
 *
 * Provider preferences sync through Automerge. API keys stay device-local.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AIPreferences, LocalAIModelId } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import type {
  LocalAIModelDownloadProgress,
  LocalAIModelViewState,
} from "../../context/PlatformContext.js";
import { SettingsToggle } from "../SettingsToggle.js";

type AIProvider = AIPreferences["provider"];
type CloudAIProvider = Extract<AIProvider, "openai" | "anthropic" | "gemini">;

const DEFAULT_MODELS: Record<AIProvider, string> = {
  none: "",
  integrated: "",
  ollama: "qwen2.5:1.5b",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.0-flash",
};

const PROVIDER_OPTIONS: Array<{
  id: AIProvider;
  label: string;
  eyebrow: string;
  description: string;
  sharing: string;
}> = [
  {
    id: "none",
    label: "Off",
    eyebrow: "Default",
    description: "Rules-only intelligence. No model downloads, endpoint calls, or API keys.",
    sharing: "Shares nothing",
  },
  {
    id: "integrated",
    label: "Integrated AI",
    eyebrow: "Recommended",
    description: "Freed-managed local AI pack for ranking, summaries, and extraction when installed.",
    sharing: "Keeps content on this device",
  },
  {
    id: "ollama",
    label: "Ollama",
    eyebrow: "Local endpoint",
    description: "Use your own Ollama server and model names.",
    sharing: "Sends content to your endpoint",
  },
  {
    id: "openai",
    label: "OpenAI",
    eyebrow: "API",
    description: "Use an OpenAI model for summaries and structured extraction.",
    sharing: "Sends enabled AI text to OpenAI",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    eyebrow: "API",
    description: "Use a Claude model for summaries and structured extraction.",
    sharing: "Sends enabled AI text to Anthropic",
  },
  {
    id: "gemini",
    label: "Gemini",
    eyebrow: "API",
    description: "Use a Gemini model for summaries and structured extraction.",
    sharing: "Sends enabled AI text to Google",
  },
];

const PROVIDER_LABELS = Object.fromEntries(
  PROVIDER_OPTIONS.map((option) => [option.id, option.label]),
) as Record<AIProvider, string>;

const CLOUD_PROVIDERS = new Set<AIProvider>(["openai", "anthropic", "gemini"]);
const NUMBER_FORMAT = new Intl.NumberFormat();

function isCloudProvider(provider: AIProvider): provider is CloudAIProvider {
  return CLOUD_PROVIDERS.has(provider);
}

function getAIProviderSharingLabel(provider: AIProvider): string {
  const active = PROVIDER_OPTIONS.find((option) => option.id === provider) ?? PROVIDER_OPTIONS[0]!;
  return active.sharing;
}

function sameAIPreferences(left: AIPreferences, right: AIPreferences): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.ollamaUrl === right.ollamaUrl &&
    left.autoSummarize === right.autoSummarize &&
    left.extractTopics === right.extractTopics
  );
}

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

function sharingCopy(provider: AIProvider): string {
  if (provider === "none") {
    return "AI is off. Freed still runs deterministic rules for content signals, and nothing is sent to a model.";
  }
  if (provider === "integrated") {
    return "Integrated AI keeps content, vectors, summaries, and model cache data on this device. Model files download only after you press Download.";
  }
  if (provider === "ollama") {
    return "Freed sends enabled AI text to your Ollama endpoint. Prompts and responses are not synced by Freed.";
  }
  return `Freed sends enabled AI text to ${PROVIDER_LABELS[provider]}. API keys stay on this device and are never synced.`;
}

function ProviderSelector({
  value,
  onChange,
}: {
  value: AIProvider;
  onChange: (provider: AIProvider) => void;
}) {
  return (
    <section className="space-y-3" data-testid="ai-provider-selector">
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDER_OPTIONS.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`min-h-[118px] rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--theme-accent-secondary)_38%,transparent)] ${
                selected
                  ? "border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_54%,var(--theme-border-subtle))] bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_12%,var(--theme-bg-surface))]"
                  : "border-[var(--theme-border-subtle)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_78%,transparent)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-bg-muted)]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--theme-text-primary)]">
                  {option.label}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  selected
                    ? "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_18%,transparent)] text-[var(--theme-accent-secondary)]"
                    : "bg-[var(--theme-bg-muted)] text-[var(--theme-text-soft)]"
                }`}
                >
                  {option.eyebrow}
                </span>
              </span>
              <span className="mt-2 block text-xs leading-5 text-[var(--theme-text-muted)]">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      <p className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-2 text-xs leading-5 text-[var(--theme-text-muted)]">
        {sharingCopy(value)}
      </p>
    </section>
  );
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
          <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">{model.manifest.description}</p>
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

      <p className="mt-2 text-xs leading-5 text-[var(--theme-text-soft)]">{model.manifest.hardwareNote}</p>

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
        <p className="mt-3 rounded-lg bg-[rgb(var(--theme-feedback-danger-rgb)/0.08)] px-3 py-2 text-xs leading-5 text-[rgb(var(--theme-feedback-danger-rgb))]">
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

function OllamaStatus({ url }: { url: string }) {
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2_000) })
      .then((response) => { if (!cancelled) setReachable(response.ok); })
      .catch(() => { if (!cancelled) setReachable(false); });
    return () => { cancelled = true; };
  }, [url]);

  if (reachable === null) return null;
  return (
    <span
      title={reachable ? "Ollama is running" : "Ollama is not reachable"}
      className={`inline-block h-2 w-2 rounded-full ${reachable ? "bg-[rgb(var(--theme-feedback-success-rgb)/0.92)]" : "bg-[var(--theme-text-soft)]"}`}
    />
  );
}

function ApiKeyInput({
  provider,
  getApiKey,
  setApiKey,
  clearApiKey,
}: {
  provider: CloudAIProvider;
  getApiKey: (p: string) => Promise<string | null>;
  setApiKey: (p: string, key: string) => Promise<void>;
  clearApiKey: (p: string) => Promise<void>;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getApiKey(provider).then((key) => setHasSaved(!!key));
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
    <div className="flex items-center gap-2">
      <input
        type="password"
        value={hasSaved && !keyDraft ? "****************" : keyDraft}
        onChange={(event) => {
          setHasSaved(false);
          setKeyDraft(event.target.value);
        }}
        onFocus={() => {
          if (hasSaved) setHasSaved(false);
        }}
        placeholder="Paste API key"
        className="flex-1 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:border-[var(--theme-border-strong)] focus:outline-none"
        spellCheck={false}
        autoComplete="off"
      />
      {!hasSaved ? (
        <button
          type="button"
          onClick={handleSave}
          disabled={!keyDraft.trim() || saving}
          className="theme-accent-button rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
        >
          {saving ? "Saving" : "Save"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClear}
          className="rounded-lg px-3 py-1.5 text-xs text-[color:var(--theme-text-muted)] transition-colors hover:bg-[rgb(var(--theme-feedback-danger-rgb)/0.1)] hover:text-[rgb(var(--theme-feedback-danger-rgb))]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function ModelNameField({
  provider,
  value,
  onChange,
}: {
  provider: AIProvider;
  value: string;
  onChange: (value: string) => void;
}) {
  if (provider === "none" || provider === "integrated") return null;

  return (
    <div>
      <label className="mb-1.5 block text-sm text-[var(--theme-text-secondary)]">Model</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={DEFAULT_MODELS[provider] || "Model name"}
        className="w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:border-[var(--theme-border-strong)] focus:outline-none"
      />
    </div>
  );
}

export function AISection() {
  const { secureStorage, localAIModels, openUrl } = usePlatform();
  const preferences = useAppStore((state) => state.preferences);
  const updatePreferences = useAppStore((state) => state.updatePreferences);

  const ai: AIPreferences = preferences.ai ?? {
    provider: "none",
    model: "",
    autoSummarize: false,
    extractTopics: false,
  };

  const [optimisticAI, setOptimisticAI] = useState<AIPreferences | null>(null);
  const [showOllamaUrl, setShowOllamaUrl] = useState(false);
  const [localModels, setLocalModels] = useState<LocalAIModelViewState[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [busyModelId, setBusyModelId] = useState<LocalAIModelId | null>(null);
  const displayedAI = optimisticAI ?? ai;
  const ollamaUrl = displayedAI.ollamaUrl ?? "http://localhost:11434";
  const cloudProvider = isCloudProvider(displayedAI.provider) ? displayedAI.provider : null;
  const requiresKey = cloudProvider !== null;
  const selectedProviderLabel = PROVIDER_LABELS[displayedAI.provider];

  useEffect(() => {
    if (optimisticAI && sameAIPreferences(optimisticAI, ai)) {
      setOptimisticAI(null);
    }
  }, [ai, optimisticAI]);

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
    if (displayedAI.provider === "integrated") {
      void refreshLocalModels();
    }
  }, [displayedAI.provider, refreshLocalModels]);

  const update = useCallback(
    (patch: Partial<AIPreferences>) => {
      const nextAI = { ...displayedAI, ...patch };
      setOptimisticAI(nextAI);
      void updatePreferences({ ai: nextAI });
    },
    [displayedAI, updatePreferences],
  );

  const handleProviderChange = (provider: AIProvider) => {
    if (provider === displayedAI.provider) return;
    const enablingFromOff = displayedAI.provider === "none" && provider !== "none";
    const disabling = provider === "none";
    update({
      provider,
      model: DEFAULT_MODELS[provider],
      autoSummarize: disabling ? false : enablingFromOff ? true : displayedAI.autoSummarize,
      extractTopics: disabling ? false : enablingFromOff ? true : displayedAI.extractTopics,
    });
  };

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

  const featureDescriptions = useMemo(() => {
    if (displayedAI.provider === "integrated") {
      return {
        summarize: "Uses the installed local AI pack. Nothing leaves this device.",
        topics: "Uses the installed local AI pack after rules run. Vectors stay device-local.",
      };
    }
    if (displayedAI.provider === "ollama") {
      return {
        summarize: "Sends article text to your Ollama endpoint when content is cached.",
        topics: "Uses topics returned by your Ollama model to improve ranking.",
      };
    }
    return {
      summarize: `Sends article text to ${selectedProviderLabel} when content is cached. API costs may apply.`,
      topics: `Uses topics returned by ${selectedProviderLabel} to improve ranking.`,
    };
  }, [displayedAI.provider, selectedProviderLabel]);

  return (
    <div className="space-y-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          AI
        </h3>
        <span
          className="shrink-0 rounded-full bg-[var(--theme-bg-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)]"
          data-testid="ai-provider-sharing-label"
        >
          {getAIProviderSharingLabel(displayedAI.provider)}
        </span>
      </div>

      <ProviderSelector value={displayedAI.provider} onChange={handleProviderChange} />

      {displayedAI.provider === "integrated" && (
        <section className="space-y-3" data-testid="local-ai-model-settings">
          <div>
            <h3 className="text-xs font-semibold uppercase text-[var(--theme-text-muted)]">
              Integrated AI Download
            </h3>
            <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">
              Freed Desktop does not ship model weights. Download the local pack when you want Integrated AI.
            </p>
          </div>
          {!localAIModels ? (
            <p className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-2 text-xs leading-5 text-[var(--theme-text-muted)]">
              Integrated downloads are available in Freed Desktop.
            </p>
          ) : localModelsLoading && localModels.length === 0 ? (
            <p className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
              Checking local model state
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
        </section>
      )}

      {displayedAI.provider === "ollama" && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase text-[var(--theme-text-muted)]">
            Ollama Connection
          </h3>
          <div className="rounded-lg border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_82%,transparent)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--theme-text-muted)]">
              <OllamaStatus url={ollamaUrl} />
              <span>Endpoint: {ollamaUrl}</span>
              <button
                type="button"
                onClick={() => setShowOllamaUrl((value) => !value)}
                className="text-xs text-[var(--theme-text-soft)] underline transition-colors hover:text-[var(--theme-accent-secondary)]"
              >
                {showOllamaUrl ? "Hide" : "Change"}
              </button>
            </div>
            {showOllamaUrl && (
              <input
                type="url"
                value={displayedAI.ollamaUrl ?? ""}
                onChange={(event) => update({ ollamaUrl: event.target.value || undefined })}
                placeholder="http://localhost:11434"
                className="mt-3 w-full rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-1.5 font-mono text-sm text-[var(--theme-text-secondary)] placeholder-[var(--theme-text-soft)] transition-colors focus:border-[var(--theme-border-strong)] focus:outline-none"
              />
            )}
          </div>
          <ModelNameField
            provider={displayedAI.provider}
            value={displayedAI.model}
            onChange={(model) => update({ model })}
          />
        </section>
      )}

      {requiresKey && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase text-[var(--theme-text-muted)]">
            {selectedProviderLabel} Connection
          </h3>
          <ModelNameField
            provider={displayedAI.provider}
            value={displayedAI.model}
            onChange={(model) => update({ model })}
          />
          {secureStorage ? (
            <div>
              <label className="mb-1.5 block text-sm text-[var(--theme-text-secondary)]">API Key</label>
              <ApiKeyInput
                provider={cloudProvider}
                getApiKey={secureStorage.getApiKey}
                setApiKey={secureStorage.setApiKey}
                clearApiKey={secureStorage.clearApiKey}
              />
              <p className="mt-1 text-[11px] text-[var(--theme-text-soft)]">
                Stored encrypted on this device. Never synced.
              </p>
            </div>
          ) : (
            <p className="theme-feedback-panel-warning theme-feedback-text-warning-muted rounded-lg px-3 py-2 text-xs leading-5">
              API key storage is available in Freed Desktop.
            </p>
          )}
        </section>
      )}

      {displayedAI.provider !== "none" && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase text-[var(--theme-text-muted)]">
            Enabled Workflows
          </h3>
          <SettingsToggle
            label="Summaries and extraction"
            description={featureDescriptions.summarize}
            checked={displayedAI.autoSummarize}
            onChange={(value) => update({ autoSummarize: value })}
          />
          <SettingsToggle
            label="Topics and ranking"
            description={featureDescriptions.topics}
            checked={displayedAI.extractTopics}
            onChange={(value) => update({ extractTopics: value })}
          />
        </section>
      )}
    </div>
  );
}
