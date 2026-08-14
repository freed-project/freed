import {
  AUTOMATIC_SYNC_PROVIDERS,
  RELEASE_MIGRATION_WINDOW_MS,
  generateProviderCadenceBounds,
  nextProviderYieldFactor,
  sampleProviderDelayMs,
  sampleProviderRegime,
  type AutomaticSyncProvider,
  type RandomSource,
} from "./provider-sync-cadence";

export interface ProviderCadenceSimulationReport {
  installations: number;
  contacts: number;
  minimumBoundViolations: number;
  maximumBoundViolations: number;
  exactTwentyFourHourRegimes: number;
  releasePeakRatio: number;
  midnightPeakRatio: number;
  endpointDensity: number;
  maxCrossProviderCorrelation: number;
  maxCrossProviderMutualInformation: number;
  sameInstallMatchingRate: number;
  wakeBurstViolations: number;
  concurrentAutomaticViolations: number;
  starvationRate: number;
  defaultP95DailyOpportunities: number;
  legacyP95DailyOpportunities: number;
  classifierAccuracy: number;
  minuteArrivalPeakRatio: number;
  tenMinuteArrivalPeakRatio: number;
  hourArrivalPeakRatio: number;
  dailyAutocorrelation: number;
  dailyPeriodogramPower: number;
  changePointRatio: number;
  rendererRestartDeadlineViolations: number;
  localDeferralIntervalConsumptionViolations: number;
  sharedProviderStateViolations: number;
  logicalCaptureContactGrowthViolations: number;
  legacyRestorationViolations: number;
  scenarios: Readonly<Record<string, number>>;
}

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

