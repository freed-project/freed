/**
 * Handle the OAuth 2.0 PKCE redirect from Google Drive.
 *
 * Rendered instead of the main app when window.location.pathname is
 * "/oauth-callback". Reads the authorization code from URL params,
 * exchanges it for an access token, stores the token, starts cloud sync,
 * and redirects back to the app root.
 *
 * Token exchange:
 * Google Drive is proxied through /api/oauth/google. The server holds the
 * client secret required by Google's Web application client type.
 *
 * Google refresh credentials are stored with the access-token expiry. The PWA
 * refreshes before expiry and once more after an unexpected authenticated 401.
 */

import { useEffect, useState } from "react";
import {
  captureCloudLifecycle,
  startCloudSync,
  storeCloudToken,
  type CloudTokenBundle,
} from "../lib/sync";
import {
  clearStoredGoogleOAuthRedirectUri,
  consumePwaOAuthRuntimeGeneration,
  createGoogleOAuthRelayTarget,
  getStoredGoogleOAuthRedirectUri,
  isPwaOAuthRuntimeGenerationValid,
} from "../lib/oauth-redirect";
import { capturePwaRuntimeLifecycle } from "../lib/factory-reset-coordinator";

type ExchangeResult =
  { ok: true; token: CloudTokenBundle } | { ok: false; error: string };

async function exchangeGDrive(
  code: string,
  verifier: string,
): Promise<ExchangeResult> {
  const redirectUri = getStoredGoogleOAuthRedirectUri();
  // Token exchange is proxied server-side: Google requires a client_secret
  // even for PKCE, so we never expose it to the browser.
  const res = await fetch("/api/oauth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier, redirectUri }),
  });

  const data = await res
    .json()
    .catch(() => ({ error: "invalid JSON from proxy" }));

  if (!res.ok) {
    return {
      ok: false,
      error: `GDrive token exchange failed: ${data.error ?? res.status}`,
    };
  }

  const { access_token, refresh_token, expires_in } = data;
  if (!access_token)
    return { ok: false, error: "GDrive proxy returned no access_token" };

  return {
    ok: true,
    token: {
      accessToken: access_token as string,
      refreshToken: refresh_token as string | undefined,
      expiresAt:
        typeof expires_in === "number"
          ? Date.now() + expires_in * 1000
          : undefined,
    },
  };
}

type Status = "exchanging" | "success" | "error";

export function OAuthCallback() {
  const [status, setStatus] = useState<Status>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let returnTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      const runtimeLifecycle = capturePwaRuntimeLifecycle();
      if (!runtimeLifecycle.isCurrent()) return;
      const params = new URLSearchParams(window.location.search);
      const relayTarget = createGoogleOAuthRelayTarget(
        window.location.origin,
        params,
      );
      if (relayTarget) {
        window.location.replace(relayTarget);
        return;
      }

      const code = params.get("code");
      const oauthError = params.get("error");

      const provider = sessionStorage.getItem("freed_pkce_provider");
      const verifier = sessionStorage.getItem("freed_pkce_verifier");
      const oauthGeneration = consumePwaOAuthRuntimeGeneration();

      // Clean up PKCE state immediately, single-use.
      sessionStorage.removeItem("freed_pkce_provider");
      sessionStorage.removeItem("freed_pkce_verifier");
      clearStoredGoogleOAuthRedirectUri();

      if (oauthError) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(`Authorization denied: ${oauthError}`);
        }
        return;
      }

      if (
        !code ||
        provider !== "gdrive" ||
        !verifier ||
        !isPwaOAuthRuntimeGenerationValid(
          oauthGeneration,
          runtimeLifecycle.generation,
        ) ||
        !runtimeLifecycle.isCurrent()
      ) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            "OAuth callback is missing required parameters. Please try connecting again.",
          );
        }
        return;
      }

      const lifecycle = captureCloudLifecycle();
      try {
        const result = await exchangeGDrive(code, verifier);
        if (!result.ok) {
          if (
            !cancelled &&
            runtimeLifecycle.isCurrent() &&
            lifecycle.isCurrent()
          ) {
            setStatus("error");
            setErrorMessage(result.error);
          }
          return;
        }

        if (
          cancelled ||
          !runtimeLifecycle.isCurrent() ||
          !lifecycle.isCurrent()
        )
          return;
        storeCloudToken(provider, result.token);

        // Fire-and-forget — token exchange is the success condition.
        // The initial download/merge happens in the background; if it fails
        // the poll loop will retry. Don't block the callback page on it.
        startCloudSync(provider, result.token.accessToken).catch((err) => {
          console.error("[OAuthCallback] startCloudSync failed:", err);
        });
        const redirectLifecycle = captureCloudLifecycle();

        if (cancelled) return;

        setStatus("success");

        // Give the user a moment to see the success state before navigating.
        returnTimer = setTimeout(() => {
          if (
            cancelled ||
            !runtimeLifecycle.isCurrent() ||
            !redirectLifecycle.isCurrent()
          )
            return;
          window.location.replace("/");
        }, 1200);
      } catch (err: unknown) {
        console.error("[OAuthCallback] token exchange threw:", err);
        if (
          !cancelled &&
          runtimeLifecycle.isCurrent() &&
          lifecycle.isCurrent()
        ) {
          setStatus("error");
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Unexpected error during token exchange.",
          );
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (returnTimer !== null) clearTimeout(returnTimer);
    };
  }, []);

  return (
    <div className="app-theme-shell flex h-screen items-center justify-center">
      <div className="text-center max-w-sm px-6">
        {status === "exchanging" && (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-[var(--theme-accent-secondary)] border-t-transparent" />
            <p className="font-medium text-[var(--theme-text-primary)]">
              Connecting cloud sync...
            </p>
            <p className="mt-2 text-sm text-[var(--theme-text-muted)]">
              Exchanging authorization code
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="theme-icon-well-success mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border-2">
              <svg
                className="theme-icon-success h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="font-medium text-[var(--theme-text-primary)]">
              Cloud sync connected
            </p>
            <p className="mt-2 text-sm text-[var(--theme-text-muted)]">
              Returning to your feed...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="theme-icon-well-danger mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border-2">
              <svg
                className="theme-icon-danger h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <p className="font-medium text-[var(--theme-text-primary)]">
              Connection failed
            </p>
            <p className="mb-5 mt-2 text-sm text-[var(--theme-text-muted)]">
              {errorMessage}
            </p>
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
