import { invoke } from "@tauri-apps/api/core";
import type { DesktopClientRegistration } from "@freed/shared";
import { readNativeJsonValue, writeNativeJsonValue } from "./native-json-store";

const STORE_FILE = "desktop-client.json";
const STORE_KEY = "registration";
const FALLBACK_STORAGE_KEY = "freed-desktop-client-registration-v1";
const NATIVE_READ_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20;

interface LocalDesktopClientRegistration extends DesktopClientRegistration {
  readonly version: 1;
  readonly installationWitness?: string;
}

type FallbackRead =
  | { readonly status: "missing" }
  | {
    readonly status: "valid";
    readonly registration: LocalDesktopClientRegistration;
    readonly legacy: boolean;
  }
  | { readonly status: "unsupported" }
  | { readonly status: "corrupt"; readonly raw: string }
  | { readonly status: "unavailable" };

type RegistrationRead = Exclude<FallbackRead, { status: "missing" | "unavailable" }>;
type NativeRead = RegistrationRead | { readonly status: "missing" };

let cachedRegistration: DesktopClientRegistration | null = null;
let registrationPromise: Promise<DesktopClientRegistration> | null = null;

function parseRegistration(value: unknown, raw?: string): RegistrationRead {
  const recoveryRaw = raw ?? String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "corrupt", raw: recoveryRaw };
  }
  const candidate = value as Partial<LocalDesktopClientRegistration>;
  if (candidate.version !== undefined && candidate.version !== 1) {
    return { status: "unsupported" };
  }
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > 128 ||
    typeof candidate.registeredAt !== "number" ||
    !Number.isFinite(candidate.registeredAt) ||
    candidate.registeredAt < 0 ||
    (candidate.installationWitness !== undefined && (
      typeof candidate.installationWitness !== "string"
      || candidate.installationWitness.length === 0
      || candidate.installationWitness.length > 256
    ))
  ) {
    return { status: "corrupt", raw: recoveryRaw };
  }
  return {
    status: "valid",
    legacy: candidate.version === undefined,
    registration: {
      version: 1,
      id: candidate.id,
      registeredAt: candidate.registeredAt,
      ...(candidate.installationWitness
        ? { installationWitness: candidate.installationWitness }
        : {}),
    },
  };
}

function readFallbackRegistration(): FallbackRead {
  if (typeof window === "undefined") return { status: "unavailable" };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "missing" };
  try {
    return parseRegistration(JSON.parse(raw), raw);
  } catch {
    return { status: "corrupt", raw };
  }
}

function writeFallbackRegistration(registration: LocalDesktopClientRegistration): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(registration));
    return true;
  } catch {
    return false;
  }
}

function preserveCorruptFallback(raw: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const recoveryKey = `${FALLBACK_STORAGE_KEY}.recovery.${Date.now()}`;
    window.localStorage.setItem(recoveryKey, JSON.stringify({
      capturedAt: Date.now(),
      raw,
      reason: "corrupt",
    }));
    return true;
  } catch {
    return false;
  }
}

function createRegistration(installationWitness: string): LocalDesktopClientRegistration {
  return {
    version: 1,
    id: crypto.randomUUID(),
    registeredAt: Date.now(),
    installationWitness,
  };
}

function withWitness(
  registration: LocalDesktopClientRegistration,
  installationWitness: string,
): LocalDesktopClientRegistration {
  return {
    version: 1,
    id: registration.id,
    registeredAt: registration.registeredAt,
    installationWitness,
  };
}

function isBoundToInstallation(
  registration: LocalDesktopClientRegistration,
  installationWitness: string,
): boolean {
  return registration.installationWitness === installationWitness;
}

function toSynchronizedRegistration(
  registration: LocalDesktopClientRegistration,
): DesktopClientRegistration {
  return { id: registration.id, registeredAt: registration.registeredAt };
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS * attempt);
  });
}

async function readNativeRegistrationValue(): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NATIVE_READ_ATTEMPTS; attempt += 1) {
    try {
      return await readNativeJsonValue(STORE_FILE, STORE_KEY);
    } catch (error) {
      lastError = error;
      if (attempt < NATIVE_READ_ATTEMPTS) await waitBeforeRetry(attempt);
    }
  }
  throw new Error("Could not verify the existing Freed Desktop registration", {
    cause: lastError,
  });
}

