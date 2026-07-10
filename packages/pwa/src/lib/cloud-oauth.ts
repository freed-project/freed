import {
  createGoogleOAuthState,
  type GoogleOAuthPurpose,
  getGoogleOAuthRedirectUri,
  storeGoogleOAuthScopes,
  storeGoogleOAuthState,
  storeGoogleOAuthRedirectUri,
} from "./oauth-redirect";

const GDRIVE_CLIENT_ID = import.meta.env.VITE_GDRIVE_CLIENT_ID ?? "";
const YOUTUBE_CLIENT_ID = import.meta.env.VITE_YOUTUBE_CLIENT_ID ?? GDRIVE_CLIENT_ID;

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function getGoogleOAuthClientId(purpose: GoogleOAuthPurpose): string {
  return purpose === "youtube" ? YOUTUBE_CLIENT_ID : GDRIVE_CLIENT_ID;
}

export async function initiateGoogleOAuth(
  purpose: GoogleOAuthPurpose,
  scopes: readonly string[],
): Promise<void> {
  const clientId = getGoogleOAuthClientId(purpose);
  if (!clientId) {
    throw new Error("Google OAuth is not configured for this installation.");
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = getGoogleOAuthRedirectUri();
  sessionStorage.setItem("freed_pkce_verifier", verifier);
  sessionStorage.setItem("freed_pkce_provider", purpose);
  storeGoogleOAuthRedirectUri(redirectUri);
  const state = createGoogleOAuthState(window.location.origin, crypto.randomUUID(), purpose);
  storeGoogleOAuthState(state);
  storeGoogleOAuthScopes(scopes);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function initiateGDriveOAuth(): Promise<void> {
  return initiateGoogleOAuth("gdrive", [
    "https://www.googleapis.com/auth/drive.appdata",
    "https://www.googleapis.com/auth/contacts.readonly",
  ]);
}
