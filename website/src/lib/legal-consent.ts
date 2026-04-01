"use client";

import {
  LEGAL_BUNDLE_VERSION,
  isAcceptanceCurrent,
  readAcceptanceFromStorage,
  writeAcceptanceToStorage,
  type LegalAcceptanceRecord,
} from "@freed/shared";

const WEBSITE_BUNDLE_KEY = "freed.legal.website.bundle";

export function getWebsiteBundleAcceptance(): LegalAcceptanceRecord | null {
  if (typeof window === "undefined") return null;
  return readAcceptanceFromStorage(window.localStorage, WEBSITE_BUNDLE_KEY);
}

export function hasAcceptedWebsiteBundle(): boolean {
  return isAcceptanceCurrent(getWebsiteBundleAcceptance(), LEGAL_BUNDLE_VERSION);
}

export function acceptWebsiteBundle(): LegalAcceptanceRecord | null {
  if (typeof window === "undefined") return null;
  return writeAcceptanceToStorage(
    window.localStorage,
    WEBSITE_BUNDLE_KEY,
    LEGAL_BUNDLE_VERSION,
    "website-download",
  );
}
