import type { RawSubstackEntry, RawSubstackProfile } from "@freed/capture-substack/browser";
import {
  deduplicateAccounts,
  deduplicateFeedItems,
  substackEntriesToFeedItems,
  substackProfilesToAccounts,
} from "@freed/capture-substack/browser";
import type { SocialScrapeTrigger } from "./runtime-health-events";
import { getSubstackScraperWindowMode } from "./scraper-prefs";
import { storeSubstackAuthState } from "./substack-auth";
import { useAppStore } from "./store";
import {
  captureAuthenticatedEssayProvider,
  type AuthenticatedEssayCaptureConfig,
  type AuthenticatedEssaySyncResult,
} from "./authenticated-essay-capture";

const SUBSTACK_CAPTURE_CONFIG: AuthenticatedEssayCaptureConfig<
  RawSubstackEntry,
  RawSubstackProfile
> = {
  provider: "substack",
  eventName: "substack-feed-data",
  commands: ["substack_scrape_graph", "substack_scrape_activity", "substack_scrape_essays"],
  getWindowMode: getSubstackScraperWindowMode,
  normalizeEntries: substackEntriesToFeedItems,
  normalizeProfiles: substackProfilesToAccounts,
  deduplicateItems: deduplicateFeedItems,
  deduplicateAccounts,
  getAuth: () => useAppStore.getState().substackAuth,
  setAuth: (auth) => useAppStore.getState().setSubstackAuth(auth),
  storeAuth: storeSubstackAuthState,
};

type SubstackSyncResult = AuthenticatedEssaySyncResult;

export function captureSubstackFeed(
  trigger: SocialScrapeTrigger = "unknown",
): Promise<SubstackSyncResult> {
  return captureAuthenticatedEssayProvider(SUBSTACK_CAPTURE_CONFIG, trigger);
}