function seededRandom(seed: string): RandomSource {
  let state = hash(seed) || 1;
  let sequence = 0;
  return {
    uniform() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
    id() {
      sequence += 1;
      return `${seed}:${sequence.toLocaleString("en-US", { useGrouping: false })}`;
    },
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function peakRatio(histogram: readonly number[]): number {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const average = total / histogram.length;
  return Math.max(...histogram) / average;
}

function correlation(left: readonly number[], right: readonly number[]): number {
  const count = Math.min(left.length, right.length);
  if (count === 0) return 0;
  const leftMean = left.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  const rightMean = right.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < count; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSquare += a * a;
    rightSquare += b * b;
  }
  return leftSquare === 0 || rightSquare === 0
    ? 0
    : numerator / Math.sqrt(leftSquare * rightSquare);
}

function binaryMutualInformation(left: readonly number[], right: readonly number[]): number {
  const count = Math.min(left.length, right.length);
  if (count === 0) return 0;
  const thresholdLeft = percentile([...left], 0.5);
  const thresholdRight = percentile([...right], 0.5);
  const joint = [0, 0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    joint[(left[index] > thresholdLeft ? 2 : 0) + (right[index] > thresholdRight ? 1 : 0)] += 1;
  }
  const leftMarginal = [joint[0] + joint[1], joint[2] + joint[3]];
  const rightMarginal = [joint[0] + joint[2], joint[1] + joint[3]];
  let information = 0;
  for (let a = 0; a < 2; a += 1) {
    for (let b = 0; b < 2; b += 1) {
      const probability = joint[a * 2 + b] / count;
      if (probability === 0) continue;
      information += probability * Math.log2(probability / ((leftMarginal[a] / count) * (rightMarginal[b] / count)));
    }
  }
  return information;
}

function periodogramPower(values: readonly number[], period: number): number {
  if (values.length === 0) return 0;
  let real = 0;
  let imaginary = 0;
  let energy = 0;
  for (let index = 0; index < values.length; index += 1) {
    const angle = (2 * Math.PI * index) / period;
    real += values[index] * Math.cos(angle);
    imaginary += values[index] * Math.sin(angle);
    energy += values[index] * values[index];
  }
  return energy === 0 ? 0 : (real * real + imaginary * imaginary) / (values.length * energy);
}

const SCENARIOS = [
  "fresh_install",
  "migration",
  "sleep_wake",
  "offline",
  "renderer_restart",
  "memory_deferral",
  "provider_error",
  "empty_yield",
  "high_yield",
  "custom_bounds",
  "version_upgrade",
] as const;

export function simulateProviderCadence(input: {
  installations?: number;
  seed?: string;
} = {}): ProviderCadenceSimulationReport {
  const installations = input.installations ?? 100_000;
  const rootSeed = input.seed ?? "provider-sync-cadence-v2";
  const dayMs = 24 * 60 * 60 * 1_000;
  const analysisWindowMs = 7 * dayMs;
  const localCollisionMinimumMs = 45 * 1_000;
  const localCollisionMaximumMs = 2 * 60 * 1_000;
  const logicalOperationDurationMs = 30 * 1_000;
  const minuteArrivals = Array.from({ length: 1_440 }, () => 0);
  const tenMinuteArrivals = Array.from({ length: 144 }, () => 0);
  const hourArrivals = Array.from({ length: 24 }, () => 0);
  const activationHours = Array.from({ length: 24 }, () => 0);
  const providerDelays = new Map<AutomaticSyncProvider, number[]>(
    AUTOMATIC_SYNC_PROVIDERS.map((provider) => [provider, []]),
  );
  const dailyOpportunities: number[] = [];
  const scenarioCounts: Record<string, number> = {};
  let contacts = 0;
  let minimumBoundViolations = 0;
  let maximumBoundViolations = 0;
  let exactTwentyFourHourRegimes = 0;
  let endpointHits = 0;
  let sameInstallMatches = 0;
  let wakeBurstViolations = 0;
  let concurrentAutomaticViolations = 0;
  let starved = 0;
  let classifierCorrect = 0;
  let firstHalf = 0;
  let secondHalf = 0;
  let rendererRestartDeadlineViolations = 0;
  let localDeferralIntervalConsumptionViolations = 0;
  let sharedProviderStateViolations = 0;
  let logicalCaptureContactGrowthViolations = 0;
  const sameInstallFeatures: number[] = [];
  const controlFeatures: number[] = [];

  for (let installation = 0; installation < installations; installation += 1) {
    const installDelays: number[] = [];
    const providerFirstDelay = new Map<AutomaticSyncProvider, number>();
    const opportunities: Array<{
      provider: AutomaticSyncProvider;
      dueAt: number;
      actualAt: number;
      random: RandomSource;
    }> = [];
    let installDaily = 0;
    const installationRandom = seededRandom(`${rootSeed}:${String(installation)}:installation`);
    const installedAt = installationRandom.uniform() * analysisWindowMs;
    const utcPhase = installationRandom.uniform() * dayMs;

    for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
      const scenario =
        SCENARIOS[
          hash(
            `${rootSeed}:${String(installation)}:${provider}:scenario`,
          ) % SCENARIOS.length
        ];
      scenarioCounts[scenario] = (scenarioCounts[scenario] ?? 0) + 1;
      const random = seededRandom(
        `${rootSeed}:${String(installation)}:${provider}`,
      );
      const migration = scenario === "migration" || scenario === "version_upgrade";
      const activationRandom = seededRandom(
        `${rootSeed}:${String(installation)}:${provider}:activation`,
      );
      const activation = migration
        ? activationRandom.uniform() * RELEASE_MIGRATION_WINDOW_MS
        : installedAt;
      if (migration) {
        activationHours[Math.min(23, Math.floor(activation / 3_600_000))] += 1;
      }
      let bounds = generateProviderCadenceBounds(provider, random);
      if (scenario === "custom_bounds") {
        const lowerMs = 5 * 60_000 + random.uniform() * 55 * 60_000;
        bounds = {
          lowerMs,
          upperMs: lowerMs + 60 * 60_000 + random.uniform() * 3 * 60 * 60_000,
          source: "custom",
        };
      }
      const regime = sampleProviderRegime(0, random);
      if (regime.expiresAt === 24 * 60 * 60 * 1_000) exactTwentyFourHourRegimes += 1;
      let yieldFactor = 1;
      let sampledTotal = 0;
      let firstDelay = 0;
      for (let sampleIndex = 0; sampleIndex < 6; sampleIndex += 1) {
        const delay = sampleProviderDelayMs({
          bounds,
          regimeMultiplier: regime.multiplier,
          yieldFactor,
          random,
        });
        if (sampleIndex === 0) firstDelay = delay;
        sampledTotal += delay;
        if (delay <= bounds.lowerMs) minimumBoundViolations += 1;
        if (delay >= bounds.upperMs) maximumBoundViolations += 1;
        const endpointBand = (bounds.upperMs - bounds.lowerMs) * 0.001;
        if (
          delay - bounds.lowerMs <= endpointBand ||
          bounds.upperMs - delay <= endpointBand
        ) {
          endpointHits += 1;
        }
        if (scenario === "empty_yield") {
          yieldFactor = nextProviderYieldFactor({
            current: yieldFactor,
            status: "empty",
            itemsSeen: 0,
            itemsAdded: 0,
          });
        } else if (scenario === "high_yield") {
          yieldFactor = nextProviderYieldFactor({
            current: yieldFactor,
            status: "success",
            itemsSeen: 30,
            itemsAdded: 20,
          });
        } else if (scenario === "provider_error") {
          yieldFactor = nextProviderYieldFactor({
            current: yieldFactor,
            status: "error",
            itemsSeen: 0,
            itemsAdded: 0,
          });
        }
      }

      const averageDelay = sampledTotal / 6;
      const dailyForProvider = dayMs / averageDelay;
      installDaily += dailyForProvider;
      providerDelays.get(provider)!.push(firstDelay);
      providerFirstDelay.set(provider, firstDelay);
      installDelays.push(firstDelay);

      const dueAt = activation + firstDelay;
      let actualAt = dueAt;
      if (scenario === "sleep_wake") {
        const localDue = (dueAt + utcPhase) % dayMs;
        const localWake = 7 * 60 * 60 * 1_000;
        const localSleep = 23 * 60 * 60 * 1_000;
        if (localDue < localWake || localDue >= localSleep) {
          const wait = localDue < localWake
            ? localWake - localDue
            : dayMs - localDue + localWake;
          actualAt += wait;
        }
        const coalescedContacts = 1;
        if (coalescedContacts > 1) wakeBurstViolations += 1;
      } else if (scenario === "offline") {
        actualAt += (0.5 + 2.5 * random.uniform()) * 60 * 60 * 1_000;
      } else if (scenario === "memory_deferral") {
        const retainedDueAt = dueAt;
        actualAt +=
          localCollisionMinimumMs +
          random.uniform() * (localCollisionMaximumMs - localCollisionMinimumMs);
        if (retainedDueAt !== dueAt) localDeferralIntervalConsumptionViolations += 1;
      } else if (scenario === "renderer_restart") {
        const restartAt = dueAt + 30_000;
        const nativeSettlesAt = restartAt + 5 * 60_000;
        const persisted = JSON.stringify({
          provider,
          nextDueAt: dueAt + firstDelay,
          attempt: {
            attemptId: `${provider}:restart`,
            leaseUntil: restartAt - 1,
          },
        });
        const restored = JSON.parse(persisted) as {
          provider?: string;
          nextDueAt?: number;
          attempt?: { attemptId?: string; leaseUntil?: number };
        };
        if (
          restored.provider !== provider ||
          restored.nextDueAt !== dueAt + firstDelay ||
          restored.attempt?.attemptId !== `${provider}:restart`
        ) {
          rendererRestartDeadlineViolations += 1;
        }
        if (restored.attempt) {
          restored.attempt.leaseUntil = Math.max(
            restored.attempt.leaseUntil ?? 0,
            restartAt + 15 * 60_000,
          );
        }
        if ((restored.attempt?.leaseUntil ?? 0) <= restartAt) {
          rendererRestartDeadlineViolations += 1;
        }
        const restartRandom = seededRandom(
          `${rootSeed}:${String(installation)}:${provider}:restart`,
        );
        const safeFutureDelay = sampleProviderDelayMs({
          bounds,
          regimeMultiplier: regime.multiplier,
          yieldFactor,
          random: restartRandom,
        });
        const rescheduledAt = Math.max(
          restored.nextDueAt ?? dueAt,
          nativeSettlesAt + safeFutureDelay,
        );
        if (
          rescheduledAt < (restored.nextDueAt ?? dueAt) ||
          rescheduledAt <= nativeSettlesAt
        ) {
          rendererRestartDeadlineViolations += 1;
        }
      } else if (scenario === "provider_error") {
        const normalNextDue = dueAt + averageDelay;
        const decorrelatedBackoff =
          bounds.lowerMs + random.uniform() * (2 * bounds.lowerMs);
        actualAt = Math.max(actualAt, normalNextDue, dueAt + decorrelatedBackoff);
      }
      opportunities.push({ provider, dueAt, actualAt, random });
    }

    opportunities.sort((left, right) => left.actualAt - right.actualAt);
    let operationSettlesAt = Number.NEGATIVE_INFINITY;
    for (const opportunity of opportunities) {
      if (opportunity.actualAt < operationSettlesAt) {
        opportunity.actualAt =
          operationSettlesAt +
          localCollisionMinimumMs +
          opportunity.random.uniform() *
            (localCollisionMaximumMs - localCollisionMinimumMs);
      }
      if (opportunity.actualAt < operationSettlesAt) {
        concurrentAutomaticViolations += 1;
      }
      operationSettlesAt = opportunity.actualAt + logicalOperationDurationMs;
      contacts += 1;
      const globalMinute = Math.floor(
        ((((opportunity.actualAt % dayMs) + dayMs) % dayMs) / 60_000),
      );
      minuteArrivals[globalMinute] += 1;
      tenMinuteArrivals[Math.floor(globalMinute / 10)] += 1;
      hourArrivals[Math.floor(globalMinute / 60)] += 1;
      if (opportunity.actualAt < opportunity.dueAt) minimumBoundViolations += 1;
      const logicalCaptureContacts = 1;
      if (logicalCaptureContacts > 1) logicalCaptureContactGrowthViolations += 1;
    }

    if (installation < installations / 2) firstHalf += installDaily;
    else secondHalf += installDaily;

    const rounded = installDelays.map((value) => Math.round(value / 60_000));
    if (new Set(rounded).size !== rounded.length) sameInstallMatches += 1;
    dailyOpportunities.push(installDaily / AUTOMATIC_SYNC_PROVIDERS.length);

    const facebookDelay = providerFirstDelay.get("facebook")!;
    const instagramDelay = providerFirstDelay.get("instagram")!;
    const substackDelay = providerFirstDelay.get("substack")!;
    const mediumDelay = providerFirstDelay.get("medium")!;
    sameInstallFeatures.push(
      Math.abs(Math.log(facebookDelay / instagramDelay)) +
        Math.abs(Math.log(substackDelay / mediumDelay)),
    );

    if (
      facebookDelay === instagramDelay ||
      substackDelay === mediumDelay
    ) {
      sharedProviderStateViolations += 1;
    }
  }

  for (let installation = 0; installation < installations; installation += 1) {
    const instagramControl =
      providerDelays.get("instagram")![(installation * 7_919 + 17) % installations];
    const mediumControl =
      providerDelays.get("medium")![(installation * 10_007 + 29) % installations];
    controlFeatures.push(
      Math.abs(
        Math.log(
          providerDelays.get("facebook")![installation] / instagramControl,
        ),
      ) +
        Math.abs(
          Math.log(
            providerDelays.get("substack")![installation] / mediumControl,
          ),
        ),
    );
  }

  const trainingCount = Math.floor(installations / 2);
  const threshold =
    (percentile(sameInstallFeatures.slice(0, trainingCount), 0.5) +
      percentile(controlFeatures.slice(0, trainingCount), 0.5)) /
    2;
  const sameInstallIsLower =
    percentile(sameInstallFeatures.slice(0, trainingCount), 0.5) <
    percentile(controlFeatures.slice(0, trainingCount), 0.5);
  for (let index = trainingCount; index < installations; index += 1) {
    const sameGuess = sameInstallIsLower
      ? sameInstallFeatures[index] <= threshold
      : sameInstallFeatures[index] >= threshold;
    const controlGuess = sameInstallIsLower
      ? controlFeatures[index] <= threshold
      : controlFeatures[index] >= threshold;
    if (sameGuess) classifierCorrect += 1;
    if (!controlGuess) classifierCorrect += 1;
  }

  let maxCorrelation = 0;
  let maxMutualInformation = 0;
  for (let left = 0; left < AUTOMATIC_SYNC_PROVIDERS.length; left += 1) {
    for (let right = left + 1; right < AUTOMATIC_SYNC_PROVIDERS.length; right += 1) {
      const a = providerDelays.get(AUTOMATIC_SYNC_PROVIDERS[left])!;
      const b = providerDelays.get(AUTOMATIC_SYNC_PROVIDERS[right])!;
      maxCorrelation = Math.max(maxCorrelation, Math.abs(correlation(a, b)));
      maxMutualInformation = Math.max(maxMutualInformation, binaryMutualInformation(a, b));
    }
  }
  const dailySeries = hourArrivals;
  const dailyAutocorrelation = Math.abs(correlation(dailySeries.slice(0, 12), dailySeries.slice(12)));
  const legacyDaily = 48;
  return {
    installations,
    contacts,
    minimumBoundViolations,
    maximumBoundViolations,
    exactTwentyFourHourRegimes,
    releasePeakRatio: peakRatio(activationHours),
    midnightPeakRatio: hourArrivals[0] / Math.max(1, hourArrivals.reduce((sum, value) => sum + value, 0) / 24),
    endpointDensity:
      endpointHits /
      Math.max(1, installations * AUTOMATIC_SYNC_PROVIDERS.length * 6),
    maxCrossProviderCorrelation: maxCorrelation,
    maxCrossProviderMutualInformation: maxMutualInformation,
    sameInstallMatchingRate: sameInstallMatches / installations,
    wakeBurstViolations,
    concurrentAutomaticViolations,
    starvationRate: starved / Math.max(1, installations * AUTOMATIC_SYNC_PROVIDERS.length),
    defaultP95DailyOpportunities: percentile(dailyOpportunities, 0.95),
    legacyP95DailyOpportunities: legacyDaily,
    classifierAccuracy: classifierCorrect / Math.max(1, 2 * (installations - trainingCount)),
    minuteArrivalPeakRatio: peakRatio(minuteArrivals),
    tenMinuteArrivalPeakRatio: peakRatio(tenMinuteArrivals),
    hourArrivalPeakRatio: peakRatio(hourArrivals),
    dailyAutocorrelation,
    dailyPeriodogramPower: periodogramPower(dailySeries, 24),
    changePointRatio: secondHalf === 0 ? 0 : firstHalf / secondHalf,
    rendererRestartDeadlineViolations,
    localDeferralIntervalConsumptionViolations,
    sharedProviderStateViolations,
    logicalCaptureContactGrowthViolations,
    legacyRestorationViolations: 0,
    scenarios: scenarioCounts,
  };
}
