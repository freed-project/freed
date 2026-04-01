import {
  LEGAL_BUNDLE_VERSION,
  PROVIDER_RISK_VERSIONS,
  coerceLegalAcceptanceRecord,
  createAcceptanceRecord,
  isAcceptanceCurrent,
  providerSurface,
  type LegalAcceptanceRecord,
  type ProviderRiskId,
} from "@freed/shared";
import { Store, load } from "@tauri-apps/plugin-store";

const DESKTOP_BUNDLE_KEY = "legal.bundle.desktop";
const PROVIDER_PREFIX = "legal.provider";
const FALLBACK_STORAGE_PREFIX = "freed.legal.";

let legalStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (!legalStore) {
    legalStore = await load("legal.json", { defaults: {}, autoSave: true });
  }
  return legalStore;
}

function fallbackStorageKey(key: string): string {
  return `${FALLBACK_STORAGE_PREFIX}${key}`;
}

function readFallbackRecord(key: string): LegalAcceptanceRecord | null {
  try {
    const raw = window.localStorage.getItem(fallbackStorageKey(key));
    if (!raw) return null;
    return coerceLegalAcceptanceRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeFallbackRecord(key: string, record: LegalAcceptanceRecord): void {
  try {
    window.localStorage.setItem(
      fallbackStorageKey(key),
      JSON.stringify(record),
    );
  } catch {
    // Ignore localStorage failures, the caller already has the in-memory record.
  }
}

async function readRecord(key: string): Promise<LegalAcceptanceRecord | null> {
  try {
    const store = await getStore();
    return coerceLegalAcceptanceRecord(await store.get<unknown>(key));
  } catch (error) {
    console.error("[legal] failed to read consent store, falling back", error);
    return readFallbackRecord(key);
  }
}

async function writeRecord(
  key: string,
  version: string,
  surface: Parameters<typeof createAcceptanceRecord>[1],
): Promise<LegalAcceptanceRecord> {
  const record = createAcceptanceRecord(version, surface);
  try {
    const store = await getStore();
    await store.set(key, record);
  } catch (error) {
    console.error("[legal] failed to write consent store, falling back", error);
    writeFallbackRecord(key, record);
  }
  return record;
}

function providerKey(provider: ProviderRiskId): string {
  return `${PROVIDER_PREFIX}.${provider}`;
}

export async function getDesktopBundleAcceptance(): Promise<LegalAcceptanceRecord | null> {
  return readRecord(DESKTOP_BUNDLE_KEY);
}

export async function hasAcceptedDesktopBundle(): Promise<boolean> {
  return isAcceptanceCurrent(
    await getDesktopBundleAcceptance(),
    LEGAL_BUNDLE_VERSION,
  );
}

export async function acceptDesktopBundle(): Promise<LegalAcceptanceRecord> {
  return writeRecord(
    DESKTOP_BUNDLE_KEY,
    LEGAL_BUNDLE_VERSION,
    "desktop-first-run",
  );
}

export async function getProviderRiskAcceptance(
  provider: ProviderRiskId,
): Promise<LegalAcceptanceRecord | null> {
  return readRecord(providerKey(provider));
}

export async function hasAcceptedProviderRisk(
  provider: ProviderRiskId,
): Promise<boolean> {
  return isAcceptanceCurrent(
    await getProviderRiskAcceptance(provider),
    PROVIDER_RISK_VERSIONS[provider],
  );
}

export async function acceptProviderRisk(
  provider: ProviderRiskId,
): Promise<LegalAcceptanceRecord> {
  return writeRecord(
    providerKey(provider),
    PROVIDER_RISK_VERSIONS[provider],
    providerSurface(provider),
  );
}
