import { describe, expect, it } from "vitest";
import { buildKevRequest, kevDecision, parseKevResponse } from "./kev-classification";
import { JEV_SIGNAL_KEYS, parseJevResponse } from "./jev-classification";
import { classifierEvalItem, summarizeClassifierEvaluation, CLASSIFIER_EVAL_CASES } from "./classifier-evaluation";
const raw = (p = 0.5) => ({ model: "kev-latest", answers: Object.fromEntries(JEV_SIGNAL_KEYS.map(key => [key, { type: "noul", noul: p }])), usage: { input_tokens: 12, output_tokens: 26 } });
// Tier 1: local uncertainty must not silently become accepted tags.
describe("Kev classification and evaluation", () => {
  it("refuses truncated input and validates model identity", () => {
    expect(buildKevRequest(classifierEvalItem(0)).model).toBe("kev-latest");
    const item = classifierEvalItem(0); item.content.text = "x".repeat(8001);
    expect(() => buildKevRequest(item)).toThrow("abstained");
    expect(() => parseJevResponse(raw())).toThrow();
    expect(() => parseKevResponse({ ...raw(), model: "jev-1.13.0" })).toThrow();
    for (const truncated of [true, "true", null]) expect(() => parseKevResponse({ ...raw(), truncated })).toThrow();
  });
  it("retains raw evidence but abstains per signal and rejects malformed results", () => {
    const result = parseKevResponse(raw());
    expect(result.abstainedSignals).toHaveLength(26);
    expect(result.contentSignals.tags).toEqual([]);
    expect(result.contentSignals.scores.event).toBe(0.5);
    expect(parseKevResponse(raw(0.8)).abstainedSignals).toEqual([]);
    expect(parseKevResponse(raw(0.8)).contentSignals.tags).toContain("event");
    expect(kevDecision(0.2)).toBe(false); expect(kevDecision(0.2001)).toBeNull();
    for (const p of [NaN, Infinity, -1, 2]) expect(() => parseKevResponse(raw(p))).toThrow();
    const missing = raw(); delete (missing.answers as Record<string, unknown>).event;
    expect(() => parseKevResponse(missing)).toThrow();
  });
  it("reports denominators and abstention coverage and rejects partial evaluation", () => {
    const responses = CLASSIFIER_EVAL_CASES.map(() => ({ ...parseKevResponse(raw()), elapsedMs: 10, cached: false, estimatedCostUsd: 0 }));
    const summary = summarizeClassifierEvaluation(responses, "kev");
    expect(summary.labels).toBe(24); expect(summary.coverage).toBe(0);
    expect(summary.acceptedAccuracy).toBeNull(); expect(summary.brier).toBe(0.25);
    expect(summary.medianMs).toBe(10);
    expect(() => summarizeClassifierEvaluation(responses.slice(1), "kev")).toThrow("incomplete");
  });
});
