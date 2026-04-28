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
 */

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

// Vercel extends IncomingMessage / ServerResponse at runtime.
// Using any avoids installing @vercel/node as a devDependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { code, verifier, redirectUri, grantType, refreshToken, clientId: requestedClientId } = (req.body ?? {}) as {
    code?: string;
    verifier?: string;
    redirectUri?: string;
    grantType?: string;
    refreshToken?: string;
    clientId?: string;
  };

  const credentials = resolveClientCredentials(requestedClientId);
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
      const msg: string = data.error_description ?? data.error ?? "token exchange failed";
      res.status(upstream.status).json({ error: msg });
      return;
    }

    // Client secret never leaves the server. Token metadata is stored by the app.
    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Token exchange failed: ${message}` });
  }
}
