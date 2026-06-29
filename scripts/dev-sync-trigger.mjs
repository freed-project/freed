#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const allowedProviders = new Set(["facebook", "instagram", "linkedin"]);
export const lockedRetryMs = 30_000;
export const runtimeDeferredRetryMsByProvider = Object.freeze({
  facebook: 2 * 60 * 1000,
  instagram: 10 * 60 * 1000,
  linkedin: 30 * 60 * 1000,
});

function usage() {
  return "Usage: node scripts/dev-sync-trigger.mjs [facebook|instagram|linkedin]";
}

export function formatDurationMs(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds.toLocaleString()} ${seconds === 1 ? "second" : "seconds"}`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes.toLocaleString()} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function getDeferredReason(parsed) {
  if (parsed?.status !== "error") return null;
  const detail = typeof parsed.detail === "string" ? parsed.detail : "";
  if (detail.includes("Mac is locked")) return "locked";
  if (detail.includes("runtime_deferred")) return "runtime_deferred";
  return null;
}

export function isPostCompletionRendererRebuildResult(parsed) {
  if (parsed?.status !== "waiting") return false;
  const detail = typeof parsed.detail === "string" ? parsed.detail : "";
  return detail.includes("Renderer was rebuilt after the sync trigger finished");
}

export function getDeferredRetryMs(provider, reason) {
  if (reason === "locked") return lockedRetryMs;
  return runtimeDeferredRetryMsByProvider[provider] ?? runtimeDeferredRetryMsByProvider.facebook;
}

export function getDeferredRetryDecision({
  provider,
  parsed,
  sawPostCompletionRendererRebuild,
  now,
  deadline,
}) {
  const reason = getDeferredReason(parsed);
  if (!reason) return { action: "none" };
  const retryMs = getDeferredRetryMs(provider, reason);
  if (sawPostCompletionRendererRebuild) {
    return {
      action: "stop",
      code: 3,
      reason,
      retryMs,
      detail:
        "The provider run already finished before renderer recovery. Not queueing another request because that can create duplicate provider traffic and cooldowns.",
    };
  }
  if (now + retryMs < deadline) {
    return { action: "retry", reason, retryMs };
  }
  return {
    action: "stop",
    code: 3,
    reason,
    retryMs,
    detail: `Runtime work is deferred. Not retrying inside this helper window because the provider-safe backoff is ${formatDurationMs(retryMs)}.`,
  };
}

export async function runDevSyncTrigger({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
  error = console.error,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const provider = argv[0] ?? "facebook";
  if (!allowedProviders.has(provider)) {
    error(usage());
    return 1;
  }

  const appDataDir =
    env.FREED_APP_DATA_DIR ??
    path.join(os.homedir(), "Library", "Application Support", "wtf.freed.desktop");
  const requestPath = path.join(appDataDir, "dev-sync-trigger.json");
  const resultPath = path.join(appDataDir, "dev-sync-trigger-result.json");
  let requestId = `${provider}-${now()}`;

  await mkdir(appDataDir, { recursive: true });

  async function queueRequest() {
    await writeFile(
      requestPath,
      `${JSON.stringify(
        {
          enabled: true,
          id: requestId,
          provider,
          createdAt: now(),
        },
        null,
        2,
      )}\n`,
    );
    log(`Queued ${provider} dev sync trigger ${requestId}`);
  }

  await queueRequest();
  log(`Request: ${requestPath}`);
  log(`Result: ${resultPath}`);

  const deadline = now() + 10 * 60 * 1000;
  let lastStatus = "";
  let sawPostCompletionRendererRebuild = false;

  while (now() < deadline) {
    await sleep(2_000);
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(resultPath, "utf8"));
    } catch {
      continue;
    }
    if (parsed?.id !== requestId) continue;
    if (isPostCompletionRendererRebuildResult(parsed)) {
      sawPostCompletionRendererRebuild = true;
    }
    const statusLine = `${parsed.status}${parsed.detail ? `: ${parsed.detail}` : ""}`;
    if (statusLine !== lastStatus) {
      log(statusLine);
      lastStatus = statusLine;
    }
    if (parsed.status === "completed") return 0;

    const retryDecision = getDeferredRetryDecision({
      provider,
      parsed,
      sawPostCompletionRendererRebuild,
      now: now(),
      deadline,
    });
    if (retryDecision.action === "retry") {
      log(
        `Runtime deferred, retrying ${provider} after ${formatDurationMs(
          retryDecision.retryMs,
        )}.`,
      );
      await sleep(retryDecision.retryMs);
      requestId = `${provider}-${now()}`;
      lastStatus = "";
      sawPostCompletionRendererRebuild = false;
      await queueRequest();
      continue;
    }
    if (retryDecision.action === "stop") {
      error(retryDecision.detail);
      return retryDecision.code;
    }
    if (parsed.status === "error" || parsed.status === "ignored") return 1;
  }

  error(`Timed out waiting for ${requestId}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(await runDevSyncTrigger());
}
