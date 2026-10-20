import {
  assertPwaRuntimeCurrent,
} from "./factory-reset-coordinator";

const OAUTH_CALLBACK_PATH = "/oauth-callback";
const GOOGLE_OAUTH_PROVIDER = "gdrive";
const GOOGLE_OAUTH_STATE_VERSION = 1;
const GOOGLE_OAUTH_RELAY_ORIGIN = "https://app.freed.wtf";

/**
 * Exact origins that may receive a relayed Google authorization code from
 * GOOGLE_OAUTH_RELAY_ORIGIN, and that therefore start Google OAuth with the
 * relay callback. Never add a hostname pattern here: `vercel.app` is a public
 * suffix, so a suffix or regex match can be registered by a third party.
 */
const FIRST_PARTY_GOOGLE_OAUTH_RELAY_ORIGINS: readonly string[] = [
  "https://dev-app.freed.wtf",
];

/**
 * Optional build-time list of additional exact HTTPS origins, comma separated.
 * The relay build (app.freed.wtf) and the relayed build must both include the
 * same entry. Entries that are not a bare canonical HTTPS origin are ignored.
 */
const CONFIGURED_GOOGLE_OAUTH_RELAY_ORIGINS: string =
  import.meta.env.VITE_GOOGLE_OAUTH_RELAY_ORIGINS ?? "";

const GOOGLE_REDIRECT_URI_STORAGE_KEY = "freed_pkce_google_redirect_uri";
const PKCE_GENERATION_STORAGE_KEY = "freed_pkce_installation_generation";
const GOOGLE_OAUTH_NONCE_STORAGE_KEY = "freed_pkce_google_state_nonce";

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

export function storeGoogleOAuthStateNonce(nonce: string): void {
  assertPwaRuntimeCurrent();
  sessionStorage.setItem(GOOGLE_OAUTH_NONCE_STORAGE_KEY, nonce);
}

export function consumeGoogleOAuthStateNonce(): string | null {
  const stored = sessionStorage.getItem(GOOGLE_OAUTH_NONCE_STORAGE_KEY);
  sessionStorage.removeItem(GOOGLE_OAUTH_NONCE_STORAGE_KEY);
  return stored;
}

/**
 * Validate the state Google returned to the final callback origin. The state
 * must name this origin, match the redirect origin this origin would use, and
 * carry the nonce this tab stored when it started the flow. Anything else
 * fails closed.
 */
export function isGoogleOAuthCallbackStateValid(
  currentOrigin: string,
  stateParam: string | null,
  expectedNonce: string | null,
): boolean {
  const state = parseGoogleOAuthState(stateParam);
  return (
    state !== null &&
    typeof expectedNonce === "string" &&
    expectedNonce.length > 0 &&
    state.nonce === expectedNonce &&
    state.returnOrigin === currentOrigin &&
    state.redirectOrigin === getGoogleOAuthRedirectOrigin(currentOrigin)
  );
}

/**
 * Returns a user-facing reason when this origin must not start Google OAuth.
 * A Vercel deployment hostname has no registered Google callback of its own,
 * and it may use the production relay only when its exact origin is listed.
 * Blocking here keeps an unlisted preview from contacting Google at all.
 */
export function getGoogleOAuthStartBlocker(
  origin: string = window.location.origin,
): string | null {
  if (isAllowedGoogleOAuthRelayOrigin(origin)) return null;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return "Google Drive sign-in is unavailable on this origin.";
  }
  if (hostname === "vercel.app" || hostname.endsWith(".vercel.app")) {
    return "Google Drive sign-in is unavailable on this preview deployment.";
  }
  return null;
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

/**
 * On the production relay origin only, forward a Google callback to the exact
 * allowlisted origin named in `state`. `state` is attacker-writable, so the
 * allowlist is the only trust decision here and it must stay exact.
 */
export function createGoogleOAuthRelayTarget(
  currentOrigin: string,
  params: URLSearchParams,
): string | null {
  if (currentOrigin !== GOOGLE_OAUTH_RELAY_ORIGIN) {
    return null;
  }

  const state = parseGoogleOAuthState(params.get("state"));
  if (!state || state.returnOrigin === currentOrigin) {
    return null;
  }

  if (
    state.redirectOrigin !== GOOGLE_OAUTH_RELAY_ORIGIN ||
    !isAllowedGoogleOAuthRelayOrigin(state.returnOrigin)
  ) {
    return null;
  }

  const target = new URL(getOAuthCallbackUri(state.returnOrigin));
  for (const [key, value] of params.entries()) {
    target.searchParams.append(key, value);
  }
  target.searchParams.set("oauth_relay", "1");
  return target.toString();
}

/**
 * Exact-match check for a relay return origin. The input must already be a
 * canonical HTTPS origin (no path, query, fragment, userinfo, explicit default
 * port, or case variation) and must appear verbatim in the allowlist.
 */
export function isAllowedGoogleOAuthRelayOrigin(
  origin: string,
  configured: string = CONFIGURED_GOOGLE_OAUTH_RELAY_ORIGINS,
): boolean {
  if (!isCanonicalHttpsOrigin(origin)) return false;
  if (origin === GOOGLE_OAUTH_RELAY_ORIGIN) return false;
  return getGoogleOAuthRelayOrigins(configured).has(origin);
}

function getGoogleOAuthRelayOrigins(configured: string): Set<string> {
  const origins = new Set(FIRST_PARTY_GOOGLE_OAUTH_RELAY_ORIGINS);
  for (const entry of configured.split(",")) {
    const candidate = entry.trim();
    if (isCanonicalHttpsOrigin(candidate)) origins.add(candidate);
  }
  return origins;
}

function isCanonicalHttpsOrigin(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function getGoogleOAuthRedirectOrigin(origin: string): string {
  return isAllowedGoogleOAuthRelayOrigin(origin) ? GOOGLE_OAUTH_RELAY_ORIGIN : origin;
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
