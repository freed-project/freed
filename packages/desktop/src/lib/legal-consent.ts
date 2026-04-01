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

let legalStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (!legalStore) {
    legalStore = await load("legal.json", { defaults: {}, autoSave: true });
  }
  return legalStore;
}

async function readRecord(key: string): Promise<LegalAcceptanceRecord | null> {
  const store = await getStore();
  return coerceLegalAcceptanceRecord(await store.get<unknown>(key));
}

async function writeRecord(
  key: string,
  version: string,
  surface: Parameters<typeof createAcceptanceRecord>[1],
): Promise<LegalAcceptanceRecord> {
  const store = await getStore();
  const record = createAcceptanceRecord(version, surface);
  await store.set(key, record);
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
