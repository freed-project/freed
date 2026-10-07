import type { FeedItem } from "../../../shared/src/types.js";
import { buildJevRequest, JEV_SIGNAL_KEYS, JEV_EXPERIMENTAL_SIGNAL_KEYS, type JevExperimentalSignal } from "./jev-classification.js";
import { CONTENT_SIGNAL_KEYS, CONTENT_SIGNAL_THRESHOLD, CONTENT_SIGNAL_VERSION } from "../../../shared/src/content-signals.js";

/** Source pins only. Safetensors are not a runnable ONNX/CoreML download pack. */
export const GLICLASS_BASE = {
  model: "gliclass-base-v3.0",
  repo: "knowledgator/gliclass-base-v3.0",
  revision: "77a70e6cd52e602ed18184ef37d18bdd3741e3d5",
  codeRevision: "68132def761c2dccc20d1a71c04abdc5db35463f",
  license: "Apache-2.0",
  weights: {
    path: "model.safetensors", sizeBytes: 746_211_800,
    sha256: "4f1043b82812a8f5ec7ff9f97c6744758f47836f9872ba0dbeb3a8e2b0b92a26",
  },
  maxClasses: 25,
} as const;

// Short hypotheses keep label tokens bounded. This pack requires independent
// synthetic evaluation; Jev's thresholds and quality do not transfer by fiat.
export const GLICLASS_LABEL_PACK: Readonly<Record<typeof JEV_SIGNAL_KEYS[number], string>> = {
  event: "Invitation to a gathering or activity",
  deadline: "Cutoff or due date for an action",
  opportunity: "Available role, grant, fellowship or open call",
  how_to: "Practical instructions or tutorial",
  reference: "Reusable documentation or factual lookup resource",
  transaction: "Specific purchase, payment, shipment or reservation",
  product_update: "Product feature launch, version release or change",
  alert: "Actionable disruption, hazard or security warning",
  deal: "Discount, coupon or special commercial terms",
  place: "Meaningful information about a physical place or visit",
  media: "Specific video, podcast, music or visual work shared",
  essay: "Developed argument, analysis or reflection",
  moment: "Everyday personal experience or observation",
  life_update: "Meaningful personal change or milestone",
  announcement: "New availability or development made public",
  recommendation: "Specific endorsement or favorable review",
  request: "Genuine request for help, information or input",
  discussion: "Exchange of views or invitation to discuss",
  promotion: "Advertising, fundraising or self promotion",
  news: "Recent factual development of public interest",
  help_offered: "Explicit offer of assistance or resources",
  collaboration: "Invitation to work or create together",
  work_in_progress: "Unfinished work and its current progress",
  appreciation: "Gratitude, praise or acknowledgment",
  humor: "Deliberate joke, satire or playful comedy",
  correction: "Explicit correction, retraction or clarification",
};

/** The implementation must run off the UI thread, tokenizer included. No
 * endpoint/credential is accepted. Reject truncation rather than score evidence
 * that the full classifier did not see. Runtime cancellation must drain work. */
export interface GliclassRuntime {
  infer(input: { text: string; labels: readonly string[]; modelRevision: string }, signal: AbortSignal): Promise<{
    modelRevision: string;
    logits: readonly number[];
    truncated: boolean;
  }>;
}

let running = false;

/** Local classification adapter, pending a verified native runtime. A single
 * flight bounds concurrency; there is no unbounded queue or cloud fallback.
 * Returns no token counts or latency claims because this port cannot measure them. */
export async function classifyGliclass(item: FeedItem, runtime: GliclassRuntime, signal: AbortSignal, inferredAt = Date.now()) {
  signal.throwIfAborted();
  if (running) throw new Error("GLiClass is busy. Try again after the current classification finishes.");
  if (!Number.isSafeInteger(inferredAt) || inferredAt < 0) throw new Error("Invalid inference timestamp.");
  const source = buildJevRequest(item).state;
  if (source.textTruncated) throw new Error("GLiClass abstained because the source text exceeds its input limit.");
  // Literal model delimiters in source evidence must never create class slots.
  const text = [source.title, source.description, source.text].filter(Boolean).join("\n")
    .replace(/<<[^<>]{0,128}>>/g, " ");
  if (!text.trim()) throw new Error("GLiClass has no usable source text.");
  const scores = {} as Record<typeof JEV_SIGNAL_KEYS[number], number>;
  running = true;
  try {
    for (let offset = 0; offset < JEV_SIGNAL_KEYS.length; offset += GLICLASS_BASE.maxClasses) {
      signal.throwIfAborted();
      const keys = JEV_SIGNAL_KEYS.slice(offset, offset + GLICLASS_BASE.maxClasses);
      const result = await runtime.infer({ text, labels: keys.map((key) => GLICLASS_LABEL_PACK[key]), modelRevision: GLICLASS_BASE.revision }, signal);
      signal.throwIfAborted();
      if (result.truncated) throw new Error("GLiClass abstained because tokenization truncated the evidence or labels.");
      if (result.modelRevision !== GLICLASS_BASE.revision || !Array.isArray(result.logits) ||
        result.truncated !== false || result.logits.length !== keys.length || !Array.from(result.logits).every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("GLiClass returned an invalid model identity or score vector.");
      }
      keys.forEach((key, index) => { scores[key] = 1 / (1 + Math.exp(-result.logits[index])); });
    }
    return {
      model: GLICLASS_BASE.model, modelRevision: GLICLASS_BASE.revision,
      labelPackVersion: "freed-gliclass-signals-experimental-v1", estimatedCostUsd: 0,
      contentSignals: {
        version: CONTENT_SIGNAL_VERSION, method: "ai" as const, inferredAt,
        scores: Object.fromEntries(CONTENT_SIGNAL_KEYS.map((key) => [key, scores[key]])),
        tags: CONTENT_SIGNAL_KEYS.filter((key) => scores[key] >= CONTENT_SIGNAL_THRESHOLD),
      },
      experimentalSignals: {
        version: 1 as const, method: "ai" as const, inferredAt,
        scores: Object.fromEntries(JEV_EXPERIMENTAL_SIGNAL_KEYS.map((key) => [key, scores[key]])) as Record<JevExperimentalSignal, number>,
        tags: JEV_EXPERIMENTAL_SIGNAL_KEYS.filter((key) => scores[key] >= CONTENT_SIGNAL_THRESHOLD),
      },
    };
  } finally { running = false; }
}
