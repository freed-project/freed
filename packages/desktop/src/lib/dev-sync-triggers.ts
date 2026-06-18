import { isTauri } from "@tauri-apps/api/core";
import { log } from "./logger";
import { readNativeJsonFile, writeNativeJsonFile } from "./native-json-store";
import { refreshSocialProvider, type RetriableSocialProvider } from "./capture";

const DEV_SYNC_TRIGGER_FILE = "dev-sync-trigger.json";
const DEV_SYNC_TRIGGER_RESULT_FILE = "dev-sync-trigger-result.json";
const DEV_SYNC_TRIGGER_POLL_MS = 5_000;
const DEV_SYNC_TRIGGERS_ENABLED =
  import.meta.env.VITE_ENABLE_DEV_SYNC_TRIGGERS === "1" ||
  import.meta.env.VITE_TEST_TAURI === "1";

type DevSyncTriggerRequest = {
  enabled?: unknown;
  id?: unknown;
  provider?: unknown;
};

function parseProvider(value: unknown): RetriableSocialProvider | null {
  return value === "facebook" || value === "instagram" || value === "linkedin"
    ? value
    : null;
}

type DevSyncTriggerPollerOptions = {
  enabled?: boolean;
  pollMs?: number;
};

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

export function startDevSyncTriggerPoller(
  options: DevSyncTriggerPollerOptions = {},
): () => void {
  const enabled = options.enabled ?? DEV_SYNC_TRIGGERS_ENABLED;
  if (!enabled || !isTauri()) {
    return () => {};
  }

  let stopped = false;
  let inFlight = false;
  let lastHandledId: string | null = null;

  const poll = async () => {
    if (stopped || inFlight) return;

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
    await writeResult(requestId, provider, "started");
    log.info(`[dev-sync-trigger] starting ${provider} sync request ${requestId}`);

    try {
      await refreshSocialProvider(provider);
      await writeResult(requestId, provider, "completed");
      log.info(`[dev-sync-trigger] completed ${provider} sync request ${requestId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeResult(requestId, provider, "error", message);
      log.error(
        `[dev-sync-trigger] ${provider} sync request ${requestId} failed: ${message}`,
      );
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
