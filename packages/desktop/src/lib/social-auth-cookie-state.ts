import { invoke } from "@tauri-apps/api/core";
import type { FbAuthState } from "./fb-auth";
import type { IgAuthState } from "./instagram-auth";
import type { LiAuthState } from "./li-auth";

type SocialProviderId = "facebook" | "instagram" | "linkedin";

export interface SocialProviderCookieState {
  provider: SocialProviderId;
  available: boolean;
  hasAuthCookie: boolean;
  cookieCount: number;
  cookieNames: string[];
  error?: string | null;
}

interface SocialAuthStateHints {
  fbAuth: FbAuthState;
  igAuth: IgAuthState;
  liAuth: LiAuthState;
}

const AUTH_MISSING_MESSAGES: Record<SocialProviderId, string> = {
  facebook: "Facebook is not connected in the local WebView session. Reconnect Facebook and try again.",
  instagram: "Instagram is not connected in the local WebView session. Reconnect Instagram and try again.",
  linkedin: "LinkedIn is not connected in the local WebView session. Reconnect LinkedIn and try again.",
};

export function socialProviderMissingAuthCookieMessage(provider: SocialProviderId): string {
  return AUTH_MISSING_MESSAGES[provider];
}

function withMissingAuthCookieMessage<T extends { isAuthenticated: boolean; lastCaptureError?: string }>(
  provider: SocialProviderId,
  auth: T,
  cookieState: SocialProviderCookieState,
): T {
  if (!auth.isAuthenticated || !cookieState.available || cookieState.hasAuthCookie) {
    return auth;
  }

  return {
    ...auth,
    isAuthenticated: false,
    lastCaptureError: socialProviderMissingAuthCookieMessage(provider),
  };
}

export async function loadSocialProviderCookieState(
  provider: SocialProviderId,
): Promise<SocialProviderCookieState | null> {
  try {
    return await invoke<SocialProviderCookieState>("get_social_provider_cookie_state", { provider });
  } catch {
    return null;
  }
}

export function reconcileSocialAuthStateHint(
  provider: SocialProviderId,
  auth: FbAuthState | IgAuthState | LiAuthState,
  cookieState: SocialProviderCookieState | null,
): FbAuthState | IgAuthState | LiAuthState {
  if (!cookieState) return auth;
  return withMissingAuthCookieMessage(provider, auth, cookieState);
}

export async function reconcileSocialAuthStateHints(
  auth: SocialAuthStateHints,
): Promise<SocialAuthStateHints> {
  const [facebook, instagram, linkedin] = await Promise.all([
    loadSocialProviderCookieState("facebook"),
    loadSocialProviderCookieState("instagram"),
    loadSocialProviderCookieState("linkedin"),
  ]);

  return {
    fbAuth: reconcileSocialAuthStateHint("facebook", auth.fbAuth, facebook) as FbAuthState,
    igAuth: reconcileSocialAuthStateHint("instagram", auth.igAuth, instagram) as IgAuthState,
    liAuth: reconcileSocialAuthStateHint("linkedin", auth.liAuth, linkedin) as LiAuthState,
  };
}
