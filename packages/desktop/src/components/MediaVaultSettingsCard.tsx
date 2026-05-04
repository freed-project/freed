import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { FeedItem } from "@freed/shared";
import { SettingsToggle } from "@freed/ui/components/SettingsToggle";
import { toast } from "@freed/ui/components/Toast";
import {
  archiveRecentProviderMedia,
  getMediaVaultProviderDir,
  setMediaVaultEnabled,
  subscribeMediaVault,
  summarizeMediaVault,
  type MediaVaultProvider,
  type MediaVaultSummary,
} from "../lib/media-vault";
import { importMetaExportFiles } from "../lib/meta-export-import";

interface MediaVaultSettingsCardProps {
  provider: MediaVaultProvider;
  providerLabel: string;
  items: FeedItem[];
  authenticated: boolean;
}

type JobKind = "import" | "backup" | "backfill" | null;

const BYTE_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${BYTE_FORMAT.format(value)} ${units[index]}`;
}

function formatDate(value: number | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function emptySummary(): MediaVaultSummary {
  return {
    enabled: false,
    fileCount: 0,
    byteSize: 0,
    failureCount: 0,
    ownerHandles: [],
  };
}

export function MediaVaultSettingsCard({
  provider,
  providerLabel,
  items,
  authenticated,
}: MediaVaultSettingsCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [summary, setSummary] = useState<MediaVaultSummary>(() => emptySummary());
  const [job, setJob] = useState<JobKind>(null);

  const providerItems = useMemo(
    () => items.filter((item) => item.platform === provider),
    [items, provider],
  );

  const refreshSummary = useCallback(() => {
    void summarizeMediaVault(provider).then(setSummary);
  }, [provider]);

  useEffect(() => {
    refreshSummary();
    return subscribeMediaVault(refreshSummary);
  }, [refreshSummary]);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      await setMediaVaultEnabled(provider, enabled);
      refreshSummary();
    },
    [provider, refreshSummary],
  );

  const handleImportFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setJob("import");
      try {
        const result = await importMetaExportFiles(provider, files);
        toast.success(
          `Imported ${result.imported.toLocaleString()} ${providerLabel} media file${result.imported === 1 ? "" : "s"}`,
        );
        refreshSummary();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not import ${providerLabel} export`);
      } finally {
        setJob(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [provider, providerLabel, refreshSummary],
  );

  const handleBackupNow = useCallback(async () => {
    setJob("backup");
    try {
      const count = await archiveRecentProviderMedia(provider, providerItems, "continuous");
      if (count === 0 && summary.ownerHandles.length === 0) {
        toast.info(`Import a Meta export first so Freed can identify your ${providerLabel} account.`);
      } else {
        toast.success(`Archived ${count.toLocaleString()} ${providerLabel} media file${count === 1 ? "" : "s"}`);
      }
      refreshSummary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not archive ${providerLabel} media`);
    } finally {
      setJob(null);
    }
  }, [provider, providerItems, providerLabel, refreshSummary, summary.ownerHandles.length]);

  const handleBackfill = useCallback(async () => {
    setJob("backfill");
    try {
      const count = await archiveRecentProviderMedia(provider, providerItems, "profile_backfill");
      if (count === 0 && summary.ownerHandles.length === 0) {
        toast.info(`Import a Meta export first, then profile backfill can match your ${providerLabel} handle.`);
      } else {
        toast.success(`Backfilled ${count.toLocaleString()} ${providerLabel} media file${count === 1 ? "" : "s"}`);
      }
      refreshSummary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not backfill ${providerLabel} media`);
    } finally {
      setJob(null);
    }
  }, [provider, providerItems, providerLabel, refreshSummary, summary.ownerHandles.length]);

  const handleOpenFolder = useCallback(async () => {
    const providerDir = await getMediaVaultProviderDir(provider);
    await shellOpen(providerDir);
  }, [provider]);

  const busy = job !== null;
  const jobLabel =
    job === "import"
      ? "Importing"
      : job === "backup"
        ? "Backing up"
        : job === "backfill"
          ? "Backfilling"
          : null;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <SettingsToggle
        label="Back up my uploaded media"
        checked={summary.enabled}
        onChange={(enabled) => {
          void handleToggle(enabled);
        }}
        description={`${providerLabel} photos and videos are archived locally forever. They are not synced.`}
      />

      <div className="grid gap-2 text-xs text-[#71717a] sm:grid-cols-2">
        <div>
          <span className="text-[#52525b]">Files</span>{" "}
          <span>{summary.fileCount.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-[#52525b]">Size</span>{" "}
          <span>{formatBytes(summary.byteSize)}</span>
        </div>
        <div>
          <span className="text-[#52525b]">Last backup</span>{" "}
          <span>{formatDate(summary.lastSuccessAt)}</span>
        </div>
        <div>
          <span className="text-[#52525b]">Known account</span>{" "}
          <span>{summary.ownerHandles[0] ? `@${summary.ownerHandles[0]}` : "Not set"}</span>
        </div>
      </div>

      {jobLabel ? (
        <p className="text-xs text-[#a1a1aa]">{jobLabel}...</p>
      ) : null}

      {summary.lastError ? (
        <p className="text-xs leading-relaxed text-red-400">{summary.lastError}</p>
      ) : null}

      {summary.failureCount > 0 ? (
        <p className="text-xs leading-relaxed text-amber-400">
          {summary.failureCount.toLocaleString()} media download failure
          {summary.failureCount === 1 ? "" : "s"} will retry later.
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        multiple
        onChange={(event) => {
          void handleImportFiles(event.currentTarget.files);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Import Meta export
        </button>
        <button
          type="button"
          onClick={() => {
            void handleBackfill();
          }}
          disabled={busy || !summary.enabled || !authenticated}
          className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Backfill from profile
        </button>
        <button
          type="button"
          onClick={() => {
            void handleBackupNow();
          }}
          disabled={busy || !summary.enabled || !authenticated}
          className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Back up now
        </button>
        <button
          type="button"
          onClick={() => {
            void handleOpenFolder();
          }}
          disabled={busy}
          className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Open vault folder
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[#52525b]">
        Use Meta export for all history. Profile backfill only saves media Freed can match to your known account handle.
      </p>
    </div>
  );
}
