import { captureMediumFeed } from "../lib/medium-capture";
import {
  checkMediumAuth,
  disconnectMedium,
  showMediumLogin,
  storeMediumAuthState,
} from "../lib/medium-auth";
import {
  getMediumScraperWindowMode,
  setMediumScraperWindowMode,
} from "../lib/scraper-prefs";
import { useAppStore } from "../lib/store";
import { createAuthenticatedEssaySettingsSection } from "./AuthenticatedEssaySettingsSection";

export const MediumSettingsSection = createAuthenticatedEssaySettingsSection({
  provider: "medium",
  authEvent: "medium-auth-result",
  getAuth: () => useAppStore.getState().mediumAuth,
  setAuth: (auth) => useAppStore.getState().setMediumAuth(auth),
  storeAuth: storeMediumAuthState,
  showLogin: showMediumLogin,
  checkAuth: checkMediumAuth,
  disconnect: disconnectMedium,
  capture: captureMediumFeed,
  getWindowMode: getMediumScraperWindowMode,
  setWindowMode: setMediumScraperWindowMode,
});
