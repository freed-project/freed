import { describe, expect, it } from "vitest";
import { rendererHeartbeatTiming } from "./renderer-heartbeat";

describe("rendererHeartbeatTiming", () => {
  it("reports foreground event-loop lag while visible", () => {
    expect(rendererHeartbeatTiming("visible", 46_000, 31_000, 15_000)).toEqual({
      eventLoopLagMs: 15_000,
      hiddenTimerThrottled: false,
    });
  });

  it("does not count hidden timer throttling as foreground event-loop lag", () => {
    expect(rendererHeartbeatTiming("hidden", 496_000, 16_000, 15_000)).toEqual({
      eventLoopLagMs: null,
      hiddenTimerThrottled: true,
    });
  });

  it("keeps normal hidden heartbeats distinct from throttled hidden heartbeats", () => {
    expect(rendererHeartbeatTiming("hidden", 20_000, 16_000, 15_000)).toEqual({
      eventLoopLagMs: null,
      hiddenTimerThrottled: false,
    });
  });
});
