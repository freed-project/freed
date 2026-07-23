/**
 * useCloudProviders, shared cloud sync state machine for GDrive and Dropbox.
 *
 * Single source of truth for connect/disconnect logic used by both
 * CloudSyncSetupDialog (onboarding) and MobileSyncTab (Settings).
 * If you find yourself re-implementing this inline, import from here instead.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  initiateDesktopOAuth,
  isOAuthCanceledError,
  storeCloudToken,
  startCloudSync,
  captureCloudLifecycle,
  clearCloudProvider,
  getCloudToken,
  type CloudProvider,
} from "../lib/sync";
import { log } from "../lib/logger";
import type {
  ProviderState,
  CloudProviderStatus,
} from "@freed/ui/components/CloudProviderCard";
import { updateCloudProvider } from "@freed/ui/lib/debug-store";

export type { ProviderState, CloudProviderStatus };

function initialStatus(): CloudProviderStatus {
  return {
    gdrive: { status: getCloudToken("gdrive") ? "connected" : "idle" },
    dropbox: { status: getCloudToken("dropbox") ? "connected" : "idle" },
  };
}

export function useCloudProviders() {
  const [providers, setProviders] = useState<CloudProviderStatus>(initialStatus);
  const connectAbortControllers = useRef<Partial<Record<CloudProvider, AbortController>>>({});

  const setProvider = useCallback(
    (provider: CloudProvider, state: ProviderState) => {
      setProviders((prev) => ({ ...prev, [provider]: state }));
    },
    [],
  );

  const connect = useCallback(
    async (provider: CloudProvider) => {
      const abortController = new AbortController();
      const lifecycle = captureCloudLifecycle(provider);
      connectAbortControllers.current[provider] = abortController;
      log.info(`[cloud/${provider}] connect requested`);
      setProvider(provider, { status: "connecting" });
      try {
        const token = await initiateDesktopOAuth(provider, { signal: abortController.signal });
        if (
          abortController.signal.aborted ||
          !lifecycle.isCurrent() ||
          connectAbortControllers.current[provider] !== abortController
        ) {
          return;
        }
        storeCloudToken(provider, token);
        await startCloudSync(provider, token.accessToken);
        if (
          abortController.signal.aborted ||
          connectAbortControllers.current[provider] !== abortController
        ) {
          clearCloudProvider(provider);
          return;
        }
        if (connectAbortControllers.current[provider] === abortController) {
          log.info(`[cloud/${provider}] connect completed`);
          setProvider(provider, { status: "connected" });
        }
      } catch (err) {
        if (isOAuthCanceledError(err) || abortController.signal.aborted) {
          log.info(`[cloud/${provider}] connect canceled`);
          setProvider(provider, { status: "idle" });
          return;
        }
        log.warn(`[cloud/${provider}] connect failed: ${err instanceof Error ? err.message : String(err)}`);
        setProvider(provider, {
          status: "error",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      } finally {
        if (connectAbortControllers.current[provider] === abortController) {
          delete connectAbortControllers.current[provider];
        }
      }
    },
    [setProvider],
  );

  const cancelConnect = useCallback(
    (provider: CloudProvider) => {
      const controller = connectAbortControllers.current[provider];
      if (!controller) return;

      log.info(`[cloud/${provider}] cancel requested`);
      controller.abort();
      delete connectAbortControllers.current[provider];
      clearCloudProvider(provider);
      setProvider(provider, { status: "idle" });
    },
    [setProvider],
  );

  const disconnect = useCallback(
    (provider: CloudProvider) => {
      connectAbortControllers.current[provider]?.abort();
      delete connectAbortControllers.current[provider];
      clearCloudProvider(provider);
      setProvider(provider, { status: "idle" });
    },
    [setProvider],
  );

  useEffect(() => {
    return () => {
      for (const [provider, controller] of Object.entries(connectAbortControllers.current)) {
        controller?.abort();
        clearCloudProvider(provider as CloudProvider);
      }
      connectAbortControllers.current = {};
    };
  }, []);

  // Keep the debug panel's cloud sync section in sync with live provider state.
  useEffect(() => {
    (["gdrive", "dropbox"] as const).forEach((provider) => {
      const providerState = providers[provider];
      updateCloudProvider(provider, providerState.status === "error"
        ? { status: providerState.status, error: providerState.error }
        : { status: providerState.status });
    });
  }, [providers]);

  const anyConnected =
    providers.gdrive.status === "connected" ||
    providers.dropbox.status === "connected";

  return { providers, connect, cancelConnect, disconnect, anyConnected };
}
