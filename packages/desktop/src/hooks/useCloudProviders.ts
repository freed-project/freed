/**
 * useCloudProviders — shared cloud sync state machine for GDrive and Dropbox.
 *
 * Single source of truth for connect/disconnect logic used by both
 * CloudSyncSetupDialog (onboarding) and MobileSyncTab (Settings).
 * If you find yourself re-implementing this inline, import from here instead.
 */

import { useState, useCallback } from "react";
import {
  initiateDesktopOAuth,
  storeCloudToken,
  startCloudSync,
  clearCloudProvider,
  getCloudToken,
  type CloudProvider,
} from "../lib/sync";

export type ProviderState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; error: string };

export type CloudProviderStatus = Record<CloudProvider, ProviderState>;

function initialStatus(): CloudProviderStatus {
  return {
    gdrive: { status: getCloudToken("gdrive") ? "connected" : "idle" },
    dropbox: { status: getCloudToken("dropbox") ? "connected" : "idle" },
  };
}

export function useCloudProviders() {
  const [providers, setProviders] = useState<CloudProviderStatus>(initialStatus);

  const setProvider = useCallback(
    (provider: CloudProvider, state: ProviderState) => {
      setProviders((prev) => ({ ...prev, [provider]: state }));
    },
    [],
  );

  const connect = useCallback(
    async (provider: CloudProvider) => {
      setProvider(provider, { status: "connecting" });
      try {
        const token = await initiateDesktopOAuth(provider);
        storeCloudToken(provider, token);
        startCloudSync(provider, token).catch(console.error);
        setProvider(provider, { status: "connected" });
      } catch (err) {
        setProvider(provider, {
          status: "error",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      }
    },
    [setProvider],
  );

  const disconnect = useCallback(
    (provider: CloudProvider) => {
      clearCloudProvider(provider);
      setProvider(provider, { status: "idle" });
    },
    [setProvider],
  );

  const anyConnected =
    providers.gdrive.status === "connected" ||
    providers.dropbox.status === "connected";

  return { providers, connect, disconnect, anyConnected };
}
