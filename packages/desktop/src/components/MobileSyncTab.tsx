/** Google Drive controls for the SQLite Library shared by Desktop and PWA. */

import { describeLibraryFollowerProgress } from "../lib/library-core-follower-status";
import { useCallback, useEffect, useState } from "react";
import type { CloudProvider } from "@freed/ui/components/CloudProviderCard";
import {
  useDebugStore,
  type CloudProviderDebugState,
} from "@freed/ui/lib/debug-store";
import { copyExactJsonToClipboard } from "@freed/ui/lib/clipboard";
import {
  syncCloudProviderNow,
} from "../lib/sync";
import { useCloudProviders } from "../hooks/useCloudProviders";
import { CloudProviderCard } from "./CloudProviderCard";
import { DesktopSnapshotsSection } from "./DesktopSnapshotsSection";
import { LibraryHandoffPanel } from "./LibraryHandoffPanel";
import { ConsumerRecoveryReview } from "./ConsumerRecoveryReview";
import {
  readLibraryCoreDesktopRole,
  refreshLibraryCoreDesktopRole,
  type LibraryCoreDesktopRole,
} from "../lib/library-core-desktop-role";
import {
  readNormalizedLibraryFollowerRuntimeStatus,
  readNormalizedLibraryConsumerRecovery,
  type NormalizedLibraryConsumerRecoverySummary,
  type NormalizedLibraryFollowerRuntimeStatus,
} from "../lib/sqlite-library";
import {
  readSqliteLibraryGoogleDrivePublicationReceipt,
  type LibraryCorePublishedCheckpointReceiptV1,
} from "../lib/library-core-cloud-sync";

import { prepareDesktopLibraryConsumerRecovery, commitDesktopLibraryConsumerRecovery } from "../lib/library-core-handoff";

