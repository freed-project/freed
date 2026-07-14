import type { RawMediumEntry, RawMediumProfile } from "@freed/capture-medium/browser";
import {
  deduplicateAccounts,
  deduplicateFeedItems,
  mediumEntriesToFeedItems,
  mediumProfilesToAccounts,
} from "@freed/capture-medium/browser";
import type { SocialScrapeTrigger } from "./runtime-health-events";
import { getMediumScraperWindowMode } from "./scraper-prefs";
import { storeMediumAuthState } from "./medium-auth";
import { useAppStore } from "./store";
import {
  captureAuthenticatedEssayProvider,
  type AuthenticatedEssayCaptureConfig,
  type AuthenticatedEssaySyncResult,
} from "./authenticated-essay-capture";

const MEDIUM_CAPTURE_CONFIG: AuthenticatedEssayCaptureConfig<RawMediumEntry, RawMediumProfile> = {
  provider: "medium",
  eventName: "medium-feed-data",
  commands: ["medium_scrape_graph", "medium_scrape_activity", "medium_scrape_essays"],
  getWindowMode: getMediumScraperWindowMode,
  normalizeEntries: mediumEntriesToFeedItems,
  normalizeProfiles: mediumProfilesToAccounts,
  deduplicateItems: deduplicateFeedItems,
  deduplicateAccounts,
  getAuth: () => useAppStore.getState().mediumAuth,
  setAuth: (auth) => useAppStore.getState().setMediumAuth(auth),
  storeAuth: storeMediumAuthState,
};

type MediumSyncResult = AuthenticatedEssaySyncResult;

export function captureMediumFeed(
  trigger: SocialScrapeTrigger = "unknown",
): Promise<MediumSyncResult> {
  return captureAuthenticatedEssayProvider(MEDIUM_CAPTURE_CONFIG, trigger);
}
