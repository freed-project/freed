import { describe, expect, it } from "vitest";
import { formatBytesForMemoryLog, getMemoryPressureLevel } from "./memory-monitor";

describe("memory monitor", () => {
  it("formats byte values for log output", () => {
    expect(formatBytesForMemoryLog(512)).toBe("512 B");
    expect(formatBytesForMemoryLog(1536)).toBe("1.5 KB");
    expect(formatBytesForMemoryLog(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytesForMemoryLog(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("classifies high and critical resident memory", () => {
    expect(getMemoryPressureLevel(512 * 1024 * 1024)).toBe("normal");
    expect(getMemoryPressureLevel(1_500 * 1024 * 1024)).toBe("high");
    expect(getMemoryPressureLevel(3_000 * 1024 * 1024)).toBe("critical");
  });
});
