import { useState } from "react";
import { CloudProviderCard } from "@freed/ui/components/CloudProviderCard";
import { initiateGDriveOAuth } from "../lib/cloud-oauth";
import {
  clearCloudSync,
  getCloudProvider,
  stopCloudSync,
} from "../lib/sync";

/** Connect the PWA's OPFS SQLite Library to its Google Drive transport. */
export function PwaCloudSyncConnect() {
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(
    () => getCloudProvider() === "gdrive",
  );

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await initiateGDriveOAuth();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to start Google Drive sign-in",
      );
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    clearCloudSync("gdrive");
    stopCloudSync();
    setConnected(false);
  };

  return (
    <div className="mb-4 flex flex-col gap-3">
      <CloudProviderCard
        provider="gdrive"
        state={
          connected
            ? { status: "connected" }
            : connecting
              ? { status: "connecting" }
              : { status: "idle" }
        }
        onConnect={() => void handleConnect()}
        onDisconnect={handleDisconnect}
      />
      <p className="pt-6 text-center text-xs text-[var(--theme-text-muted)]">
        Freed synchronizes typed SQLite records through your Google Drive
        account. Freed never receives your Library.
      </p>
      {error && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
