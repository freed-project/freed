/** Google Drive controls for the SQLite Library shared by Desktop and PWA. */

import { useCallback, useEffect, useState } from "react";
import type { CloudProvider } from "@freed/ui/components/CloudProviderCard";
import {
  useDebugStore,
  type CloudProviderDebugState,
} from "@freed/ui/lib/debug-store";
import {
  syncCloudProviderNow,
  transferSqliteLibraryWriterToThisDesktop,
} from "../lib/sync";
import { useCloudProviders } from "../hooks/useCloudProviders";
import { CloudProviderCard } from "./CloudProviderCard";
import { DesktopSnapshotsSection } from "./DesktopSnapshotsSection";
import { useAppStore } from "../lib/store";
import {
  acknowledgeDesktopClientWarning,
  desktopClientWarningSignature,
  isDesktopClientWarningAcknowledged,
} from "../lib/desktop-client-warning";
import {
  readLibraryCoreDesktopRole,
  writeLibraryCoreDesktopRole,
  type LibraryCoreDesktopRole,
} from "../lib/library-core-desktop-role";
import {
  readSqliteLibraryFollowerRuntimeStatus,
  type SqliteLibraryFollowerRuntimeStatus,
} from "../lib/sqlite-library";
import {
  readSqliteLibraryGoogleDrivePublicationReceipt,
  type LibraryCorePublishedCheckpointReceiptV1,
} from "../lib/library-core-cloud-sync";

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

function describeFollowerState(
  state: SqliteLibraryFollowerRuntimeStatus["state"],
): string {
  switch (state) {
    case "awaiting_checkpoint":
      return "Waiting for the primary Library checkpoint.";
    case "awaiting_enrollment":
      return "Checkpoint installed. Waiting to create this follower's actor.";
    case "enrollment_pending":
      return "Waiting for the primary source to accept this follower.";
    case "active":
      return "Follower journal is active.";
  }
}