function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number") return "-";
  if (bytes < 1_024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / (1_024 * 1_024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
}

function formatRelativeTime(timestamp?: number): string {
  if (typeof timestamp !== "number") return "-";
  const seconds = Math.floor((Date.now() - timestamp) / 1_000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes.toLocaleString()}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString()}h ago`;
  return `${Math.floor(hours / 24).toLocaleString()}d ago`;
}

function DiagnosticCell({
  label,
  value,
  title = value,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--theme-bg-muted)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-soft)]">
        {label}
      </p>
      <p
        title={title}
        className="mt-1 truncate font-mono text-xs tabular-nums text-[var(--theme-text-secondary)]"
      >
        {value}
      </p>
    </div>
  );
}

function formatIdentityTail(value: string): string {
  return value.length <= 8 ? value : `...${value.slice(-8)}`;
}

function describeUploadGap(state: CloudProviderDebugState | null): string {
  if (!state) return "Connect Google Drive to start SQLite Library sync.";
  if (state.error) return "Sync needs attention before the next publication.";
  if (state.stage === "upload")
    return "Publishing immutable Library objects now.";
  if (state.pendingReason) return state.pendingReason;
  if (state.lastUploadAt) return "Waiting for the next local SQLite revision.";
  return "Use Sync now to publish the current SQLite Library revision.";
}

function isWriterOwnershipWarning(message?: string | null): boolean {
  return (
    message?.includes("Another Freed Desktop currently owns writes") ?? false
  );
}


export function MobileSyncTab() {
  const librarySnapshot = useDebugStore((state) => state.librarySnapshot);
  const cloudProviders = useDebugStore((state) => state.cloudProviders);
  const { providers, connect, cancelConnect, disconnect } = useCloudProviders();
  const [cancelProvider, setCancelProvider] = useState<CloudProvider | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [consumerRecovery, setConsumerRecovery] = useState<NormalizedLibraryConsumerRecoverySummary | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [desktopRole, setDesktopRole] = useState<LibraryCoreDesktopRole | null>(() =>
    readLibraryCoreDesktopRole(),
  );
  const [followerStatus, setFollowerStatus] =
    useState<NormalizedLibraryFollowerRuntimeStatus | null>(null);
  const [followerStatusError, setFollowerStatusError] = useState<string | null>(
    null,
  );
  const [publicationReceipt, setPublicationReceipt] =
    useState<LibraryCorePublishedCheckpointReceiptV1 | null>(null);
  const [publicationReceiptError, setPublicationReceiptError] = useState<
    string | null
  >(null);
  const [publicationReceiptCopied, setPublicationReceiptCopied] =
    useState(false);
  const driveState = cloudProviders?.gdrive ?? null;
  const driveCardState =
    driveState === null
      ? providers.gdrive
      : driveState.status === "error"
        ? {
            status: "error" as const,
            error: driveState.error ?? "Cloud sync failed.",
          }
        : { status: driveState.status };
  const connected = driveCardState.status === "connected";
  const diagnosticError = driveState?.error ?? manualError;
  const publishing = driveState?.stage === "upload" || syncing;
  useEffect(() => {
    let disposed = false;
    void refreshLibraryCoreDesktopRole().then((status) => {
      if (!disposed) setDesktopRole(status.role);
    }).catch((error) => {
      if (!disposed) {
        setDesktopRole(null);
        setManualError(error instanceof Error ? error.message : "Native Library role is unavailable.");
      }
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (desktopRole !== "follower") {
      setFollowerStatus(null);
      setConsumerRecovery(null);
      setFollowerStatusError(null);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const [status, recovery] = await Promise.all([
          readNormalizedLibraryFollowerRuntimeStatus(), readNormalizedLibraryConsumerRecovery(),
        ]);
        if (!disposed) {
          setFollowerStatus(status);
          setConsumerRecovery(recovery);
          setFollowerStatusError(null);
        }
      } catch (error) {
        if (!disposed) {
          setFollowerStatusError(
            error instanceof Error
              ? error.message
              : "Follower diagnostics are unavailable.",
          );
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [desktopRole]);

  const recoverConsumer = async () => {
    setRecovering(true);
    setManualError(null);
    try {
      const recovery = consumerRecovery?.state === "prepared"
        ? await commitDesktopLibraryConsumerRecovery(consumerRecovery.recoveryId)
        : await prepareDesktopLibraryConsumerRecovery();
      setConsumerRecovery(recovery);
      setFollowerStatus(await readNormalizedLibraryFollowerRuntimeStatus());
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Consumer recovery could not finish.");
    } finally {
      setRecovering(false);
    }
  };

  const refreshPublicationReceipt = useCallback(async () => {
    try {
      setPublicationReceipt(
        await readSqliteLibraryGoogleDrivePublicationReceipt(),
      );
      setPublicationReceiptError(null);
    } catch (error) {
      setPublicationReceiptError(
        error instanceof Error
          ? error.message
          : "Checkpoint receipt is unavailable.",
      );
    }
  }, []);

  const copyPublicationReceipt = useCallback(async () => {
    if (!publicationReceipt) return;
    try {
      await copyExactJsonToClipboard(publicationReceipt);
      setPublicationReceiptCopied(true);
      setPublicationReceiptError(null);
    } catch (error) {
      setPublicationReceiptCopied(false);
      setPublicationReceiptError(
        error instanceof Error
          ? error.message
          : "Checkpoint receipt could not be copied.",
      );
    }
  }, [publicationReceipt]);

  useEffect(() => {
    void refreshPublicationReceipt();
    const timer = window.setInterval(
      () => void refreshPublicationReceipt(),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshPublicationReceipt]);

  const syncNow = useCallback(async () => {
    if (!connected || syncing) return;
    setSyncing(true);
    setManualError(null);
    try {
      await syncCloudProviderNow("gdrive");
      await refreshPublicationReceipt();
    } catch (error) {
      setManualError(
        error instanceof Error ? error.message : "Cloud sync failed.",
      );
    } finally {
      setSyncing(false);
    }
  }, [connected, refreshPublicationReceipt, syncing]);


  return (
    <>
      <LibraryHandoffPanel />
      <section id="mobile-sync-section">
        <div className="mb-4 space-y-3">
          <div
            data-testid="library-core-desktop-role"
            className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4"
          >
            <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
              This installation's role
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-soft)]">
              This role comes from native Library state. Becoming Primary requires
              a controlled handoff from the current Primary.
            </p>
            <p role="status" className="mt-3 text-sm font-medium text-[var(--theme-text-primary)]">
              {desktopRole === "primary" ? "Primary source" : desktopRole === "follower" ? "Editable consumer" : "Authority unavailable"}
            </p>
            {desktopRole === "follower" && (
              <>
                <p
                  role="status"
                  className="mt-3 rounded-lg border border-[rgb(var(--theme-feedback-warning-rgb)/0.35)] bg-[rgb(var(--theme-feedback-warning-rgb)/0.08)] px-3 py-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]"
                >
                  Edits stay queued locally until the Primary accepts them.
                  Capture runs on the Primary.
                </p>
                {(consumerRecovery || followerStatus?.state === "authority_recovery_required") && (
                  <div data-testid="consumer-recovery" className="mt-3 rounded-lg border border-[var(--theme-border-subtle)] p-3 text-xs text-[var(--theme-text-secondary)]">
                    <p className="font-semibold">{consumerRecovery?.state === "following" ? "Edits from the previous Primary" : "Reconnect after the Primary changed"}</p>
                    {consumerRecovery ? (
                      <p className="mt-2">
                        Archived edits: {consumerRecovery.archivedPendingEdits.toLocaleString()} previously queued; {consumerRecovery.archivedPublishedEdits.toLocaleString()} previously uploaded.
                        Uploaded edits may already have been accepted by the previous Primary. These edits have not been resent.
                      </p>
                    ) : <p className="mt-2">Preserve your previous edits before enrolling with the new Primary.</p>}
                    {consumerRecovery && <ConsumerRecoveryReview key={consumerRecovery.recoveryId} recoveryId={consumerRecovery.recoveryId} />}
                    {consumerRecovery?.state === "prepared" && <p className="mt-2">Reconnecting keeps previous edits in the archive. Their pending changes will stop appearing in the Library until they are resolved.</p>}
                    {consumerRecovery?.state !== "following" && (
                      <button type="button" data-testid="consumer-recovery-action" onClick={() => void recoverConsumer()}
                        disabled={recovering || syncing || !!followerStatusError}
                        className="btn-secondary mt-3 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">
                        {recovering ? "Recovering..." : consumerRecovery?.state === "prepared" ? "Reconnect this consumer" : "Prepare recovery"}
                      </button>
                    )}
                  </div>
                )}
                {followerStatusError && (
                  <p className="theme-feedback-text-danger mt-3 break-words text-xs">
                    {followerStatusError}
                  </p>
                )}
                {followerStatus && (
                  <div
                    data-testid="library-core-follower-diagnostics"
                    className="mt-3"
                  >
                    <p className="mb-2 text-xs text-[var(--theme-text-secondary)]">
                      {describeLibraryFollowerProgress(followerStatus).statusMessage}
                      {" "}{describeLibraryFollowerProgress(followerStatus).pendingReason}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <DiagnosticCell
                        label="Checkpoint"
                        value={
                          followerStatus.checkpointGeneration === null
                            ? "-"
                            : followerStatus.checkpointGeneration.toLocaleString()
                        }
                      />
                      <DiagnosticCell
                        label="Remote revision"
                        value={
                          followerStatus.sourceRevision === null
                            ? "-"
                            : followerStatus.sourceRevision.toLocaleString()
                        }
                      />
                      <DiagnosticCell
                        label="Queued edits"
                        value={followerStatus.pendingIntentCount.toLocaleString()}
                      />
                      <DiagnosticCell
                        label="Published edits"
                        value={followerStatus.publishedIntentCount.toLocaleString()}
                      />
                      <DiagnosticCell
                        label="Imported receipts"
                        value={followerStatus.importedResultCount.toLocaleString()}
                      />
                      <DiagnosticCell
                        label="Follower actor"
                        value={
                          followerStatus.actorId === null
                            ? "-"
                            : `...${followerStatus.actorId.slice(-8)}`
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <CloudProviderCard
            provider="gdrive"
            state={driveCardState}
            onConnect={connect}
            onCancelConnect={setCancelProvider}
            onDisconnect={disconnect}
          />
          <p className="text-center text-xs text-[var(--theme-text-muted)]">
            Google Drive carries immutable Library checkpoints and PWA intents.
            SQLite stays local to each device.
          </p>

          <div
            data-testid="cloud-sync-diagnostics"
            className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
                  Sync diagnostics
                </p>
                <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">
                  Local SQLite revision and immutable cloud publication
                </p>
              </div>
              <button
                type="button"
                data-testid="cloud-sync-now-button"
                onClick={() => void syncNow()}
                disabled={!connected || syncing || recovering}
                className="btn-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync now"}
              </button>
            </div>

            {diagnosticError && (
              <p className="theme-feedback-text-danger mb-3 break-words text-xs">
                {diagnosticError}
              </p>
            )}

            {publicationReceiptError && (
              <p className="theme-feedback-text-danger mb-3 break-words text-xs">
                {publicationReceiptError}
              </p>
            )}

            {isWriterOwnershipWarning(diagnosticError) && <p className="mb-3 text-sm theme-feedback-text-warning">Another Primary owns this Library. Use its signed transfer consent to move capture here.</p>}

            <div
              data-testid="cloud-sync-status-message"
              aria-busy={publishing}
              aria-live="polite"
              role="status"
              className="mb-3 rounded-lg bg-[var(--theme-bg-muted)] px-3 py-2 text-xs text-[var(--theme-text-secondary)]"
            >
              <p className="flex items-center gap-2 font-medium text-[var(--theme-text-primary)]">
                {publishing && (
                  <span
                    aria-hidden="true"
                    data-testid="cloud-sync-activity-spinner"
                    className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--theme-accent-secondary)] border-t-transparent"
                  />
                )}
                {driveState?.statusMessage ?? "No cloud sync activity yet."}
              </p>
              <p className="mt-1 text-[var(--theme-text-muted)]">
                {describeUploadGap(driveState)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <DiagnosticCell
                label="Local items"
                value={
                  librarySnapshot ? librarySnapshot.itemCount.toLocaleString() : "-"
                }
              />
              <DiagnosticCell
                label="Local size"
                value={formatBytes(librarySnapshot?.storageBytes)}
              />
              <DiagnosticCell
                label="Last upload"
                value={formatRelativeTime(driveState?.lastUploadAt)}
              />
              <DiagnosticCell
                label="Uploaded bytes"
                value={formatBytes(driveState?.lastUploadedBytes)}
              />
              <DiagnosticCell
                label="Last download"
                value={formatRelativeTime(driveState?.lastDownloadAt)}
              />
              <DiagnosticCell
                label="Remote bytes"
                value={formatBytes(driveState?.lastRemoteBytes)}
              />
              <DiagnosticCell
                label="SQLite revision"
                value={
                  publicationReceipt?.localRevision.toLocaleString() ?? "-"
                }
              />
              <DiagnosticCell
                label="Receipt items"
                value={publicationReceipt?.itemCount.toLocaleString() ?? "-"}
              />
              <DiagnosticCell
                label="Checkpoint bytes"
                value={formatBytes(
                  publicationReceipt?.checkpointStoredByteLength,
                )}
              />
              <DiagnosticCell
                label="Checkpoint"
                value={
                  publicationReceipt?.controlPointer.generation.toLocaleString() ??
                  "-"
                }
              />
              <DiagnosticCell
                label="Control receipt"
                title={publicationReceipt?.controlRevision}
                value={
                  publicationReceipt
                    ? formatIdentityTail(publicationReceipt.controlRevision)
                    : "-"
                }
              />
              <DiagnosticCell
                label="Manifest digest"
                title={
                  publicationReceipt?.controlPointer.manifest.descriptor
                    .contentDigest
                }
                value={
                  publicationReceipt
                    ? formatIdentityTail(
                        publicationReceipt.controlPointer.manifest.descriptor
                          .contentDigest,
                      )
                    : "-"
                }
              />
              <DiagnosticCell
                label="Drive object"
                title={
                  publicationReceipt?.controlPointer.manifest.transportObjectId
                }
                value={
                  publicationReceipt
                    ? formatIdentityTail(
                        publicationReceipt.controlPointer.manifest
                          .transportObjectId,
                      )
                    : "-"
                }
              />
            </div>
            <button
              type="button"
              data-testid="copy-primary-checkpoint-receipt"
              onClick={() => void copyPublicationReceipt()}
              disabled={!publicationReceipt}
              className="btn-secondary mt-3 w-full rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {publicationReceiptCopied
                ? "Primary receipt copied"
                : "Copy exact Primary receipt"}
            </button>
          </div>
        </div>
      </section>

      {cancelProvider && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-provider-cancel-title"
        >
          <div className="theme-dialog-panel w-full max-w-sm rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 shadow-2xl">
            <h2
              id="cloud-provider-cancel-title"
              className="text-sm font-semibold text-[color:var(--theme-text-primary)]"
            >
              Cancel Google Drive connection?
            </h2>
            <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
              The browser sign-in attempt will stop. You can reconnect from
              settings.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-1.5 text-sm"
                onClick={() => setCancelProvider(null)}
              >
                Keep Connecting
              </button>
              <button
                type="button"
                className="btn-primary rounded-lg px-3 py-1.5 text-sm"
                onClick={() => {
                  cancelConnect(cancelProvider);
                  setCancelProvider(null);
                }}
              >
                Cancel Connection
              </button>
            </div>
          </div>
        </div>
      )}
      <DesktopSnapshotsSection />
    </>
  );
}
