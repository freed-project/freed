import type { FeedItem } from "@freed/shared";
import { buildJevRequest, parseJevResponse, JEV_SIGNAL_KEYS } from "./jev-classification";

export const KEV_MODEL = "kev-latest";
export const KEV_ACCEPT_PROBABILITY = 0.8;
export const KEV_QUESTION_PACK_VERSION = "freed-signals-v2-kev-abstain-v1";

/** Same evidence and questions as Jev; no model-specific prompt advantage. */
export function buildKevRequest(item: FeedItem) {
  const request = buildJevRequest(item);
  if (request.state.textTruncated) throw new Error("Kev abstained: source text exceeds the input limit.");
  return { ...request, model: KEV_MODEL };
}

export function kevDecision(probability: number): boolean | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Invalid Kev probability.");
  return probability >= KEV_ACCEPT_PROBABILITY ? true : probability <= 0.2 ? false : null;
}

/** Preserve raw probabilities while excluding uncertain signals from decisions. */
export function parseKevResponse(raw: unknown, inferredAt = Date.now()) {
  if (typeof raw !== "object" || raw === null || ((raw as { truncated?: unknown }).truncated !== undefined && (raw as { truncated?: unknown }).truncated !== false)) {
    throw new Error("Kev abstained: invalid or truncated response.");
  }
  const parsed = (() => {
    try { return parseJevResponse(raw, inferredAt, KEV_MODEL); }
    catch (error) { throw new Error(error instanceof Error ? error.message.replaceAll("Jev", "Kev") : "Invalid Kev response."); }
  })();
  const scores = { ...parsed.contentSignals.scores, ...parsed.experimentalSignals.scores };
  return {
    ...parsed,
    contentSignals: { ...parsed.contentSignals, tags: parsed.contentSignals.tags.filter(key => kevDecision(scores[key]!) === true) },
    experimentalSignals: { ...parsed.experimentalSignals, tags: parsed.experimentalSignals.tags.filter(key => kevDecision(scores[key]!) === true) },
    abstainedSignals: JEV_SIGNAL_KEYS.filter(key => kevDecision(scores[key]!) === null),
  };
}
