import {
  assertPwaRuntimeCurrent,
} from "./factory-reset-coordinator";

const OAUTH_CALLBACK_PATH = "/oauth-callback";
const GOOGLE_OAUTH_PROVIDER = "gdrive";
const GOOGLE_OAUTH_STATE_VERSION = 1;
const GOOGLE_OAUTH_RELAY_ORIGIN = "https://app.freed.wtf";

const GOOGLE_REDIRECT_URI_STORAGE_KEY = "freed_pkce_google_redirect_uri";
const PKCE_GENERATION_STORAGE_KEY = "freed_pkce_installation_generation";

export interface GoogleOAuthState {
  version: typeof GOOGLE_OAUTH_STATE_VERSION;
  provider: typeof GOOGLE_OAUTH_PROVIDER;
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
  assertPwaRuntimeCurrent();
  sessionStorage.setItem(GOOGLE_REDIRECT_URI_STORAGE_KEY, redirectUri);
}

export function clearStoredGoogleOAuthRedirectUri(): void {
  sessionStorage.removeItem(GOOGLE_REDIRECT_URI_STORAGE_KEY);
}

export function storePwaOAuthRuntimeGeneration(generation: number): void {
  assertPwaRuntimeCurrent();
  sessionStorage.setItem(PKCE_GENERATION_STORAGE_KEY, String(generation));
}

export function consumePwaOAuthRuntimeGeneration(): number | null {
  const stored = sessionStorage.getItem(PKCE_GENERATION_STORAGE_KEY);
  sessionStorage.removeItem(PKCE_GENERATION_STORAGE_KEY);
  if (stored === null) return null;
  const generation = Number(stored);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

export function isPwaOAuthRuntimeGenerationValid(
  oauthGeneration: number | null,
  runtimeGeneration: number,
): boolean {
  return oauthGeneration !== null && oauthGeneration === runtimeGeneration;
}

export function createGoogleOAuthState(
  origin: string = window.location.origin,
  nonce: string = crypto.randomUUID(),
): string {
  assertPwaRuntimeCurrent();
  const state: GoogleOAuthState = {
    version: GOOGLE_OAUTH_STATE_VERSION,
    provider: GOOGLE_OAUTH_PROVIDER,
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
  const state = parseGoogleOAuthState(params.get("state"));
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

function parseGoogleOAuthState(value: string | null): GoogleOAuthState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Partial<GoogleOAuthState>;
    if (
      parsed.version !== GOOGLE_OAUTH_STATE_VERSION ||
      parsed.provider !== GOOGLE_OAUTH_PROVIDER ||
      typeof parsed.returnOrigin !== "string" ||
      typeof parsed.redirectOrigin !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    return parsed as GoogleOAuthState;
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
        url.hostname === "dev-app.freed.wtf" ||
        url.hostname.endsWith("-aubreyfs-projects.vercel.app")
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
        url.hostname === "dev-app.freed.wtf" ||
        url.hostname.endsWith("-aubreyfs-projects.vercel.app")
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