async function getInstallationWitness(): Promise<string> {
  const witness = await invoke<string>("get_desktop_installation_witness");
  if (!/^[a-f0-9]{64}$/i.test(witness)) {
    throw new TypeError("Freed Desktop returned an invalid installation witness");
  }
  return witness.toLocaleLowerCase();
}

async function loadDesktopClientRegistration(): Promise<DesktopClientRegistration> {
  const installationWitness = await getInstallationWitness();
  const nativeValue = await readNativeRegistrationValue();
  const native: NativeRead = nativeValue === null || nativeValue === undefined
    ? { status: "missing" }
    : parseRegistration(nativeValue);
  const fallback = readFallbackRegistration();
  if (native.status === "unsupported" || fallback.status === "unsupported") {
    throw new Error("A newer Freed Desktop registration format is present");
  }

  const nativeRegistration = native.status === "valid"
    ? native.registration
    : null;
  const fallbackRegistration = fallback.status === "valid"
    ? fallback.registration
    : null;

  let selected: LocalDesktopClientRegistration;
  if (nativeRegistration && (
    nativeRegistration.installationWitness === undefined
    || isBoundToInstallation(nativeRegistration, installationWitness)
  )) {
    selected = withWitness(nativeRegistration, installationWitness);
  } else if (
    nativeRegistration
    && fallbackRegistration
    && isBoundToInstallation(fallbackRegistration, installationWitness)
  ) {
    selected = fallbackRegistration;
  } else if (nativeRegistration) {
    selected = createRegistration(installationWitness);
  } else if (native.status === "corrupt") {
    if (!fallbackRegistration) {
      throw new TypeError("The Freed Desktop registration is corrupt");
    }
    selected = fallbackRegistration.installationWitness === undefined
      || isBoundToInstallation(fallbackRegistration, installationWitness)
      ? withWitness(fallbackRegistration, installationWitness)
      : createRegistration(installationWitness);
  } else if (fallbackRegistration && (
    fallbackRegistration.installationWitness === undefined
    || isBoundToInstallation(fallbackRegistration, installationWitness)
  )) {
    selected = withWitness(fallbackRegistration, installationWitness);
  } else if (fallbackRegistration) {
    selected = createRegistration(installationWitness);
  } else if (fallback.status === "missing") {
    selected = createRegistration(installationWitness);
  } else {
    throw new Error("Could not verify the backup Freed Desktop registration");
  }

  const nativeMatches = native.status === "valid"
    && !native.legacy
    && nativeRegistration?.id === selected.id
    && nativeRegistration.registeredAt === selected.registeredAt
    && nativeRegistration.installationWitness === selected.installationWitness;
  let nativeWriteSucceeded = nativeMatches;
  if (!nativeMatches) {
    try {
      await writeNativeJsonValue(
        STORE_FILE,
        STORE_KEY,
        selected,
        "desktop-client-registration",
      );
      nativeWriteSucceeded = true;
    } catch {
      nativeWriteSucceeded = false;
    }
  }
  const fallbackMatches = fallback.status === "valid"
    && !fallback.legacy
    && fallbackRegistration?.id === selected.id
    && fallbackRegistration.registeredAt === selected.registeredAt
    && fallbackRegistration.installationWitness === selected.installationWitness;
  let fallbackWriteSucceeded = fallbackMatches;
  if (!fallbackMatches && fallback.status !== "unavailable") {
    const recoverySucceeded = fallback.status !== "corrupt"
      || preserveCorruptFallback(fallback.raw);
    fallbackWriteSucceeded = recoverySucceeded
      && writeFallbackRegistration(selected);
  }
  if (!nativeWriteSucceeded && !fallbackWriteSucceeded) {
    throw new Error("Could not persist the Freed Desktop registration");
  }

  return toSynchronizedRegistration(selected);
}

/** Return the stable identity for this Freed Desktop installation. */
export async function getOrCreateDesktopClientRegistration(): Promise<DesktopClientRegistration> {
  if (cachedRegistration) return cachedRegistration;
  if (!registrationPromise) {
    registrationPromise = loadDesktopClientRegistration()
      .then((registration) => {
        cachedRegistration = registration;
        return registration;
      })
      .finally(() => {
        registrationPromise = null;
      });
  }
  return registrationPromise;
}

/** Test-only reset for the module cache. */
export function resetDesktopClientRegistrationForTests(): void {
  cachedRegistration = null;
  registrationPromise = null;
}
