import { describe, expect, it } from "vitest";
import { FriendsGalaxyBackendHealth } from "../../src/lib/friends-galaxy-backend-health.js";

describe("Friends Galaxy backend health", () => {
  it("keeps the first fatal error until the shell consumes it", () => {
    const health = new FriendsGalaxyBackendHealth();
    health.reportFatalError("GPU device lost");
    health.reportFatalError("Later queue failure");

    expect(health.takeFatalError()).toBe("GPU device lost");
    expect(health.takeFatalError()).toBeNull();
  });

  it("ignores empty reports", () => {
    const health = new FriendsGalaxyBackendHealth();
    health.reportFatalError("   ");

    expect(health.takeFatalError()).toBeNull();
  });

  it("clears an intentional teardown signal", () => {
    const health = new FriendsGalaxyBackendHealth();
    health.reportFatalError("GPU device destroyed");
    health.clear();

    expect(health.takeFatalError()).toBeNull();
  });
});
