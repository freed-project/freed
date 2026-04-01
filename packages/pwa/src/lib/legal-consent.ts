import {
  LEGAL_BUNDLE_VERSION,
  isAcceptanceCurrent,
  readAcceptanceFromStorage,
  writeAcceptanceToStorage,
  type LegalAcceptanceRecord,
} from "@freed/shared";

const PWA_BUNDLE_KEY = "freed.legal.pwa.bundle";

export function getPwaBundleAcceptance(): LegalAcceptanceRecord | null {
  return readAcceptanceFromStorage(window.localStorage, PWA_BUNDLE_KEY);
}

export function hasAcceptedPwaBundle(): boolean {
  return isAcceptanceCurrent(getPwaBundleAcceptance(), LEGAL_BUNDLE_VERSION);
}

export function acceptPwaBundle(): LegalAcceptanceRecord {
  return writeAcceptanceToStorage(
    window.localStorage,
    PWA_BUNDLE_KEY,
    LEGAL_BUNDLE_VERSION,
    "pwa-first-run",
  );
}
