/**
 * OAuthCallback handles the OAuth 2.0 PKCE redirect from Google and Dropbox.
 *
 * Rendered instead of the main app when window.location.pathname is
 * "/oauth-callback". Reads the authorization code from URL params,
 * exchanges it for an access token, stores the token, starts cloud sync,
 * and redirects back to the app root.
 *
 * Token exchange:
 *   - Google Drive and YouTube: proxied through /api/oauth/google (server holds client_secret;
 *     Google's "Web application" client type requires it even for PKCE flows).
 *   - Dropbox: direct client-side PKCE exchange (public-client support is
 *     enabled on the Dropbox app via "Allow public clients (PKCE)").
 *
 * Token refresh (access tokens expire ~1hr for GDrive, ~4hr for Dropbox) is
 * deferred. The user will be prompted to reconnect when the token expires.
 */

import { useEffect, useState } from "react";
import { startCloudSync, storeCloudToken, type CloudProvider, type CloudTokenBundle } from "../lib/sync";
import {
  clearStoredGoogleOAuthRedirectUri,
  clearStoredGoogleOAuthScopes,
  clearStoredGoogleOAuthState,
  createGoogleOAuthRelayTarget,
  getOAuthCallbackUri,
  getStoredGoogleOAuthRedirectUri,
  getStoredGoogleOAuthScopes,
  getStoredGoogleOAuthState,
  readGoogleOAuthState,
} from "../lib/oauth-redirect";
import { getGoogleOAuthClientId } from "../lib/cloud-oauth";
import {
  storeYouTubeToken,
  YOUTUBE_OAUTH_SUCCESS_PATH,
  type YouTubeTokenBundle,
} from "../lib/youtube-auth";
import { resetYouTubeIntegrationForNewGrant } from "../lib/youtube-integration";

const DROPBOX_TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";

// GDrive client ID is only needed on the client for initiating the auth flow
// (in SyncConnectDialog). The token exchange uses the server proxy at
// /api/oauth/google, which holds the client_secret.
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI = getOAuthCallbackUri();

type ExchangeResult =
  | { ok: true; token: CloudTokenBundle & Pick<YouTubeTokenBundle, "scope" | "clientId"> }
  | { ok: false; error: string };

type OAuthProvider = CloudProvider | "youtube";

async function exchangeGoogle(
  code: string,
  verifier: string,
  purpose: "gdrive" | "youtube",
  redirectUri: string,
  requestedScopes?: string,
): Promise<ExchangeResult> {
  // Token exchange is proxied server-side: Google requires a client_secret
  // even for PKCE, so we never expose it to the browser.
  const res = await fetch("/api/oauth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      verifier,
      redirectUri,
      clientId: getGoogleOAuthClientId(purpose),
    }),
  });

  const data = await res.json().catch(() => ({ error: "invalid JSON from proxy" }));

  if (!res.ok) {
    const label = purpose === "youtube" ? "YouTube" : "Google Drive";
    return { ok: false, error: `${label} token exchange failed: ${data.error ?? res.status}` };
  }

  const { access_token, refresh_token, expires_in, scope } = data;
  if (!access_token) return { ok: false, error: "Google token proxy returned no access token" };

  return {
    ok: true,
    token: {
      accessToken: access_token as string,
      refreshToken: refresh_token as string | undefined,
      expiresAt: typeof expires_in === "number" ? Date.now() + expires_in * 1000 : undefined,
      scope: typeof scope === "string" ? scope : requestedScopes,
      clientId: getGoogleOAuthClientId(purpose),
    },
  };
}

