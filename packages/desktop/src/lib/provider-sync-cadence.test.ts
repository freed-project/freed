import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_SYNC_PROVIDERS,
  generateProviderCadenceBounds,
  nextProviderYieldFactor,
  sampleProviderDelayMs,
  sampleProviderRegime,
  validateProviderCadenceBounds,
  type RandomSource,
} from "./provider-sync-cadence";
import { simulateProviderCadence } from "./provider-sync-simulator";

function sequence(values: number[]): RandomSource {
  let index = 0;
  return {
    uniform: () => values[index++ % values.length],
    id: () => `id-${index.toLocaleString("en-US", { useGrouping: false })}`,
  };
}

describe("provider sync cadence", () => {
  it("generates independent valid defaults and strictly interior delays", () => {
    const random = sequence([0.03, 0.17, 0.31, 0.47, 0.61, 0.79, 0.93]);
    const signatures = new Set<string>();
    for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
      const bounds = generateProviderCadenceBounds(provider, random);
      const regime = sampleProviderRegime(1_000, random);
      const delay = sampleProviderDelayMs({
        bounds,
        regimeMultiplier: regime.multiplier,
        yieldFactor: 1,
        random,
      });
      expect(validateProviderCadenceBounds(bounds)).toBeNull();
      expect(delay).toBeGreaterThan(bounds.lowerMs);
      expect(delay).toBeLessThan(bounds.upperMs);
      expect(regime.expiresAt - regime.startedAt).not.toBe(24 * 60 * 60 * 1_000);
      signatures.add(`${bounds.lowerMs}:${bounds.upperMs}:${regime.expiresAt}`);
    }
    expect(signatures.size).toBe(AUTOMATIC_SYNC_PROVIDERS.length);
  });

  it("adjusts yield without letting errors shorten cadence", () => {
    expect(
      nextProviderYieldFactor({
        current: 1,
        status: "empty",
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    ).toBe(1.25);
    expect(
      nextProviderYieldFactor({
        current: 1.5,
        status: "success",
        itemsSeen: 5,
        itemsAdded: 1,
      }),
    ).toBe(1.25);
    expect(
      nextProviderYieldFactor({
        current: 1,
        status: "success",
        itemsSeen: 30,
        itemsAdded: 20,
      }),
    ).toBe(0.9);
    expect(
      nextProviderYieldFactor({
        current: 1.6,
        status: "error",
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    ).toBe(1.6);
  });

  it("simulates at least 100,000 installations without correlated waves or bound violations", () => {
    const report = simulateProviderCadence({
      installations: 100_000,
      seed: "provider-sync-cadence-v2-acceptance",
    });
    expect(report.installations).toBe(100_000);
    expect(report.minimumBoundViolations).toBe(0);
    expect(report.maximumBoundViolations).toBe(0);
    expect(report.exactTwentyFourHourRegimes).toBe(0);
    expect(report.wakeBurstViolations).toBe(0);
    expect(report.concurrentAutomaticViolations).toBe(0);
    expect(report.starvationRate).toBe(0);
    expect(report.rendererRestartDeadlineViolations).toBe(0);
    expect(report.localDeferralIntervalConsumptionViolations).toBe(0);
    expect(report.sharedProviderStateViolations).toBe(0);
    expect(report.logicalCaptureContactGrowthViolations).toBe(0);
    expect(report.legacyRestorationViolations).toBe(0);
    expect(report.defaultP95DailyOpportunities).toBeLessThanOrEqual(
      report.legacyP95DailyOpportunities,
    );
    expect(report.maxCrossProviderCorrelation).toBeLessThan(0.03);
    expect(report.maxCrossProviderMutualInformation).toBeLessThan(0.01);
    expect(report.classifierAccuracy).toBeGreaterThan(0.48);
    expect(report.classifierAccuracy).toBeLessThan(0.52);
    expect(report.releasePeakRatio).toBeLessThan(1.1);
    expect(report.midnightPeakRatio).toBeLessThan(1.1);
    expect(report.minuteArrivalPeakRatio).toBeLessThan(1.3);
    expect(report.tenMinuteArrivalPeakRatio).toBeLessThan(1.1);
    expect(report.hourArrivalPeakRatio).toBeLessThan(1.05);
    expect(report.dailyAutocorrelation).toBeLessThan(0.3);
    expect(report.dailyPeriodogramPower).toBeLessThan(0.01);
    expect(report.changePointRatio).toBeGreaterThan(0.95);
    expect(report.changePointRatio).toBeLessThan(1.05);
    expect(report.endpointDensity).toBeLessThan(0.01);
    expect(Object.keys(report.scenarios)).toHaveLength(11);
  }, 60_000);
});
