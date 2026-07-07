/**
 * Renderer-side runtime-health counters (stability program P0-03).
 *
 * Small fixed-shape events appended to runtime-health.jsonl through the
 * record_runtime_health_event Tauri command so soak tooling can count the
 * verified idle-churn loops (cloud upload echo, relay broadcast volume,
 * worker INIT churn, scrape outcomes). Logging only: every helper swallows
 * failures so counters can never affect sync or capture behavior.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export type CloudUploadCause = "subscriber" | "manual" | "poll";

export type SocialScrapeTrigger =
  | "manual"
  | "scheduled"
  | "deferred_retry"
  | "dev_trigger"
  | "post_login"
  | "unknown";

export type ScrapeOutcomeProvider = "facebook" | "instagram" | "linkedin" | "x";

export function recordRuntimeHealthEvent(
  payload: { event: string } & Record<string, unknown>,
): void {
  try {
    if (!isTauri()) return;
    void invoke("record_runtime_health_event", { payload }).catch(() => {});
  } catch {
    // Counters must never propagate into sync or capture paths.
  }
}

/**
 * One line per cloud upload attempt. `headsUnchanged` is the cloud-loop
 * signature (F01/F06): hundreds of uploads per idle hour with unchanged
 * heads means the upload→merge→STATE_UPDATE→upload echo is live.
 */
export function recordCloudUploadAttempt(input: {
  provider: string;
  cause: CloudUploadCause;
  headsBefore: string[] | null;
  headsUnchanged: boolean;
}): void {
  recordRuntimeHealthEvent({ event: "cloud_upload_attempt", ...input });
}

/**
 * One line per scrape settlement across all four capture paths.
 * `itemsExtracted >= 5 && itemsPersisted == 0` is the scrape_zero_persist
 * signature (F03: results discarded by mid-invoke renderer recovery).
 */
export function recordScrapeOutcome(input: {
  provider: ScrapeOutcomeProvider;
  trigger: SocialScrapeTrigger;
  itemsExtracted: number;
  itemsPersisted: number;
  stage: string;
  durationMs: number;
}): void {
  recordRuntimeHealthEvent({ event: "scrape_outcome", ...input });
}

/**
 * One line per Automerge worker INIT (full A.load of the document).
 * INITs/hour during a content backlog is the F20 worker-churn counter.
 */
export function recordWorkerInit(input: {
  durationMs: number;
  docBytes: number;
}): void {
  recordRuntimeHealthEvent({ event: "worker_init", ...input });
}
