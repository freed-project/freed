import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { refreshSocialProvider } from "./capture";

const DEFAULT_STARTUP_MIN_MS = 7 * 60 * 1_000;
const DEFAULT_STARTUP_JITTER_MS = 8 * 60 * 1_000;
const DEFAULT_INTERVAL_MIN_MS = 45 * 60 * 1_000;
const DEFAULT_INTERVAL_JITTER_MS = 30 * 60 * 1_000;

interface AuthenticatedEssayPollerOptions {
  startupMinMs?: number;
  startupJitterMs?: number;
  intervalMinMs?: number;
  intervalJitterMs?: number;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let active = false;

function randomizedDelay(minimumMs: number, jitterMs: number): number {
  return Math.max(0, minimumMs) + Math.floor(Math.random() * Math.max(0, jitterMs));
}

async function runScheduledCapture(): Promise<void> {
  const providers = Math.random() < 0.5
    ? (["substack", "medium"] as const)
    : (["medium", "substack"] as const);

  for (const provider of providers) {
    try {
      await refreshSocialProvider(provider, "scheduled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDebugEvent("error", `[${provider}] scheduled beta sync failed: ${message}`);
    }
  }
}

function scheduleNext(options: Required<AuthenticatedEssayPollerOptions>, startup: boolean): void {
  if (!active || timer !== null) return;
  const delayMs = startup
    ? randomizedDelay(options.startupMinMs, options.startupJitterMs)
    : randomizedDelay(options.intervalMinMs, options.intervalJitterMs);
  timer = setTimeout(() => {
    timer = null;
    if (!active || running) return;
    running = true;
    void runScheduledCapture().finally(() => {
      running = false;
      scheduleNext(options, false);
    });
  }, delayMs);
}

export function startAuthenticatedEssayPoller(
  options: AuthenticatedEssayPollerOptions = {},
): void {
  if (active) return;
  active = true;
  scheduleNext(
    {
      startupMinMs: options.startupMinMs ?? DEFAULT_STARTUP_MIN_MS,
      startupJitterMs: options.startupJitterMs ?? DEFAULT_STARTUP_JITTER_MS,
      intervalMinMs: options.intervalMinMs ?? DEFAULT_INTERVAL_MIN_MS,
      intervalJitterMs: options.intervalJitterMs ?? DEFAULT_INTERVAL_JITTER_MS,
    },
    true,
  );
}

export function stopAuthenticatedEssayPoller(): void {
  active = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
