import { describe, expect, it } from "vitest";

import { runtimeHealthIdentityFields, withRuntimeHealthIdentity } from "./runtime-health-events";

describe("runtime health identity", () => {
  it("identifies legal-gate hidden startup without initialization and prevents stale payload provenance", () => {
    const original = { event: "renderer_heartbeat", appPhase: "legal", visibility: "hidden", buildCommitSha: "stale", appSessionId: "stale" };
    const result = withRuntimeHealthIdentity(original);
    expect(result).toMatchObject({ event: "renderer_heartbeat", appPhase: "legal", visibility: "hidden", ...runtimeHealthIdentityFields() });
    expect(original.buildCommitSha).toBe("stale");
    expect(withRuntimeHealthIdentity({ reason: "interval" }).appSessionId).toBe(result.appSessionId);
  });
  it("keeps one build and app session identity for the renderer lifetime", () => {
    const first = runtimeHealthIdentityFields();
    const second = runtimeHealthIdentityFields();

    expect(second).toEqual(first);
    expect(first.appVersion).toBe(__APP_VERSION__);
    expect(first.buildCommitSha).toBe(__BUILD_COMMIT_SHA__);
    expect(first.channel).toBe(__BUILD_CHANNEL__);
    expect(first.appSessionId.length).toBeGreaterThan(10);
  });
});
