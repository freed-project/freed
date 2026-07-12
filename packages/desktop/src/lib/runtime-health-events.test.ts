import { describe, expect, it } from "vitest";

import { runtimeHealthIdentityFields } from "./runtime-health-events";

describe("runtime health identity", () => {
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