async function exchangeDropbox(code: string, verifier: string): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: verifier,
    client_id: DROPBOX_CLIENT_ID,
  });

  const res = await fetch(DROPBOX_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Dropbox token exchange failed (${res.status}): ${text}` };
  }

  const { access_token, refresh_token, expires_in } = await res.json();
  if (!access_token) return { ok: false, error: "Dropbox returned no access_token" };

  return {
    ok: true,
    token: {
      accessToken: access_token as string,
      refreshToken: refresh_token as string | undefined,
      expiresAt: typeof expires_in === "number" ? Date.now() + expires_in * 1000 : undefined,
    },
  };
}

type Status = "exchanging" | "success" | "error";

export function OAuthCallback() {
  const [status, setStatus] = useState<Status>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [targetProvider, setTargetProvider] = useState<OAuthProvider | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const relayTarget = createGoogleOAuthRelayTarget(window.location.origin, params);
      if (relayTarget) {
        window.location.replace(relayTarget);
        return;
      }

      const code = params.get("code");
      const oauthError = params.get("error");

      const providerValue = sessionStorage.getItem("freed_pkce_provider");
      const provider: OAuthProvider | null =
        providerValue === "gdrive" || providerValue === "dropbox" || providerValue === "youtube"
          ? providerValue
          : null;
      const verifier = sessionStorage.getItem("freed_pkce_verifier");
      const returnedState = params.get("state");
      const storedGoogleState = getStoredGoogleOAuthState();
      const storedGoogleScopes = getStoredGoogleOAuthScopes();
      const googleState = readGoogleOAuthState(params.get("state"));
      const googleRedirectUri = getStoredGoogleOAuthRedirectUri();
      setTargetProvider(provider);

      // Clean up PKCE state immediately, single-use.
      sessionStorage.removeItem("freed_pkce_provider");
      sessionStorage.removeItem("freed_pkce_verifier");
      clearStoredGoogleOAuthRedirectUri();
      clearStoredGoogleOAuthState();
      clearStoredGoogleOAuthScopes();

      if (oauthError) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(`Authorization denied: ${oauthError}`);
        }
        return;
      }

      if (!code || !provider || !verifier) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            "OAuth callback is missing required parameters. Please try connecting again.",
          );
        }
        return;
      }

      if (
        (provider === "gdrive" || provider === "youtube") &&
        (!returnedState || !storedGoogleState || returnedState !== storedGoogleState)
      ) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Google authorization state could not be verified. Please try connecting again.");
        }
        return;
      }

      if (
        (provider === "gdrive" || provider === "youtube") &&
        googleState?.purpose !== provider
      ) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Google authorization state does not match this connection request.");
        }
        return;
      }

      try {
        const result = provider === "dropbox"
          ? await exchangeDropbox(code, verifier)
          : await exchangeGoogle(
              code,
              verifier,
              provider,
              googleRedirectUri,
              storedGoogleScopes ?? undefined,
            );
        if (!result.ok) {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(result.error);
          }
          return;
        }

        if (provider === "youtube") {
          resetYouTubeIntegrationForNewGrant();
          storeYouTubeToken(result.token);
        } else {
          storeCloudToken(provider, result.token);

          // Token exchange is the success condition. The initial download and
          // merge happen in the background, and the poll loop retries failures.
          startCloudSync(provider, result.token.accessToken).catch((err) => {
            console.error("[OAuthCallback] startCloudSync failed:", err);
          });
        }

        if (cancelled) return;

        setStatus("success");

        // Give the user a moment to see the success state before navigating.
        setTimeout(() => {
          window.location.replace(
            provider === "youtube" ? YOUTUBE_OAUTH_SUCCESS_PATH : "/",
          );
        }, 1200);
      } catch (err: unknown) {
        console.error("[OAuthCallback] token exchange threw:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            err instanceof Error ? err.message : "Unexpected error during token exchange.",
          );
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-theme-shell flex h-screen items-center justify-center">
      <div className="text-center max-w-sm px-6">
        {status === "exchanging" && (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-[var(--theme-accent-secondary)] border-t-transparent" />
            <p className="font-medium text-[var(--theme-text-primary)]">
              {targetProvider === "youtube" ? "Connecting YouTube..." : "Connecting cloud sync..."}
            </p>
            <p className="mt-2 text-sm text-[var(--theme-text-muted)]">Exchanging authorization code</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="theme-icon-well-success mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border-2">
              <svg className="theme-icon-success h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium text-[var(--theme-text-primary)]">
              {targetProvider === "youtube" ? "YouTube connected" : "Cloud sync connected"}
            </p>
            <p className="mt-2 text-sm text-[var(--theme-text-muted)]">
              {targetProvider === "youtube" ? "Returning to YouTube settings..." : "Returning to your feed..."}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="theme-icon-well-danger mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border-2">
              <svg className="theme-icon-danger h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="font-medium text-[var(--theme-text-primary)]">Connection failed</p>
            <p className="mb-5 mt-2 text-sm text-[var(--theme-text-muted)]">{errorMessage}</p>
            <button
              onClick={() => window.location.replace("/")}
              className="btn-primary text-sm px-5 py-2.5"
            >
              Back to app
            </button>
          </>
        )}
      </div>
    </div>
  );
}
