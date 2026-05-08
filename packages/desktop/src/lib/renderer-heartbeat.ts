export interface RendererHeartbeatTiming {
  eventLoopLagMs: number | null;
  hiddenTimerThrottled: boolean;
}

export function rendererHeartbeatTiming(
  visibility: DocumentVisibilityState,
  nowMs: number,
  expectedHeartbeatAtMs: number,
  intervalMs: number,
): RendererHeartbeatTiming {
  const lagMs = Math.max(0, nowMs - expectedHeartbeatAtMs);
  const hidden = visibility !== "visible";
  return {
    eventLoopLagMs: hidden ? null : lagMs,
    hiddenTimerThrottled: hidden && lagMs > intervalMs,
  };
}
