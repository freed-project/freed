import { describe, expect, it } from "vitest";
import {
  formatBytesForMemoryLog,
  formatScrapeMemoryPressureDetails,
  getAdaptiveMemoryLimits,
  getEffectiveMemoryPressureBytes,
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
    expect(getAdaptiveMemoryLimits(128 * gib).criticalBytes).toBe(12 * gib);
  });

  it("classifies high and critical app resident memory", () => {
    const limits = getAdaptiveMemoryLimits(16 * 1024 * 1024 * 1024);

    expect(getMemoryPressureLevel(512 * 1024 * 1024)).toBe("normal");
    expect(getMemoryPressureLevel(limits.highBytes, limits)).toBe("high");
    expect(getMemoryPressureLevel(limits.criticalBytes, limits)).toBe("critical");
  });

  it("uses pressure bytes when resident RSS is higher but footprint is healthy", () => {
    const gib = 1024 * 1024 * 1024;

    expect(
      getEffectiveMemoryPressureBytes({
        processResidentBytes: 128 * 1024 * 1024,
        processFootprintBytes: 64 * 1024 * 1024,
        appResidentBytes: 6 * gib,
        appMemoryPressureBytes: 1 * gib,
      }),
    ).toBe(1 * gib);
  });

  it("falls back to resident bytes when pressure telemetry is unavailable", () => {
    const gib = 1024 * 1024 * 1024;

    expect(
      getEffectiveMemoryPressureBytes({
        processResidentBytes: 128 * 1024 * 1024,
        appResidentBytes: 6 * gib,
      }),
    ).toBe(6 * gib);
  });

  it("formats scrape memory pause details with pressure and limits", () => {
    const gib = 1024 * 1024 * 1024;
    const details = formatScrapeMemoryPressureDetails({
      before: {} as never,
      after: {
        totalPhysicalMemoryBytes: 64 * gib,
        processResidentBytes: 256 * 1024 * 1024,
        processFootprintBytes: 128 * 1024 * 1024,
        processVirtualBytes: 512 * 1024 * 1024,
        appResidentBytes: 6 * gib,
        appMemoryPressureBytes: 2 * gib,
        webkitTotalResidentBytes: 5 * gib,
        memoryHighBytes: 3 * gib,
        memoryCriticalBytes: 4 * gib,
        relayDocBytes: 0,
        relayClientCount: 0,
      },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: false,
    });

    expect(details).toContain("Memory pressure is 2.00 GB");
    expect(details).toContain("app RSS is 6.00 GB");
    expect(details).toContain("WebKit RSS is 5.00 GB");
    expect(details).toContain("high limit is 3.00 GB");
    expect(details).toContain("critical limit is 4.00 GB");
  });
});
