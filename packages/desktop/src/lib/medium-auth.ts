import {
  createAuthenticatedEssayAuth,
  type AuthenticatedEssayAuthState,
} from "./authenticated-essay-auth";

export type MediumAuthState = AuthenticatedEssayAuthState;

const auth = createAuthenticatedEssayAuth({
  provider: "medium",
  storageKey: "medium_auth_state",
  authEvent: "medium-auth-result",
  showLoginCommand: "medium_show_login",
  checkAuthCommand: "medium_check_auth",
  disconnectCommand: "medium_disconnect",
});

export const showMediumLogin = auth.showLogin;
export const checkMediumAuth = auth.checkAuth;
export const disconnectMedium = auth.disconnect;
export const storeMediumAuthState = auth.storeAuthState;
export const initMediumAuth = auth.initAuth;
