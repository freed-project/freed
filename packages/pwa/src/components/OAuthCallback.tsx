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
import { startCloudSync, storeCloudToken, type CloudProvider } from "../lib/sync";

const DROPBOX_TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";

// GDrive client ID is only needed on the client for initiating the auth flow
// (in SyncConnectDialog). The token exchange uses the server proxy at
// /api/oauth/google, which holds the client_secret.
const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI = `${window.location.origin}/oauth-callback`;

type ExchangeResult =
  | { ok: true; accessToken: string }
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

  const { access_token } = data;
  if (!access_token) return { ok: false, error: "GDrive proxy returned no access_token" };

  return { ok: true, accessToken: access_token as string };
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

  const { access_token } = await res.json();
  if (!access_token) return { ok: false, error: "Dropbox returned no access_token" };

  return { ok: true, accessToken: access_token as string };
}

type Status = "exchanging" | "success" | "error";

export function OAuthCallback() {
  const [status, setStatus] = useState<Status>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");

    const provider = sessionStorage.getItem("freed_pkce_provider") as CloudProvider | null;
    const verifier = sessionStorage.getItem("freed_pkce_verifier");

    // Diagnostic logging — retained until OAuth flow is verified stable.
    console.log("[OAuthCallback] effect running", {
      hasCode: !!code,
      hasProvider: !!provider,
      provider,
      hasVerifier: !!verifier,
      hasError: !!oauthError,
      search: window.location.search.slice(0, 80),
    });

    // Clean up PKCE state immediately — single-use.
    sessionStorage.removeItem("freed_pkce_provider");
    sessionStorage.removeItem("freed_pkce_verifier");

    if (oauthError) {
      setStatus("error");
      setErrorMessage(`Authorization denied: ${oauthError}`);
      return;
    }

    if (!code || !provider || !verifier) {
      console.warn("[OAuthCallback] missing required params — aborting", {
        code: code ? "ok" : "MISSING",
        provider: provider ?? "MISSING",
        verifier: verifier ? "ok" : "MISSING",
      });
      setStatus("error");
      setErrorMessage(
        "OAuth callback is missing required parameters. Please try connecting again.",
      );
      return;
    }

    console.log("[OAuthCallback] starting token exchange for", provider);
    const exchange = provider === "gdrive" ? exchangeGDrive : exchangeDropbox;

    exchange(code, verifier)
      .then(async (result) => {
        console.log("[OAuthCallback] exchange resolved", { ok: result.ok });
        if (!result.ok) {
          setStatus("error");
          setErrorMessage(result.error);
          return;
        }

        storeCloudToken(provider, result.accessToken);

        // Fire-and-forget — token exchange is the success condition.
        // The initial download/merge happens in the background; if it fails
        // the poll loop will retry. Don't block the callback page on it.
        startCloudSync(provider, result.accessToken).catch((err) => {
          console.error("[OAuthCallback] startCloudSync failed:", err);
        });

        setStatus("success");

        // Give the user a moment to see the success state before navigating.
        setTimeout(() => {
          window.location.replace("/");
        }, 1200);
      })
      .catch((err: unknown) => {
        console.error("[OAuthCallback] token exchange threw:", err);
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Unexpected error during token exchange.",
        );
      });
  }, []);

  return (
    <div className="h-screen flex items-center justify-center bg-freed-black">
      <div className="text-center max-w-sm px-6">
        {status === "exchanging" && (
          <>
            <div className="w-10 h-10 border-2 border-glow-purple border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <p className="text-white font-medium">Connecting cloud sync...</p>
            <p className="text-[#71717a] text-sm mt-2">Exchanging authorization code</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/20 border-2 border-green-400 flex items-center justify-center mx-auto mb-5">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white font-medium">Cloud sync connected</p>
            <p className="text-[#71717a] text-sm mt-2">Returning to your feed...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center mx-auto mb-5">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-white font-medium">Connection failed</p>
            <p className="text-[#71717a] text-sm mt-2 mb-5">{errorMessage}</p>
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