export function MobileSyncTab() {
  const docSnapshot = useDebugStore((state) => state.docSnapshot);
  const cloudProviders = useDebugStore((state) => state.cloudProviders);
  const desktopClientIds = useAppStore((state) => state.desktopClientIds);
  const warningSignature = desktopClientWarningSignature(desktopClientIds);
  const [warningDismissed, setWarningDismissed] = useState(() =>
    isDesktopClientWarningAcknowledged(warningSignature),
  );
  const { providers, connect, cancelConnect, disconnect } = useCloudProviders();
  const [cancelProvider, setCancelProvider] = useState<CloudProvider | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [transferringWriter, setTransferringWriter] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [desktopRole, setDesktopRole] = useState<LibraryCoreDesktopRole>(() =>
    readLibraryCoreDesktopRole(),
  );
  const [followerStatus, setFollowerStatus] =
    useState<SqliteLibraryFollowerRuntimeStatus | null>(null);
  const [followerStatusError, setFollowerStatusError] = useState<string | null>(
    null,
  );
  const [publicationReceipt, setPublicationReceipt] =
    useState<LibraryCorePublishedCheckpointReceiptV1 | null>(null);
  const [publicationReceiptError, setPublicationReceiptError] = useState<
    string | null
  >(null);
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
  const roleLocked =
    driveCardState.status === "connected" ||
    driveCardState.status === "connecting";

  const chooseDesktopRole = useCallback(
    (role: LibraryCoreDesktopRole) => {
      if (roleLocked) return;
      writeLibraryCoreDesktopRole(role);
      setDesktopRole(role);
      setManualError(null);
    },
    [roleLocked],
  );

  useEffect(() => {
    setWarningDismissed(isDesktopClientWarningAcknowledged(warningSignature));
  }, [warningSignature]);

  useEffect(() => {
    if (desktopRole !== "follower") {
      setFollowerStatus(null);
      setFollowerStatusError(null);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const status = await readSqliteLibraryFollowerRuntimeStatus();
        if (!disposed) {
          setFollowerStatus(status);
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

  useEffect(() => {
    void refreshPublicationReceipt();
    const timer = window.setInterval(
      () => void refreshPublicationReceipt(),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshPublicationReceipt]);

  const dismissWarning = useCallback(() => {
    acknowledgeDesktopClientWarning(warningSignature);
    setWarningDismissed(true);
  }, [warningSignature]);

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

  const transferWriter = useCallback(async () => {
    if (transferringWriter) return;
    if (
      !window.confirm(
        "Make this Freed Desktop the writer? The previous installation becomes read-only when it next checks Google Drive.",
      )
    )
      return;
    setTransferringWriter(true);
    setManualError(null);
    try {
      await transferSqliteLibraryWriterToThisDesktop();
    } catch (error) {
      setManualError(
        error instanceof Error
          ? error.message
          : "Library ownership transfer failed.",
      );
    } finally {
      setTransferringWriter(false);
    }
  }, [transferringWriter]);

  return (
    <>
      <section id="mobile-sync-section">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Mobile Sync
        </h3>
        <div className="mb-4 space-y-3">
          {desktopClientIds.length > 1 && !warningDismissed && (
            <div
              role="alert"
              data-testid="multiple-desktop-client-warning"
              className="rounded-xl border border-[rgb(var(--theme-feedback-warning-rgb)/0.35)] bg-[rgb(var(--theme-feedback-warning-rgb)/0.08)] px-4 py-3"
            >
              <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
                Multiple Freed Desktop clients detected
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-secondary)]">
                {desktopClientIds.length.toLocaleString()} Freed Desktop clients
                are registered with this Library. Only the current writer may
                publish SQLite Library revisions or provider results.
              </p>
              <button
                type="button"
                onClick={dismissWarning}
                className="btn-secondary mt-3 px-3 py-1.5 text-xs font-semibold"
              >
                Got it
              </button>
            </div>
          )}

          <div
            data-testid="library-core-desktop-role"
            className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4"
          >
            <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
              This installation's role
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-soft)]">
              Choose before connecting Google Drive. Disconnect first to change
              an active connection.
            </p>
            <div
              role="radiogroup"
              aria-label="Freed Desktop Library role"
              className="mt-3 grid gap-2 sm:grid-cols-2"
            >
              {[
                {
                  role: "primary" as const,
                  label: "Primary source",
                  blurb: "Runs capture and publishes the canonical Library.",
                },
                {
                  role: "follower" as const,
                  label: "Editable follower",
                  blurb:
                    "Imports the primary Library and sends edits back for acceptance.",
                },
              ].map((option) => {
                const active = desktopRole === option.role;
                return (
                  <button
                    key={option.role}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={roleLocked}
                    onClick={() => chooseDesktopRole(option.role)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.12)]"
                        : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] hover:bg-[var(--theme-bg-card)]"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span
                        className={
                          active
                            ? "text-sm font-medium text-[var(--theme-text-primary)]"
                            : "text-sm font-medium text-[var(--theme-text-secondary)]"
                        }
                      >
                        {option.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 rounded-full ${
                          active
                            ? "bg-[var(--theme-accent-secondary)]"
                            : "bg-[var(--theme-border-quiet)]"
                        }`}
                      />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[var(--theme-text-muted)]">
                      {option.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
            {desktopRole === "follower" && (
              <>
                <p
                  role="status"
                  className="mt-3 rounded-lg border border-[rgb(var(--theme-feedback-warning-rgb)/0.35)] bg-[rgb(var(--theme-feedback-warning-rgb)/0.08)] px-3 py-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]"
                >
                  Authority publication is blocked on this installation.
                  Follower Drive transport remains disabled in this candidate
                  until its approval gate is complete.
                </p>
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
                      {describeFollowerState(followerStatus.state)}
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
                          followerStatus.remoteIngestSequence === null
                            ? "-"
                            : followerStatus.remoteIngestSequence.toLocaleString()
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
                disabled={!connected || syncing}
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

            {(transferringWriter ||
              isWriterOwnershipWarning(diagnosticError)) && (
              <div
                data-testid="sqlite-writer-transfer"
                className="mb-3 rounded-lg border border-[rgb(var(--theme-feedback-warning-rgb)/0.35)] bg-[rgb(var(--theme-feedback-warning-rgb)/0.08)] px-3 py-3"
              >
                <p className="text-xs font-medium text-[var(--theme-text-primary)]">
                  This Freed Desktop is read-only.
                </p>
                <p className="mt-1 text-xs text-[var(--theme-text-secondary)]">
                  Transfer ownership here to publish from this installation.
                </p>
                <button
                  type="button"
                  data-testid="sqlite-writer-transfer-button"
                  onClick={() => void transferWriter()}
                  disabled={transferringWriter}
                  className="btn-primary mt-3 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {transferringWriter
                    ? "Transferring..."
                    : "Make This Freed Desktop the Writer"}
                </button>
              </div>
            )}

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
                  docSnapshot ? docSnapshot.itemCount.toLocaleString() : "-"
                }
              />
              <DiagnosticCell
                label="Local size"
                value={formatBytes(docSnapshot?.binarySize)}
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
