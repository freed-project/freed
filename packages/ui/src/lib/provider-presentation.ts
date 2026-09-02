import { PLATFORM_LABELS, type Platform } from "@freed/shared";

export type ProviderPresentationStage = "beta";

export type SettingsProviderId = Extract<
  Platform,
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "substack"
  | "medium"
  | "youtube"
>;

export interface ProviderPresentation {
  label: string;
  stage?: ProviderPresentationStage;
}

/** Canonical labels and maturity stages shared by provider navigation surfaces. */
export const PROVIDER_PRESENTATION = {
  x: { label: "X / Twitter" },
  facebook: { label: PLATFORM_LABELS.facebook },
  instagram: { label: PLATFORM_LABELS.instagram },
  linkedin: { label: PLATFORM_LABELS.linkedin },
  substack: { label: PLATFORM_LABELS.substack, stage: "beta" },
  medium: { label: PLATFORM_LABELS.medium, stage: "beta" },
  youtube: { label: PLATFORM_LABELS.youtube, stage: "beta" },
} as const satisfies Record<SettingsProviderId, ProviderPresentation>;
