/**
 * useFpsMonitor — requestAnimationFrame-based FPS measurement hook
 *
 * Runs a rAF loop while the Performance tab is active. Updates a snapshot
 * at ~4Hz to avoid re-render churn from 60fps state updates.
 *
 * Tracks:
 *   - fps: rolling average over last 60 frames
 *   - frameTimeMs: last frame delta
 *   - droppedFrames: cumulative count of frames where delta > 32ms
 *   - p95Ms: 95th-percentile frame time over last 120 frames
 *   - longTasks: PerformanceObserver long-task count since mount
 */

import { useEffect, useRef, useCallback } from "react";
import { useDebugStore } from "./debug-store.js";

const FRAME_BUFFER = 120; // 2 seconds at 60fps
const UPDATE_INTERVAL_MS = 250; // 4Hz snapshot rate

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

export function useFpsMonitor(active: boolean) {
  const setPerfSnapshot = useDebugStore((s) => s.setPerfSnapshot);
  const rafId = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);
  const frameTimes = useRef<number[]>([]);
  const droppedFrames = useRef(0);
  const longTaskCount = useRef(0);
  const worstLongTask = useRef(0);
  const lastUpdateTs = useRef(0);
  const observerRef = useRef<PerformanceObserver | null>(null);

  const stop = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    lastTs.current = null;
  }, []);

  const loop = useCallback(
    (ts: number) => {
      if (lastTs.current !== null) {
        const delta = ts - lastTs.current;
        const buf = frameTimes.current;

        // Maintain rolling buffer
        buf.push(delta);
        if (buf.length > FRAME_BUFFER) buf.shift();

        if (delta > 32) droppedFrames.current += 1;

        // Throttle store updates to 4Hz
        if (ts - lastUpdateTs.current >= UPDATE_INTERVAL_MS) {
          lastUpdateTs.current = ts;
          const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
          setPerfSnapshot({
            fps: Math.round(1000 / avg),
            frameTimeMs: delta,
            droppedFrames: droppedFrames.current,
            p95Ms: percentile(buf, 95),
            longTasks: longTaskCount.current,
            worstLongTaskMs: worstLongTask.current,
            frameTimes: [...buf],
          });
        }
      }

      lastTs.current = ts;
      rafId.current = requestAnimationFrame(loop);
    },
    [setPerfSnapshot],
  );

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }

    // Reset counters when tab becomes active
    frameTimes.current = [];
    droppedFrames.current = 0;
    longTaskCount.current = 0;
    worstLongTask.current = 0;
    lastUpdateTs.current = 0;

    // Attach PerformanceObserver for long tasks
    if (typeof PerformanceObserver !== "undefined") {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount.current += 1;
            if (entry.duration > worstLongTask.current) {
              worstLongTask.current = entry.duration;
            }
          }
        });
        obs.observe({ type: "longtask", buffered: false });
        observerRef.current = obs;
      } catch {
        // longtask not supported in all environments
      }
    }

    rafId.current = requestAnimationFrame(loop);

    return () => {
      stop();
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [active, loop, stop]);
}
