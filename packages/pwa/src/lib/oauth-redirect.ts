const OAUTH_CALLBACK_PATH = "/oauth-callback";
const GOOGLE_OAUTH_PROVIDER = "google";
const LEGACY_GOOGLE_OAUTH_PROVIDER = "gdrive";
const GOOGLE_OAUTH_STATE_VERSION = 2;
const LEGACY_GOOGLE_OAUTH_STATE_VERSION = 1;
const GOOGLE_OAUTH_RELAY_ORIGIN = "https://app.freed.wtf";

const GOOGLE_REDIRECT_URI_STORAGE_KEY = "freed_pkce_google_redirect_uri";
const GOOGLE_STATE_STORAGE_KEY = "freed_pkce_google_state";
const GOOGLE_SCOPES_STORAGE_KEY = "freed_pkce_google_scopes";

export type GoogleOAuthPurpose = "gdrive" | "youtube";

export interface GoogleOAuthState {
  version: typeof GOOGLE_OAUTH_STATE_VERSION;
  provider: typeof GOOGLE_OAUTH_PROVIDER;
  purpose: GoogleOAuthPurpose;
  returnOrigin: string;
  redirectOrigin: string;
  nonce: string;
  issuedAt: number;
}

export function getOAuthCallbackUri(origin: string = window.location.origin): string {
  return `${origin}${OAUTH_CALLBACK_PATH}`;
}

export function getGoogleOAuthRedirectUri(origin: string = window.location.origin): string {
  return getOAuthCallbackUri(getGoogleOAuthRedirectOrigin(origin));
}

export function getStoredGoogleOAuthRedirectUri(): string {
  return sessionStorage.getItem(GOOGLE_REDIRECT_URI_STORAGE_KEY) ?? getOAuthCallbackUri();
}

export function storeGoogleOAuthRedirectUri(redirectUri: string): void {
  sessionStorage.setItem(GOOGLE_REDIRECT_URI_STORAGE_KEY, redirectUri);
}

export function clearStoredGoogleOAuthRedirectUri(): void {
  sessionStorage.removeItem(GOOGLE_REDIRECT_URI_STORAGE_KEY);
}

export function storeGoogleOAuthState(state: string): void {
  sessionStorage.setItem(GOOGLE_STATE_STORAGE_KEY, state);
}

export function getStoredGoogleOAuthState(): string | null {
  return sessionStorage.getItem(GOOGLE_STATE_STORAGE_KEY);
}

export function clearStoredGoogleOAuthState(): void {
  sessionStorage.removeItem(GOOGLE_STATE_STORAGE_KEY);
}

export function storeGoogleOAuthScopes(scopes: readonly string[]): void {
  sessionStorage.setItem(GOOGLE_SCOPES_STORAGE_KEY, scopes.join(" "));
}

export function getStoredGoogleOAuthScopes(): string | null {
  return sessionStorage.getItem(GOOGLE_SCOPES_STORAGE_KEY);
}

export function clearStoredGoogleOAuthScopes(): void {
  sessionStorage.removeItem(GOOGLE_SCOPES_STORAGE_KEY);
}

export function createGoogleOAuthState(
  origin: string = window.location.origin,
  nonce: string = crypto.randomUUID(),
  purpose: GoogleOAuthPurpose = "gdrive",
): string {
  const state: GoogleOAuthState = {
    version: GOOGLE_OAUTH_STATE_VERSION,
    provider: GOOGLE_OAUTH_PROVIDER,
    purpose,
    returnOrigin: origin,
    redirectOrigin: getGoogleOAuthRedirectOrigin(origin),
    nonce,
    issuedAt: Date.now(),
  };

  return toBase64Url(JSON.stringify(state));
}

export function createGoogleOAuthRelayTarget(
  currentOrigin: string,
  params: URLSearchParams,
): string | null {
  const state = readGoogleOAuthState(params.get("state"));
  if (!state || state.returnOrigin === currentOrigin) {
    return null;
  }

  if (state.redirectOrigin !== currentOrigin || !isAllowedPwaOrigin(state.returnOrigin)) {
    return null;
  }

  const target = new URL(getOAuthCallbackUri(state.returnOrigin));
  for (const [key, value] of params.entries()) {
    target.searchParams.append(key, value);
  }
  target.searchParams.set("oauth_relay", "1");
  return target.toString();
}

function getGoogleOAuthRedirectOrigin(origin: string): string {
  return shouldUseGoogleOAuthRelay(origin) ? GOOGLE_OAUTH_RELAY_ORIGIN : origin;
}

/** Decode and validate Google OAuth state, including legacy Drive callbacks. */
export function readGoogleOAuthState(value: string | null): GoogleOAuthState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Omit<
      Partial<GoogleOAuthState>,
      "version" | "provider"
    > & {
      version?: number;
      provider?: string;
    };
    const isLegacyDriveState =
      parsed.version === LEGACY_GOOGLE_OAUTH_STATE_VERSION &&
      parsed.provider === LEGACY_GOOGLE_OAUTH_PROVIDER;
    const isCurrentState =
      parsed.version === GOOGLE_OAUTH_STATE_VERSION &&
      parsed.provider === GOOGLE_OAUTH_PROVIDER &&
      (parsed.purpose === "gdrive" || parsed.purpose === "youtube");
    if (
      (!isLegacyDriveState && !isCurrentState) ||
      typeof parsed.returnOrigin !== "string" ||
      typeof parsed.redirectOrigin !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    return {
      version: GOOGLE_OAUTH_STATE_VERSION,
      provider: GOOGLE_OAUTH_PROVIDER,
      purpose: isLegacyDriveState ? "gdrive" : parsed.purpose as GoogleOAuthPurpose,
      returnOrigin: parsed.returnOrigin,
      redirectOrigin: parsed.redirectOrigin,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function isAllowedPwaOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (
        url.hostname === "app.freed.wtf" ||
        url.hostname === "dev-app.freed.wtf"
      )
    );
  } catch {
    return false;
  }
}

function shouldUseGoogleOAuthRelay(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (
        url.hostname === "dev-app.freed.wtf"
      )
    );
  } catch {
    return false;
  }
}

function toBase64Url(value: string): string {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}
