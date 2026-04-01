export type LegalDocId = "terms" | "eula" | "privacy";

export type ProviderRiskId = "x" | "facebook" | "instagram" | "linkedin";

export type LegalSurface =
  | "website-download"
  | "pwa-first-run"
  | "desktop-first-run"
  | "desktop-provider-x"
  | "desktop-provider-facebook"
  | "desktop-provider-instagram"
  | "desktop-provider-linkedin";

export interface LegalDocMeta {
  id: LegalDocId;
  label: string;
  path: string;
  url: string;
}

export interface LegalAcceptanceRecord {
  version: string;
  acceptedAt: number;
  surface: LegalSurface;
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDocMeta> = {
  terms: {
    id: "terms",
    label: "Terms of Use",
    path: "/terms",
    url: "https://freed.wtf/terms",
  },
  privacy: {
    id: "privacy",
    label: "Privacy Policy",
    path: "/privacy",
    url: "https://freed.wtf/privacy",
  },
  eula: {
    id: "eula",
    label: "Desktop EULA",
    path: "/eula",
    url: "https://freed.wtf/eula",
  },
};

export const LEGAL_BUNDLE_VERSION = "2026-03-31.1";

export const PROVIDER_RISK_VERSIONS: Record<ProviderRiskId, string> = {
  x: "2026-03-31-x",
  facebook: "2026-03-31-facebook",
  instagram: "2026-03-31-instagram",
  linkedin: "2026-03-31-linkedin",
};

export function isLegalAcceptanceRecord(
  value: unknown,
): value is LegalAcceptanceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LegalAcceptanceRecord>;
  return (
    typeof record.version === "string" &&
    Number.isFinite(record.acceptedAt) &&
    typeof record.surface === "string"
  );
}

export function coerceLegalAcceptanceRecord(
  value: unknown,
): LegalAcceptanceRecord | null {
  return isLegalAcceptanceRecord(value) ? value : null;
}

export function isAcceptanceCurrent(
  record: LegalAcceptanceRecord | null | undefined,
  version: string,
): boolean {
  return !!record && record.version === version && record.acceptedAt > 0;
}

export function createAcceptanceRecord(
  version: string,
  surface: LegalSurface,
  acceptedAt = Date.now(),
): LegalAcceptanceRecord {
  return {
    version,
    acceptedAt,
    surface,
  };
}

export function providerSurface(provider: ProviderRiskId): LegalSurface {
  switch (provider) {
    case "x":
      return "desktop-provider-x";
    case "facebook":
      return "desktop-provider-facebook";
    case "instagram":
      return "desktop-provider-instagram";
    case "linkedin":
      return "desktop-provider-linkedin";
  }
}
