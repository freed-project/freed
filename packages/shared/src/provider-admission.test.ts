import { describe, expect, it } from "vitest";
import {
  decideProviderPlacementAdmission,
  isProviderAdmissionEnvelope,
} from "./provider-admission";

const observation = {
  provider: "facebook" as const,
  surface: "feed" as const,
  placementIdentity: "post:123",
  observationGeneration: 1,
  inspectionStatus: "complete" as const,
  evidenceCodes: [],
};

describe("provider placement admission", () => {
  it("admits only a complete supported inspection without advertising evidence", () => {
    const result = decideProviderPlacementAdmission(observation);
    expect(result.decision).toBe("admit");
    expect(isProviderAdmissionEnvelope(result, { provider: "facebook", surface: "feed" })).toBe(true);
  });

  it("excludes verified advertising evidence", () => {
    const result = decideProviderPlacementAdmission({
      ...observation,
      evidenceCodes: ["accessible_sponsored_label"],
    });
    expect(result.decision).toBe("exclude");
    expect(result.reasons).toEqual(["verified_advertising_evidence"]);
  });

  it("defers incomplete and failed inspections", () => {
    expect(
      decideProviderPlacementAdmission({
        ...observation,
        inspectionStatus: "incomplete",
        evidenceCodes: ["inspection_limit_exceeded"],
      }).decision,
    ).toBe("defer");
    expect(
      decideProviderPlacementAdmission({
        ...observation,
        inspectionStatus: "failed",
        evidenceCodes: ["collector_failure"],
      }).decision,
    ).toBe("defer");
  });

  it("rejects stale, mismatched, or non-admit envelopes at the capture boundary", () => {
    const admitted = decideProviderPlacementAdmission(observation);
    expect(isProviderAdmissionEnvelope({ ...admitted, ruleVersion: "old" }, { provider: "facebook", surface: "feed" })).toBe(false);
    expect(isProviderAdmissionEnvelope({ ...admitted, surface: "story" }, { provider: "facebook", surface: "feed" })).toBe(false);
    expect(isProviderAdmissionEnvelope({ ...admitted, decision: "exclude" }, { provider: "facebook", surface: "feed" })).toBe(false);
  });
});
