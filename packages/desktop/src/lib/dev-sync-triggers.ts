import { isTauri } from "@tauri-apps/api/core";
import { log } from "./logger";
import { readNativeJsonFile, writeNativeJsonFile } from "./native-json-store";
import {
  refreshSocialProvider,
  type RetriableSocialProvider,
  type SocialProviderRefreshResult,
} from "./capture";
import { hasAcceptedDesktopBundle } from "./legal-consent";
import { loadDesktopReleaseChannelState } from "./release-channel";
import { useAppStore } from "./store";

const DEV_SYNC_TRIGGER_FILE = "dev-sync-trigger.json";
const DEV_SYNC_TRIGGER_RESULT_FILE = "dev-sync-trigger-result.json";
const DEV_SYNC_TRIGGER_POLL_MS = 5_000;
const DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
const DEV_SYNC_TRIGGERS_ENABLED =
  import.meta.env.VITE_ENABLE_DEV_SYNC_TRIGGERS === "1" ||
  import.meta.env.VITE_TEST_TAURI === "1";

type DevSyncTriggerRequest = {
  enabled?: unknown;
  id?: unknown;
  provider?: unknown;
  createdAt?: unknown;
};

type DevSyncTriggerBridgeRequest = {
  id?: unknown;
  provider?: unknown;
};

declare global {
  interface Window {
    __FREED_RUN_SOCIAL_SYNC__?: (
      request: DevSyncTriggerBridgeRequest,
    ) => Promise<void>;
  }
}

function parseProvider(value: unknown): RetriableSocialProvider | null {
  return value === "facebook" || value === "instagram" || value === "linkedin"
    ? value
    : null;
}

function getRequestExpirationDetail(
  request: DevSyncTriggerRequest,
  now = Date.now(),
): string | null {
  if (
    typeof request.createdAt !== "number" ||
    !Number.isFinite(request.createdAt)
  ) {
    return "Trigger request is missing createdAt. Re-run scripts/dev-sync-trigger.mjs.";
  }
  if (now - request.createdAt > DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS) {
    return "Trigger request expired before Freed Desktop picked it up. Re-run scripts/dev-sync-trigger.mjs.";
  }
  return null;
}

async function ensureInitializedStore(): Promise<boolean> {
  if (useAppStore.getState().isInitialized) return true;
  await useAppStore.getState().initialize();
  return useAppStore.getState().isInitialized;
}

type DevSyncTriggerPollerOptions = {
  enabled?: boolean;
  pollMs?: number;
};

async function resolveDevSyncTriggersEnabled(
  explicit: boolean | undefined,
): Promise<boolean> {
  if (explicit !== undefined) return explicit;
  if (DEV_SYNC_TRIGGERS_ENABLED) return true;
  if (!isTauri()) return false;

  try {
    const state = await loadDesktopReleaseChannelState();
    return state.selectedChannel === "dev" || state.installedChannel === "dev";
  } catch {
    return false;
  }
}

async function writeResult(
  requestId: string,
  provider: RetriableSocialProvider | null,
  status: "started" | "completed" | "error" | "ignored",
  detail?: string,
): Promise<void> {
  await writeNativeJsonFile(
    DEV_SYNC_TRIGGER_RESULT_FILE,
    {
      id: requestId,
      provider,
      status,
      detail,
      updatedAt: Date.now(),
    },
    "dev-sync-trigger",
  );
}

async function runDevSyncTrigger(
  request: DevSyncTriggerBridgeRequest,
): Promise<void> {
  const requestId =
    typeof request.id === "string" && request.id.trim()
      ? request.id.trim()
      : null;
  if (!requestId) return;

  const provider = parseProvider(request.provider);
  if (!provider) {
    await writeResult(
      requestId,
      null,
      "ignored",
      "Unsupported provider. Use facebook, instagram, or linkedin.",
    );
    return;
  }

  const accepted = await hasAcceptedDesktopBundle();
  if (!accepted) {
    await writeResult(
      requestId,
      provider,
      "error",
      "Freed Desktop legal consent has not been accepted.",
    );
    return;
  }

  try {
    const ready = await ensureInitializedStore();
    if (!ready) {
      await writeResult(
        requestId,
        provider,
        "error",
        "Freed did not finish initializing before the sync trigger could run.",
      );
      return;
    }

    await writeResult(requestId, provider, "started");
    log.info(
      `[dev-sync-trigger] starting ${provider} sync request ${requestId}`,
    );
    const result = await refreshSocialProvider(provider, "dev_trigger");
    const status = mapRefreshResultToTriggerStatus(result);
    await writeResult(
      requestId,
      provider,
      status,
      formatRefreshResultDetail(result),
    );
    log.info(
      `[dev-sync-trigger] ${provider} sync request ${requestId} finished status=${status} outcome=${result.status}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(requestId, provider, "error", message);
    log.error(
      `[dev-sync-trigger] ${provider} sync request ${requestId} failed: ${message}`,
    );
  }
}

function mapRefreshResultToTriggerStatus(
  result: SocialProviderRefreshResult,
): "completed" | "error" | "ignored" {
  if (result.status === "success") return "completed";
  if (result.status === "ignored") return "ignored";
  return "error";
}

function formatRefreshResultDetail(
  result: SocialProviderRefreshResult,
): string {
  const counts =
    result.postsExtracted === undefined
      ? ""
      : ` Posts: ${result.postsExtracted.toLocaleString()}. Added: ${(result.itemsAdded ?? 0).toLocaleString()}.`;
  const stage = result.stage ? ` Stage: ${result.stage}.` : "";
  return `${result.detail ?? `${result.provider} sync finished with ${result.status}.`}${stage}${counts}`;
}

export function installDevSyncTriggerBridge(): () => void {
  window.__FREED_RUN_SOCIAL_SYNC__ = (request) => runDevSyncTrigger(request);
  return () => {
    if (window.__FREED_RUN_SOCIAL_SYNC__) {
      delete window.__FREED_RUN_SOCIAL_SYNC__;
    }
  };
}

export function startDevSyncTriggerPoller(
  options: DevSyncTriggerPollerOptions = {},
): () => void {
  let stopped = false;
  let inFlight = false;
  let lastHandledId: string | null = null;
  let enabledPromise: Promise<boolean> | null = null;

  const poll = async () => {
    if (stopped || inFlight) return;

    enabledPromise ??= resolveDevSyncTriggersEnabled(options.enabled);
    const enabled = await enabledPromise;
    if (!enabled || !isTauri()) return;

    let request: DevSyncTriggerRequest | null = null;
    try {
      request = await readNativeJsonFile(DEV_SYNC_TRIGGER_FILE);
    } catch (error) {
      log.warn(
        `[dev-sync-trigger] failed to read request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (!request?.enabled) return;
    const requestId =
      typeof request.id === "string" && request.id.trim()
        ? request.id.trim()
        : null;
    if (!requestId || requestId === lastHandledId) return;

    const provider = parseProvider(request.provider);
    lastHandledId = requestId;

    const expirationDetail = getRequestExpirationDetail(request);
    if (expirationDetail) {
      await writeResult(requestId, provider, "ignored", expirationDetail);
      return;
    }

    if (!provider) {
      await writeResult(
        requestId,
        null,
        "ignored",
        "Unsupported provider. Use facebook, instagram, or linkedin.",
      );
      return;
    }

    inFlight = true;
    try {
      await runDevSyncTrigger({ id: requestId, provider });
    } finally {
      inFlight = false;
    }
  };

  const interval = window.setInterval(() => {
    void poll();
  }, options.pollMs ?? DEV_SYNC_TRIGGER_POLL_MS);
  void poll();

  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}
