import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  formatReleaseVersion,
  getWebsiteHostForChannel,
  RELEASE_CHANNEL_LABELS,
} from "@freed/shared";
import {
  checkDesktopUpdate,
  installPendingDesktopUpdate,
  JUST_UPDATED_KEY,
  type PendingDesktopUpdate,
  resolveDesktopDownloadFallbackUrl,
} from "../lib/desktop-updater";
import {
  bootstrapDesktopReleaseChannel,
  loadDesktopReleaseChannelState,
  persistDesktopInstalledReleaseChannel,
  persistDesktopReleaseChannel,
} from "../lib/release-channel";
import { extractUpdatePreviewLine } from "../lib/update-release-preview";

type RecoveryStatus =
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available" }
  | { kind: "downloading"; percent: number }
  | { kind: "error"; message: string };

const RETRY_COMMAND = "retry_startup_after_crash";

export function StartupRecoveryScreen() {
  const [releaseChannel, setReleaseChannel] = useState(() => bootstrapDesktopReleaseChannel());
  const [installedReleaseChannel, setInstalledReleaseChannel] = useState(() =>
    bootstrapDesktopReleaseChannel(),
  );
  const [releaseChannelResolved, setReleaseChannelResolved] = useState(false);
  const [status, setStatus] = useState<RecoveryStatus>({ kind: "checking" });
  const [pendingUpdate, setPendingUpdate] = useState<PendingDesktopUpdate | null>(null);
  const [fallbackDownloadUrl, setFallbackDownloadUrl] = useState(
    `https://${getWebsiteHostForChannel(releaseChannel)}/get`,
  );
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadDesktopReleaseChannelState()
      .then(({ selectedChannel, installedChannel }) => {
        if (!cancelled) {
          setReleaseChannel(selectedChannel);
          setInstalledReleaseChannel(installedChannel);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReleaseChannelResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!releaseChannelResolved) return;

    async function loadRecoveryUpdate() {
      try {
        const resolvedFallbackUrl = await resolveDesktopDownloadFallbackUrl(releaseChannel);
        setFallbackDownloadUrl(resolvedFallbackUrl);

        const availableUpdate = await checkDesktopUpdate(releaseChannel);

        if (availableUpdate) {
          setPendingUpdate(availableUpdate);
          setFallbackDownloadUrl(availableUpdate.fallbackDownloadUrl);
          setStatus({ kind: "available" });
          return;
        }

        setPendingUpdate(null);
        setStatus({ kind: "up-to-date" });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Update check failed.",
        });
      }
    }

    void loadRecoveryUpdate();
  }, [releaseChannel, releaseChannelResolved]);

  const handleRetry = useCallback(async () => {
    setRetryBusy(true);
    setActionNotice(null);
    try {
      await invoke(RETRY_COMMAND);
      setActionNotice(
        "Retry launched. This window will close after Freed reaches a healthy startup state.",
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Retry failed.",
      });
    } finally {
      setRetryBusy(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!pendingUpdate) return;

    setActionNotice(null);
    setStatus({ kind: "downloading", percent: 0 });

    try {
      const version = await installPendingDesktopUpdate(pendingUpdate, (progress) => {
        if (progress.phase === "downloading") {
          setStatus({ kind: "downloading", percent: progress.percent });
          return;
        }

        setStatus({ kind: "available" });
      });
      await persistDesktopInstalledReleaseChannel(pendingUpdate.channel);
      setInstalledReleaseChannel(pendingUpdate.channel);
      await persistDesktopReleaseChannel(releaseChannel);
      localStorage.setItem(JUST_UPDATED_KEY, version);
      await relaunch();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Install failed.",
      });
    }
  }, [pendingUpdate, releaseChannel]);

  const handleDownload = useCallback(async () => {
    setDownloadBusy(true);
    setActionNotice(null);
    try {
      await shellOpen(fallbackDownloadUrl);
      setActionNotice(
        "Browser opened. Install the latest build over this one, then relaunch Freed.",
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not open the browser download.",
      });
    } finally {
      setDownloadBusy(false);
    }
  }, [fallbackDownloadUrl]);

  const updateLabel = useMemo(() => {
    if (!pendingUpdate) return null;
    return `Update available on ${
      RELEASE_CHANNEL_LABELS[pendingUpdate.channel]
    }, v${formatReleaseVersion(pendingUpdate.update.version, pendingUpdate.channel)}`;
  }, [pendingUpdate]);

  const updatePreview = useMemo(() => {
    return pendingUpdate?.update.body
      ? extractUpdatePreviewLine(pendingUpdate.update.body)
      : null;
  }, [pendingUpdate]);

  const statusLine = actionNotice ?? getStatusLine(status, pendingUpdate);
  const statusIsError = !actionNotice && status.kind === "error";

  return (
    <main className="min-h-screen bg-transparent px-7 py-7 text-[var(--theme-text-primary)]">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-[560px] items-center">
        <section className="theme-dialog-shell w-full rounded-[24px] p-8 shadow-2xl shadow-black/50">
          <h1 className="text-4xl font-semibold leading-[1.05]">
            Freed did not finish loading last time.
          </h1>

          <div className="theme-feedback-panel-danger mt-5 rounded-[18px] p-4">
            <p className="text-base leading-7 text-[var(--theme-text-primary)]">
              Keep this window open while you retry. It will close itself after Freed reaches a
              healthy startup state.
            </p>
          </div>

          {updateLabel ? (
            <div className="mt-5 rounded-[18px] border border-[rgba(124,92,255,0.24)] bg-[rgba(124,92,255,0.1)] p-4">
              <p className="text-sm font-semibold text-[var(--theme-text-primary)]">{updateLabel}</p>
              {updatePreview ? (
                <p className="mt-1 text-sm leading-6 text-[var(--theme-text-muted)]">{updatePreview}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              id="retry"
              type="button"
              onClick={handleRetry}
              disabled={retryBusy}
              className="theme-accent-button min-h-[52px] rounded-[14px] px-5 py-3 text-base font-semibold"
            >
              {retryBusy ? "Trying to reopen Freed..." : "Try opening Freed again"}
            </button>

            {pendingUpdate ? (
              <button
                id="install-update"
                type="button"
                onClick={handleInstall}
                disabled={status.kind === "downloading"}
                className="rounded-[14px] border border-[rgba(124,92,255,0.28)] bg-[rgba(124,92,255,0.12)] px-5 py-3 text-base font-semibold text-[var(--theme-text-primary)] transition-colors hover:bg-[rgba(124,92,255,0.2)] disabled:cursor-wait disabled:opacity-70"
              >
                {status.kind === "downloading"
                  ? `Downloading ${Math.round(status.percent)}%`
                  : "Install update and restart"}
              </button>
            ) : null}

            <button
              id="download"
              type="button"
              onClick={handleDownload}
              disabled={downloadBusy}
              className="rounded-[14px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.07)] px-5 py-3 text-base font-semibold text-[var(--theme-text-primary)] transition-colors hover:bg-[rgba(255,255,255,0.12)] disabled:cursor-wait disabled:opacity-70"
            >
              {downloadBusy ? "Opening browser..." : "Download latest Freed Desktop"}
            </button>
          </div>

          <p
            id="status"
            className={`mt-5 min-h-[22px] text-sm leading-6 ${
              statusIsError ? "text-[var(--theme-text-danger)]" : "text-[var(--theme-text-muted)]"
            }`}
            aria-live="polite"
          >
            {statusLine}
          </p>

          <p className="mt-5 text-xs text-[var(--theme-text-muted)]">
            Version {formatReleaseVersion(__APP_VERSION__, installedReleaseChannel)}
          </p>
        </section>
      </div>
    </main>
  );
}

function getStatusLine(
  status: RecoveryStatus,
  pendingUpdate: PendingDesktopUpdate | null,
): string {
  switch (status.kind) {
    case "checking":
      return "Checking for updates...";
    case "up-to-date":
      return "Freed is up to date. You can retry opening it, or download the latest installer in your browser.";
    case "available":
      return pendingUpdate
        ? "An update is available. Install it in place, or use the browser download fallback."
        : "An update is available.";
    case "downloading":
      return `Downloading update... ${Math.round(status.percent)}%`;
    case "error":
      return status.message;
  }
}
