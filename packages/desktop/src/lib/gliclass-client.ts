import { invoke } from "@tauri-apps/api/core";
import type { FeedItem, LocalAIModelManifestEntry } from "@freed/shared";
import { createLocalAIModelService } from "./local-ai-models";
import { classifyGliclass, GLICLASS_BASE, GLICLASS_LABEL_PACK } from "./gliclass-classification";
import { buildJevRequest } from "./jev-classification";
import { CONTENT_SIGNAL_THRESHOLD, CONTENT_SIGNAL_VERSION } from "../../../shared/src/content-signals.js";
import { onJevClassifierProviderChange } from "./jev-provider";
const files = [
  { path: "model.safetensors", sizeBytes: 746_211_800, sha256: GLICLASS_BASE.weights.sha256 },
  { path: "tokenizer.json", sizeBytes: 8_649_234, sha256: "519648948c4c59da1af88f2cf2c8b4f84417b5c673981bc9809abf84cda1b7cc" },
];
export const GLICLASS_MANIFEST: LocalAIModelManifestEntry = {
  id: "gliclass-base", tier: "light", title: "GLiClass Base", capability: "Local post classification",
  description: "Experimental independent post signals. Accuracy and thresholds require evaluation.",
  repo: GLICLASS_BASE.repo, revision: GLICLASS_BASE.revision,
  sourceUrl: `https://huggingface.co/${GLICLASS_BASE.repo}`,
  estimatedDownloadBytes: files.reduce((n, file) => n + file.sizeBytes, 0),
  estimatedStorageBytes: files.reduce((n, file) => n + file.sizeBytes, 0) + 1_326_390,
  hardwareNote: "One CPU inference thread. Optional model residency is released after inactivity.",
  requiresWebGPU: false, wasmFallback: false,
  supportsSemanticSearch: false, supportsSummaries: false, supportsAssistant: false, files,
};
// Separate state file preserves the summary pack's selection and health.
export const gliclassModels = createLocalAIModelService(undefined, [GLICLASS_MANIFEST], { stateFile: "gliclass-state.json" });
type Response = Awaited<ReturnType<typeof classifyGliclass>> & {
  usage: { input_tokens: number; output_tokens: number }; elapsedMs: number; cached: boolean; questionPackVersion: string;
};
const cache = new Map<string, Response>();
let active: AbortController | null = null;
export const gliclassCounters = { cacheHits: 0, cacheMisses: 0, inferenceCalls: 0, abstentions: 0 };
export async function requestLocalGliclass(item: FeedItem, signal: AbortSignal, reclassify = false): Promise<Response> {
  signal.throwIfAborted();
  if (active) throw new Error("GLiClass is busy. Wait for the current classification to finish.");
  const keyBytes = new TextEncoder().encode(JSON.stringify({ source: buildJevRequest(item).state, model: GLICLASS_BASE.revision, pack: GLICLASS_LABEL_PACK, scoring: { threshold: CONTENT_SIGNAL_THRESHOLD, version: CONTENT_SIGNAL_VERSION }, preprocessing: "source-v1-tokenizer-51964894-max512" }));
  const digest = await crypto.subtle.digest("SHA-256", keyBytes);
  const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  signal.throwIfAborted();
  const hit = !reclassify && cache.get(key);
  if (hit) { gliclassCounters.cacheHits++; return { ...structuredClone(hit), cached: true, elapsedMs: 0, usage: { input_tokens: 0, output_tokens: 0 } }; }
  if (active) throw new Error("GLiClass is busy. Wait for the current classification to finish.");
  gliclassCounters.cacheMisses++;
  const controller = new AbortController(); active = controller;
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = onJevClassifierProviderChange(abort);
  let tokens = 0; let elapsedMs = 0;
  try {
    const result = await classifyGliclass(item, { async infer(input, currentSignal) {
      currentSignal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const cancel = () => { void invoke("cancel_gliclass_request", { requestId }).catch(() => {}); };
      currentSignal.addEventListener("abort", cancel, { once: true });
      try {
        gliclassCounters.inferenceCalls++;
        const output = await invoke<{ modelRevision: string; logits: number[]; truncated: boolean; tokenCount: number; elapsedMs: number }>("request_gliclass", { requestId, input });
        currentSignal.throwIfAborted();
        if (!Number.isSafeInteger(output.tokenCount) || output.tokenCount < 1 || output.tokenCount > 512 || !Number.isFinite(output.elapsedMs) || output.elapsedMs < 0) throw new Error("Invalid local classifier measurements.");
        tokens += output.tokenCount; elapsedMs += output.elapsedMs; return output;
      } catch (error) { throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Local classifier failed."); }
      finally { currentSignal.removeEventListener("abort", cancel); }
    } }, controller.signal);
    controller.signal.throwIfAborted();
    const response = { ...result, cached: false, usage: { input_tokens: tokens, output_tokens: 0 }, elapsedMs, questionPackVersion: result.labelPackVersion };
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    cache.set(key, structuredClone(response)); return response;
  } catch (error) {
    gliclassCounters.abstentions++;
    const message = error instanceof Error ? error.message : String(error);
    if (!controller.signal.aborted && /integrity check failed|tokenizer identity mismatch|Could not load the (local GLiClass runtime|GLiClass tokenizer)|Download GLiClass Base/i.test(message)) {
      cache.clear();
      await gliclassModels.invalidateModel("gliclass-base", message).catch(() => {});
    }
    throw error;
  }
  finally { signal.removeEventListener("abort", abort); unsubscribe(); active = null; }
}
export async function removeLocalGliclass() {
  active?.abort();
  await invoke("unload_gliclass");
  cache.clear(); return gliclassModels.removeModel("gliclass-base");
}
