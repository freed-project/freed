import {
  createAuthenticatedEssayAuth,
  type AuthenticatedEssayAuthState,
} from "./authenticated-essay-auth";

export type SubstackAuthState = AuthenticatedEssayAuthState;

const auth = createAuthenticatedEssayAuth({
  provider: "substack",
  storageKey: "substack_auth_state",
  authEvent: "substack-auth-result",
  showLoginCommand: "substack_show_login",
  checkAuthCommand: "substack_check_auth",
  disconnectCommand: "substack_disconnect",
});

export const showSubstackLogin = auth.showLogin;
export const checkSubstackAuth = auth.checkAuth;
export const disconnectSubstack = auth.disconnect;
export const storeSubstackAuthState = auth.storeAuthState;
export const initSubstackAuth = auth.initAuth;
