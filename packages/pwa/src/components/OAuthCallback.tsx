/**
 * OAuthCallback — handles the OAuth 2.0 PKCE redirect from GDrive / Dropbox.
 *
 * Rendered instead of the main app when window.location.pathname is
 * "/oauth-callback". Reads the authorization code from URL params,
 * exchanges it for an access token, stores the token, starts cloud sync,
 * and redirects back to the app root.
 *
 * Token exchange:
 *   - GDrive: proxied through /api/oauth/google (server holds client_secret;
 *     Google's "Web application" client type requires it even for PKCE flows).
 *   - Dropbox: direct client-side PKCE exchange (public-client support is
 *     enabled on the Dropbox app via "Allow public clients (PKCE)").
 *
 * Token refresh (access tokens expire ~1hr for GDrive, ~4hr for Dropbox) is
 * deferred — the user will be prompted to reconnect when the token expires.
 */

import { useEffect, useState } from "react";
import { startCloudSync, storeCloudToken, type CloudProvider, type CloudTokenBundle } from "../lib/sync";

const DROPBOX_TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";

// GDrive client ID is only needed on the client for initiating the auth flow
// (in SyncConnectDialog). The token exchange uses the server proxy at
// /api/oauth/google, which holds the client_secret.
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI = `${window.location.origin}/oauth-callback`;

type ExchangeResult =
  | { ok: true; token: CloudTokenBundle }
  | { ok: false; error: string };

async function exchangeGDrive(code: string, verifier: string): Promise<ExchangeResult> {
  // Token exchange is proxied server-side: Google requires a client_secret
  // even for PKCE, so we never expose it to the browser.
  const res = await fetch("/api/oauth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier, redirectUri: OAUTH_REDIRECT_URI }),
  });

  const data = await res.json().catch(() => ({ error: "invalid JSON from proxy" }));

  if (!res.ok) {
    return { ok: false, error: `GDrive token exchange failed: ${data.error ?? res.status}` };
  }

  const { access_token, refresh_token, expires_in } = data;
  if (!access_token) return { ok: false, error: "GDrive proxy returned no access_token" };

  return {
    ok: true,
    token: {
      accessToken: access_token as string,
      refreshToken: refresh_token as string | undefined,
      expiresAt: typeof expires_in === "number" ? Date.now() + expires_in * 1000 : undefined,
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

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const oauthError = params.get("error");

      const provider = sessionStorage.getItem("freed_pkce_provider") as CloudProvider | null;
      const verifier = sessionStorage.getItem("freed_pkce_verifier");

      // Clean up PKCE state immediately, single-use.
      sessionStorage.removeItem("freed_pkce_provider");
      sessionStorage.removeItem("freed_pkce_verifier");

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

      const exchange = provider === "gdrive" ? exchangeGDrive : exchangeDropbox;

      try {
        const result = await exchange(code, verifier);
        if (!result.ok) {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(result.error);
          }
          return;
        }

        storeCloudToken(provider, result.token);

        // Fire-and-forget — token exchange is the success condition.
        // The initial download/merge happens in the background; if it fails
        // the poll loop will retry. Don't block the callback page on it.
        startCloudSync(provider, result.token.accessToken).catch((err) => {
          console.error("[OAuthCallback] startCloudSync failed:", err);
        });

        if (cancelled) return;

        setStatus("success");

        // Give the user a moment to see the success state before navigating.
        setTimeout(() => {
          window.location.replace("/");
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
            <p className="font-medium text-[var(--theme-text-primary)]">Connecting cloud sync...</p>
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
            <p className="font-medium text-[var(--theme-text-primary)]">Cloud sync connected</p>
            <p className="mt-2 text-sm text-[var(--theme-text-muted)]">Returning to your feed...</p>
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
