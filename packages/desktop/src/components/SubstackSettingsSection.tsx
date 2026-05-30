import { captureSubstackFeed } from "../lib/substack-capture";
import {
  checkSubstackAuth,
  disconnectSubstack,
  showSubstackLogin,
  storeSubstackAuthState,
} from "../lib/substack-auth";
import {
  getSubstackScraperWindowMode,
  setSubstackScraperWindowMode,
} from "../lib/scraper-prefs";
import { useAppStore } from "../lib/store";
import { createAuthenticatedEssaySettingsSection } from "./AuthenticatedEssaySettingsSection";

export const SubstackSettingsSection = createAuthenticatedEssaySettingsSection({
  provider: "substack",
  authEvent: "substack-auth-result",
  getAuth: () => useAppStore.getState().substackAuth,
  setAuth: (auth) => useAppStore.getState().setSubstackAuth(auth),
  storeAuth: storeSubstackAuthState,
  showLogin: showSubstackLogin,
  checkAuth: checkSubstackAuth,
  disconnect: disconnectSubstack,
  capture: captureSubstackFeed,
  getWindowMode: getSubstackScraperWindowMode,
  setWindowMode: setSubstackScraperWindowMode,
});
