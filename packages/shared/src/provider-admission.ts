export const PROVIDER_ADMISSION_RULE_VERSION = "facebook-admission-v1";

export type ProviderAdmissionProvider = "facebook";
export type ProviderAdmissionSurface = "feed" | "story";
export type ProviderAdmissionInspectionStatus =
  | "complete"
  | "incomplete"
  | "unsupported"
  | "failed";
export type ProviderAdmissionDecision = "admit" | "exclude" | "defer";

export type ProviderAdmissionEvidenceCode =
  | "explicit_sponsored_testid"
  | "accessible_sponsored_label"
  | "referenced_sponsored_label"
  | "split_sponsored_disclosure"
  | "verified_ad_disclosure_link"
  | "structured_ad_metadata"
  | "partial_sponsored_disclosure"
  | "inspection_limit_exceeded"
  | "collector_failure";

export interface ProviderAdmissionObservation {
  provider: ProviderAdmissionProvider;
  surface: ProviderAdmissionSurface;
  placementIdentity: string;
  observationGeneration: number;
  inspectionStatus: ProviderAdmissionInspectionStatus;
  evidenceCodes: ProviderAdmissionEvidenceCode[];
}

export interface ProviderAdmissionEnvelope extends ProviderAdmissionObservation {
  ruleVersion: typeof PROVIDER_ADMISSION_RULE_VERSION;
  decision: ProviderAdmissionDecision;
  reasons: string[];
}

const EXCLUSION_EVIDENCE = new Set<ProviderAdmissionEvidenceCode>([
  "explicit_sponsored_testid",
  "accessible_sponsored_label",
  "referenced_sponsored_label",
  "split_sponsored_disclosure",
  "verified_ad_disclosure_link",
  "structured_ad_metadata",
]);

const DEFER_EVIDENCE = new Set<ProviderAdmissionEvidenceCode>([
  "partial_sponsored_disclosure",
  "inspection_limit_exceeded",
  "collector_failure",
]);

export function decideProviderPlacementAdmission(
  observation: ProviderAdmissionObservation,
): ProviderAdmissionEnvelope {
  const evidenceCodes = [...new Set(observation.evidenceCodes)].sort();
  const reasons: string[] = [];
  let decision: ProviderAdmissionDecision = "admit";

  if (
    observation.inspectionStatus === "failed" ||
    observation.inspectionStatus === "unsupported"
  ) {
    decision = "defer";
    reasons.push(`inspection_${observation.inspectionStatus}`);
  } else if (evidenceCodes.some((code) => EXCLUSION_EVIDENCE.has(code))) {
    decision = "exclude";
    reasons.push("verified_advertising_evidence");
  } else if (
    observation.inspectionStatus === "incomplete" ||
    evidenceCodes.some((code) => DEFER_EVIDENCE.has(code))
  ) {
    decision = "defer";
    reasons.push("advertising_evidence_unresolved");
  } else {
    reasons.push("supported_inspection_without_advertising_evidence");
  }

  return {
    ...observation,
    evidenceCodes,
    ruleVersion: PROVIDER_ADMISSION_RULE_VERSION,
    decision,
    reasons,
  };
}

export function isProviderAdmissionEnvelope(
  value: unknown,
  expected: {
    provider: ProviderAdmissionProvider;
    surface: ProviderAdmissionSurface;
  },
): value is ProviderAdmissionEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<ProviderAdmissionEnvelope>;
  return (
    envelope.provider === expected.provider &&
    envelope.surface === expected.surface &&
    envelope.ruleVersion === PROVIDER_ADMISSION_RULE_VERSION &&
    envelope.decision === "admit" &&
    envelope.inspectionStatus === "complete" &&
    typeof envelope.placementIdentity === "string" &&
    envelope.placementIdentity.length > 0 &&
    Number.isSafeInteger(envelope.observationGeneration) &&
    (envelope.observationGeneration ?? 0) > 0 &&
    Array.isArray(envelope.evidenceCodes) &&
    Array.isArray(envelope.reasons)
  );
}
