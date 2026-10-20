/**
 * Server-side proxy for Google Drive OAuth token exchange.
 *
 * Google's token endpoint requires a client_secret even for PKCE flows when
 * using a "Web application" OAuth client type. This serverless function holds
 * the secret server-side and proxies the exchange, returning only the
 * token metadata to the client.
 *
 * The PKCE code_verifier is still forwarded to Google, preserving PKCE's
 * protection against authorization code interception attacks.
 *
 * NOTE: Do NOT add `export const runtime = "edge"`. Vercel's Edge Runtime
 * (Cloudflare Workers) silently hangs on outbound connections to
 * oauth2.googleapis.com. This runs as a Node.js Lambda which has unrestricted
 * outbound network access.
 *
 * The Vercel Node.js Lambda runtime invokes the function with (req, res) and
 * expects the handler to call res.json() / res.send(), not return a Response.
 *
 * Abuse hardening. Freed Desktop and the Node library service call this
 * endpoint from native or server code and send no Origin header, so a missing
 * Origin stays allowed. A browser request must come from the same origin as
 * this deployment or an exact first-party origin. That blocks cross-site
 * pages from using the server-held secret through a victim's browser. It does
 * not stop direct non-browser callers; per-IP rate limiting belongs in a
 * Vercel Firewall rule.
 */

const MAX_FIELD_LENGTH = 4096;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://app.freed.wtf",
  "https://dev-app.freed.wtf",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);
const OAUTH_ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

function readAdditionalClients(): GoogleClientCredentials[] {
  const raw = process.env.GDRIVE_OAUTH_CLIENTS_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[0].length > 0 &&
        entry[1].length > 0
      )
      .map(([clientId, clientSecret]) => ({ clientId, clientSecret }));
  } catch {
    return [];
  }
}

function resolveClientCredentials(requestedClientId?: string): GoogleClientCredentials | null {
  const clients: GoogleClientCredentials[] = [];
  if (process.env.VITE_GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET) {
    clients.push({
      clientId: process.env.VITE_GDRIVE_CLIENT_ID,
      clientSecret: process.env.GDRIVE_CLIENT_SECRET,
    });
  }
  if (process.env.GDRIVE_DESKTOP_CLIENT_ID && process.env.GDRIVE_DESKTOP_CLIENT_SECRET) {
    clients.push({
      clientId: process.env.GDRIVE_DESKTOP_CLIENT_ID,
      clientSecret: process.env.GDRIVE_DESKTOP_CLIENT_SECRET,
    });
  }
  clients.push(...readAdditionalClients());

  if (clients.length === 0) return null;
  if (!requestedClientId) return clients[0] ?? null;
  return clients.find((client) => client.clientId === requestedClientId) ?? null;
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function allowedOrigins(): Set<string> {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const entry of (process.env.FREED_OAUTH_PROXY_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = entry.trim();
    if (origin) origins.add(origin);
  }
  return origins;
}

/** A missing Origin is allowed. A present Origin must be same-host or listed exactly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRequestOriginAllowed(req: any): boolean {
  const origin = headerValue(req.headers?.origin);
  if (!origin) return true;
  if (allowedOrigins().has(origin)) return true;
  const host = headerValue(req.headers?.["x-forwarded-host"]) || headerValue(req.headers?.host);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && parsed.host === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

function optionalField(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    return null;
  }
  return value;
}

function publicOAuthError(data: unknown): string {
  const code =
    data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  return typeof code === "string" && OAUTH_ERROR_CODE_PATTERN.test(code)
    ? code
    : "token_exchange_failed";
}

// Vercel extends IncomingMessage / ServerResponse at runtime.
// Using any avoids installing @vercel/node as a devDependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!isRequestOriginAllowed(req)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  const rawBody: Record<string, unknown> =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const code = optionalField(rawBody.code);
  const verifier = optionalField(rawBody.verifier);
  const redirectUri = optionalField(rawBody.redirectUri);
  const grantType = optionalField(rawBody.grantType);
  const refreshToken = optionalField(rawBody.refreshToken);
  const requestedClientId = optionalField(rawBody.clientId);
  if (
    [code, verifier, redirectUri, grantType, refreshToken, requestedClientId].includes(null) ||
    (grantType !== undefined && grantType !== "refresh_token" && grantType !== "authorization_code")
  ) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const credentials = resolveClientCredentials(requestedClientId ?? undefined);
  if (!credentials) {
    res.status(requestedClientId ? 400 : 500).json({
      error: requestedClientId
        ? "OAuth client is not configured on server"
        : "OAuth credentials not configured on server",
    });
    return;
  }

  if (grantType === "refresh_token") {
    if (!refreshToken) {
      res.status(400).json({ error: "Invalid refresh request body" });
      return;
    }
  } else if (!code || !verifier || !redirectUri) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: grantType === "refresh_token" ? "refresh_token" : "authorization_code",
  });
  if (grantType === "refresh_token") {
    params.set("refresh_token", refreshToken!);
  } else {
    params.set("code", code!);
    params.set("redirect_uri", redirectUri!);
    params.set("code_verifier", verifier!);
  }

  try {
    const upstream = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(8000),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await upstream.json()) as any;

    if (!upstream.ok) {
      // Return only the OAuth error code. Upstream descriptions can echo
      // request details and are not needed by any Freed client.
      res.status(upstream.status).json({ error: publicOAuthError(data) });
      return;
    }

    // Client secret never leaves the server. Token metadata is stored by the app.
    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
  } catch {
    res.status(500).json({ error: "Token exchange failed" });
  }
}
