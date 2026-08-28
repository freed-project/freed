export const AUTOMATIC_SYNC_PROVIDERS = [
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "substack",
  "medium",
] as const;

export type AutomaticSyncProvider = (typeof AUTOMATIC_SYNC_PROVIDERS)[number];

export interface RandomSource {
  uniform(): number;
  id(): string;
}

export interface ProviderCadenceBounds {
  lowerMs: number;
  upperMs: number;
  source: "generated" | "custom";
}

export interface ProviderRegime {
  multiplier: number;
  startedAt: number;
  expiresAt: number;
}

const MIN_PROVIDER_CADENCE_MS = 5 * 60 * 1_000;
export const HIGH_FREQUENCY_WARNING_MS = 15 * 60 * 1_000;
const MAX_PROVIDER_CADENCE_MS = 24 * 60 * 60 * 1_000;
export const RELEASE_MIGRATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const REGIME_MIN_MS = 18 * 60 * 60 * 1_000;
const REGIME_MEDIAN_MS = 36 * 60 * 60 * 1_000;
const REGIME_MAX_MS = 72 * 60 * 60 * 1_000;

const HOUR_MS = 60 * 60 * 1_000;

const DEFAULT_LOWER_RANGES: Record<
  AutomaticSyncProvider,
  readonly [number, number]
> = {
  x: [0.5 * HOUR_MS, 2 * HOUR_MS],
  facebook: [0.5 * HOUR_MS, 2 * HOUR_MS],
  instagram: [0.5 * HOUR_MS, 2 * HOUR_MS],
  linkedin: [HOUR_MS, 2 * HOUR_MS],
  youtube: [0.5 * HOUR_MS, 2 * HOUR_MS],
  substack: [0.75 * HOUR_MS, 2 * HOUR_MS],
  medium: [0.75 * HOUR_MS, 2 * HOUR_MS],
};

function openUniform(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a value in [0, 1).");
  }
  return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, value));
}

function logUniform(lower: number, upper: number, random: RandomSource): number {
  const unit = openUniform(random.uniform());
  return Math.exp(Math.log(lower) + unit * (Math.log(upper) - Math.log(lower)));
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// Peter J. Acklam's inverse-normal approximation. The input is always open.
function inverseNormalCdf(probability: number): number {
  const p = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, probability));
  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
    q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function truncatedLognormal(
  lower: number,
  upper: number,
  median: number,
  sigma: number,
  random: RandomSource,
): number {
  const mu = Math.log(median);
  const lowerCdf = normalCdf((Math.log(lower) - mu) / sigma);
  const upperCdf = normalCdf((Math.log(upper) - mu) / sigma);
  const probability =
    lowerCdf + openUniform(random.uniform()) * (upperCdf - lowerCdf);
  const sampled = Math.exp(mu + sigma * inverseNormalCdf(probability));
  if (!(sampled > lower && sampled < upper)) {
    // Floating point can only reach this branch at machine precision. Resample
    // instead of creating endpoint mass through clamping.
    return truncatedLognormal(lower, upper, median, sigma, random);
  }
  return sampled;
}

export function createCryptoRandomSource(): RandomSource {
  const source = globalThis.crypto as
    | (Crypto & { randomUUID?: () => string })
    | undefined;
  if (!source?.getRandomValues) {
    throw new Error("Cryptographic randomness is unavailable.");
  }
  return {
    uniform() {
      const value = source.getRandomValues(new Uint32Array(1))[0];
      return (value + 0.5) / 4_294_967_296;
    },
    id() {
      if (source.randomUUID) return source.randomUUID();
      const bytes = source.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (value: number) => value.toString(16).padStart(2, "0")).join("");
    },
  };
}

export function validateProviderCadenceBounds(
  bounds: Pick<ProviderCadenceBounds, "lowerMs" | "upperMs">,
): string | null {
  if (!Number.isFinite(bounds.lowerMs) || !Number.isFinite(bounds.upperMs)) {
    return "Sync bounds must be finite numbers.";
  }
  if (bounds.lowerMs < MIN_PROVIDER_CADENCE_MS) {
    return "The lower bound must be at least 5 minutes.";
  }
  if (bounds.upperMs <= bounds.lowerMs) {
    return "The upper bound must be greater than the lower bound.";
  }
  if (bounds.upperMs > MAX_PROVIDER_CADENCE_MS) {
    return "The upper bound cannot exceed 24 hours.";
  }
  return null;
}

export function generateProviderCadenceBounds(
  provider: AutomaticSyncProvider,
  random: RandomSource,
): ProviderCadenceBounds {
  const [lowerMinimum, lowerMaximum] = DEFAULT_LOWER_RANGES[provider];
  const lowerMs = logUniform(lowerMinimum, lowerMaximum, random);
  const upperMinimum = Math.max(2 * lowerMs, 3 * HOUR_MS);
  return {
    lowerMs,
    upperMs: logUniform(upperMinimum, 6 * HOUR_MS, random),
    source: "generated",
  };
}

export function sampleProviderRegime(
  now: number,
  random: RandomSource,
): ProviderRegime {
  const multiplier = Math.pow(2, -1 + 2 * openUniform(random.uniform()));
  const lifetimeMs = truncatedLognormal(
    REGIME_MIN_MS,
    REGIME_MAX_MS,
    REGIME_MEDIAN_MS,
    0.45,
    random,
  );
  return { multiplier, startedAt: now, expiresAt: now + lifetimeMs };
}

export function sampleProviderDelayMs(input: {
  bounds: ProviderCadenceBounds;
  regimeMultiplier: number;
  yieldFactor: number;
  random: RandomSource;
}): number {
  const error = validateProviderCadenceBounds(input.bounds);
  if (error) throw new Error(error);
  const center =
    Math.sqrt(input.bounds.lowerMs * input.bounds.upperMs) *
    input.regimeMultiplier *
    input.yieldFactor;
  return truncatedLognormal(
    input.bounds.lowerMs,
    input.bounds.upperMs,
    center,
    0.65,
    input.random,
  );
}

export function nextProviderYieldFactor(input: {
  current: number;
  status: "success" | "empty" | "error" | "ignored";
  itemsSeen: number;
  itemsAdded: number;
}): number {
  const current = Math.min(2, Math.max(0.8, input.current));
  if (input.status === "empty" || (input.itemsSeen > 0 && input.itemsAdded === 0)) {
    return Math.min(2, current * 1.25);
  }
  if (input.status !== "success") return current;
  const highYield =
    input.itemsAdded >= 20 ||
    (input.itemsSeen >= 10 && input.itemsAdded / input.itemsSeen >= 0.5);
  if (highYield) return Math.max(0.8, current * 0.9);
  return current + (1 - current) / 2;
}

export function normalizedOverdue(now: number, dueAt: number, lowerMs: number): number {
  return Math.max(0, now - dueAt) / Math.max(1, lowerMs);
}
