/** Local memory only. No logging, persistence, uploader, or cross-pass identity. */
export type PassDiagnosticProvider = "facebook" | "instagram";
type Disposition = "retained" | "excluded" | "deferred";
const reasons = new Set([
  "inspection_failed", "advertising", "advertising_unresolved",
  "recommendation_or_follow", "missing_author", "missing_content",
  "retained_unknown_origin", "follow", "sponsored", "recommendation",
  "sponsored_accessible", "ads_link", "tiny_or_invisible", "duplicate_in_pass",
]);
type Observation = { ordinal: number; reason: string; disposition: Disposition };
type Pass = {
  provider: PassDiagnosticProvider;
  passOrdinal: number;
  observed: number;
  candidateCount: number | null;
  inspectionComplete: boolean;
  truncated: boolean;
  outcome: "error" | "completed";
  records: Observation[];
};
const passes: Pass[] = [];
let recordCount = 0;
let capped = false;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key));
}

/** Only an explicitly enabled extractor sends this optional allowlisted payload. */
export function recordPassDiagnostics(provider: PassDiagnosticProvider, payload: unknown): void {
  if (payload === undefined) return;
  try {
    if (!object(payload) || !exactKeys(payload, ["schemaVersion", "surface", "records", "observed", "candidateCount", "inspectionComplete", "truncated", "outcome"]) ||
        payload.schemaVersion !== 1 || payload.surface !== "feed" ||
        !Array.isArray(payload.records) || payload.records.length > 250 ||
        !Number.isSafeInteger(payload.observed) || (payload.observed as number) < payload.records.length ||
        (payload.candidateCount !== null && (!Number.isSafeInteger(payload.candidateCount) || (payload.candidateCount as number) < (payload.observed as number))) ||
        typeof payload.inspectionComplete !== "boolean" || payload.inspectionComplete !== (payload.outcome === "completed" && payload.candidateCount !== null && payload.candidateCount === payload.observed) ||
        typeof payload.truncated !== "boolean" || payload.truncated !== ((payload.observed as number) > payload.records.length) ||
        (payload.outcome !== "error" && payload.outcome !== "completed")) return;
    const records: Observation[] = [];
    let previous = -1;
    for (const value of payload.records) {
      if (!object(value) || !exactKeys(value, ["ordinal", "reason", "disposition"]) ||
          !Number.isSafeInteger(value.ordinal) || (value.ordinal as number) <= previous || (value.ordinal as number) >= 250 ||
          typeof value.reason !== "string" || !reasons.has(value.reason) ||
          !["retained", "excluded", "deferred"].includes(value.disposition as string)) return;
      previous = value.ordinal as number;
      records.push({ ordinal: previous, reason: value.reason, disposition: value.disposition as Disposition });
    }
    if (passes.length >= 100 || recordCount + records.length > 500) { capped = true; return; }
    passes.push({ provider, passOrdinal: passes.length, observed: payload.observed as number,
      candidateCount: payload.candidateCount as number | null, inspectionComplete: payload.inspectionComplete,
      truncated: payload.truncated, outcome: payload.outcome, records });
    recordCount += records.length;
  } catch {
    // A diagnostic must never change capture failure/success semantics.
  }
}

/** Opaque identity is (provider, passOrdinal, ordinal), not an upstream post ID. */
export function readPassDiagnostics() {
  return { scope: "enumerated_candidate_observations_only" as const, capped, recordCount, passes: passes.map((pass) => ({ ...pass, usableForObservationSummary: pass.outcome === "completed" && pass.inspectionComplete && !pass.truncated, records: pass.records.map((record) => ({ ...record })) })) };
}
