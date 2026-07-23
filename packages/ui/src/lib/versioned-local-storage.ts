export type VersionedLocalStorageRead<T> =
  | { readonly status: "missing" }
  | { readonly status: "supported"; readonly value: T }
  | { readonly status: "unsupported"; readonly raw: string; readonly version: unknown }
  | { readonly status: "corrupt"; readonly raw: string }
  | { readonly status: "unavailable" };

export interface VersionedLocalStorageCodec<T> {
  readonly version: number;
  decode(value: Record<string, unknown>): T | null;
  encode(value: T): Record<string, unknown>;
}

interface VersionedLocalStorageWriteOptions {
  readonly replaceUnsupportedVersion?: boolean;
  readonly purgeRecoveryCopies?: boolean;
}

let recoverySequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVersionedLocalStorage<T>(
  raw: string | null,
  codec: VersionedLocalStorageCodec<T>,
): VersionedLocalStorageRead<T> {
  if (raw === null) return { status: "missing" };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !("version" in parsed)) {
      return { status: "corrupt", raw };
    }
    if (parsed.version !== codec.version) {
      return { status: "unsupported", raw, version: parsed.version };
    }
    const value = codec.decode(parsed);
    return value === null
      ? { status: "corrupt", raw }
      : { status: "supported", value };
  } catch {
    return { status: "corrupt", raw };
  }
}

export function readVersionedLocalStorage<T>(
  key: string,
  codec: VersionedLocalStorageCodec<T>,
): VersionedLocalStorageRead<T> {
  if (typeof window === "undefined") return { status: "unavailable" };
  try {
    return parseVersionedLocalStorage(window.localStorage.getItem(key), codec);
  } catch {
    return { status: "unavailable" };
  }
}

function preserveRecoveryCopy(
  key: string,
  state: Extract<VersionedLocalStorageRead<unknown>, { status: "corrupt" | "unsupported" }>,
): boolean {
  try {
    const recoveryKey = `${key}.recovery.${Date.now()}.${recoverySequence}`;
    recoverySequence += 1;
    window.localStorage.setItem(recoveryKey, JSON.stringify({
      capturedAt: Date.now(),
      reason: state.status,
      raw: state.raw,
    }));
    return true;
  } catch {
    return false;
  }
}

function purgeRecoveryCopies(key: string): boolean {
  try {
    const prefix = `${key}.recovery.`;
    const recoveryKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const candidate = window.localStorage.key(index);
      if (candidate?.startsWith(prefix)) recoveryKeys.push(candidate);
    }
    for (const recoveryKey of recoveryKeys) {
      window.localStorage.removeItem(recoveryKey);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a supported record without silently downgrading data from a newer app.
 * Corrupt data is preserved before replacement. Replacing a newer version is
 * reserved for explicit destructive actions such as a device reset.
 */
export function writeVersionedLocalStorage<T>(
  key: string,
  codec: VersionedLocalStorageCodec<T>,
  value: T,
  options: VersionedLocalStorageWriteOptions = {},
): boolean {
  if (typeof window === "undefined") return false;
  const existing = readVersionedLocalStorage(key, codec);
  if (existing.status === "unavailable") return false;
  if (existing.status === "unsupported" && !options.replaceUnsupportedVersion) {
    return false;
  }
  if (
    (existing.status === "corrupt" || existing.status === "unsupported")
    && !preserveRecoveryCopy(key, existing)
  ) {
    return false;
  }

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: codec.version, ...codec.encode(value) }),
    );
    return !options.purgeRecoveryCopies || purgeRecoveryCopies(key);
  } catch {
    return false;
  }
}
