import { describe, expect, it } from "vitest";
import {
  formatBytesForMemoryLog,
  getAdaptiveMemoryLimits,
  getMemoryPressureLevel,
} from "./memory-monitor";

describe("memory monitor", () => {
  it("formats byte values for log output", () => {
    expect(formatBytesForMemoryLog(512)).toBe("512 B");
    expect(formatBytesForMemoryLog(1536)).toBe("1.5 KB");
    expect(formatBytesForMemoryLog(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytesForMemoryLog(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("derives adaptive high and critical resident memory limits", () => {
    const gib = 1024 * 1024 * 1024;

    expect(getAdaptiveMemoryLimits(16 * gib).criticalBytes).toBe(3.5 * gib);
    expect(getAdaptiveMemoryLimits(32 * gib).criticalBytes).toBe(
      Math.floor(32 * gib * 0.12),
    );
    expect(getAdaptiveMemoryLimits(64 * gib).criticalBytes).toBe(
      Math.floor(64 * gib * 0.12),
    );
  });

  it("classifies high and critical app resident memory", () => {
    const limits = getAdaptiveMemoryLimits(16 * 1024 * 1024 * 1024);

    expect(getMemoryPressureLevel(512 * 1024 * 1024)).toBe("normal");
    expect(getMemoryPressureLevel(limits.highBytes, limits)).toBe("high");
    expect(getMemoryPressureLevel(limits.criticalBytes, limits)).toBe("critical");
  });
});
