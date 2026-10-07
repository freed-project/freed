import { invoke } from "@tauri-apps/api/core";
import type { FeedItem } from "@freed/shared";
import { buildKevRequest, parseKevResponse, KEV_QUESTION_PACK_VERSION } from "./kev-classification";
import { onJevClassifierProviderChange } from "./jev-provider";

/** Metadata only. Native code fixes the endpoint and refuses redirects/proxies. */
export async function kevConnectionStatus() {
  const raw = await invoke<unknown>("get_kev_models");
  const models = (raw as { models?: unknown })?.models;
  const card = Array.isArray(models) ? models.find(value => value?.name === "kev-latest") : undefined;
  if (!card || typeof card.run !== "string" || card.run.length > 512 || card.truncate_states !== false) {
    throw new Error("Start a compatible Kev server with truncation disabled on 127.0.0.1:8009.");
  }
  return { configured: true, model: card.run, questionPackVersion: KEV_QUESTION_PACK_VERSION, inputUsdPerMillion: 0, maxConcurrency: 1 };
}

export async function requestLocalKev(item: FeedItem, signal: AbortSignal) {
  signal.throwIfAborted();
  const payload = buildKevRequest(item);
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
    void invoke("cancel_kev_request", { requestId }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const unsubscribe = onJevClassifierProviderChange(cancel);
  const started = performance.now();
  try {
    const raw = await invoke("request_kev", { requestId, payload });
    signal.throwIfAborted(); controller.signal.throwIfAborted();
    return { ...parseKevResponse(raw), cached: false, estimatedCostUsd: 0,
      questionPackVersion: KEV_QUESTION_PACK_VERSION, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Local Kev request failed.");
  } finally {
    signal.removeEventListener("abort", cancel); unsubscribe();
  }
}
