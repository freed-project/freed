import { invoke } from "@tauri-apps/api/core";
import type { FeedItem } from "@freed/shared";
import {
  buildJevRequest, buildJevMatchRequest, parseJevResponse, parseJevMatchResponse,
  JEV_MODEL, JEV_QUESTION_PACK_VERSION, JEV_CONTEXT_QUESTION_PACK_VERSION,
  JEV_INPUT_USD_PER_MILLION,
} from "./jev-classification";

export const isJevNative = import.meta.env.VITE_TEST_TAURI !== "1" && import.meta.env.MODE !== "test";
let previewKey: string | null = null;
const listeners = new Set<() => void>();
function changed() { for (const listener of listeners) listener(); }
export function onJevCredentialChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const jevCredentials = {
  async getApiKey(_provider = "jev"): Promise<string | null> {
    return isJevNative ? invoke<string | null>("get_jev_api_key") : previewKey;
  },
  async setApiKey(_provider: string, key: string): Promise<void> {
    if (!/^[\x21-\x7e]{1,4096}$/.test(key)) throw new Error("Invalid Jev key.");
    if (isJevNative) await invoke("set_jev_api_key", { key });
    else previewKey = key;
    changed();
  },
  async clearApiKey(): Promise<void> {
    if (isJevNative) await invoke("clear_jev_api_key");
    else previewKey = null;
    changed();
  },
};
export async function jevConnectionStatus() {
  return {
    configured: Boolean(await jevCredentials.getApiKey()),
    model: JEV_MODEL, questionPackVersion: JEV_QUESTION_PACK_VERSION,
    inputUsdPerMillion: JEV_INPUT_USD_PER_MILLION, maxConcurrency: 4,
  };
}
export async function jevPreviewHeaders(): Promise<Record<string, string>> {
  const key = await jevCredentials.getApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Native IPC never accepts an endpoint and never returns the credential. */
async function requestNative(payload: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const abort = () => { void invoke("cancel_jev_request", { requestId }).catch(() => {}); };
  const stopListening = onJevCredentialChange(abort);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await invoke("request_jev", { requestId, payload });
    signal.throwIfAborted();
    return result;
  } catch (error) {
    // Native errors are sanitized; never include request payloads or raw vendor responses.
    throw new Error(typeof error === "string" ? error : "Jev request failed.");
  } finally {
    signal.removeEventListener("abort", abort);
    stopListening();
  }
}
export async function requestNativeJev(
  path: "/api/jev-preview/classify" | "/api/jev-preview/match",
  request: { item: FeedItem; capabilities?: string[] },
  signal: AbortSignal,
) {
  const match = path.endsWith("/match");
  const payload = match ? buildJevMatchRequest(request.item, request.capabilities ?? []) : buildJevRequest(request.item);
  const started = performance.now();
  const raw = await requestNative(payload, signal);
  const parsed = match ? parseJevMatchResponse(raw, request.capabilities!.length) : parseJevResponse(raw);
  return {
    ...parsed, cached: false,
    questionPackVersion: match ? JEV_CONTEXT_QUESTION_PACK_VERSION : JEV_QUESTION_PACK_VERSION,
    estimatedCostUsd: parsed.usage.input_tokens * JEV_INPUT_USD_PER_MILLION / 1_000_000,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/** A disclosed synthetic inference proves key and model access without sharing Library text. */
export async function testJevConnection(signal: AbortSignal): Promise<void> {
  const item = {
    globalId: "jev-connection-test", platform: "x", contentType: "post",
    author: { id: "example", handle: "example", displayName: "Example" },
    content: { text: "This is a connection test from Freed Desktop.", mediaUrls: [], mediaTypes: [] },
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "connection-test", generatedAt: 0, generatorVersion: 1 },
  } as unknown as FeedItem;
  if (isJevNative) { await requestNativeJev("/api/jev-preview/classify", { item }, signal); return; }
  const response = await fetch("/api/jev-preview/classify", {
    method: "POST", headers: { "Content-Type": "application/json", "x-freed-jev-preview": "1", ...await jevPreviewHeaders() },
    body: JSON.stringify({ item, reclassify: true }), signal,
  });
  if (!response.ok) throw new Error("Jev connection failed. Check your key and try again.");
  const body = await response.json();
  if (body.model !== JEV_MODEL || !body.contentSignals) throw new Error("Jev returned an invalid test result.");
}
