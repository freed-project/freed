/**
 * Server-side proxy for Google Drive OAuth token exchange.
 *
 * Google's token endpoint requires a client_secret even for PKCE flows when
 * using a "Web application" OAuth client type. This serverless function holds
 * the secret server-side and proxies the exchange, returning only the
 * access_token to the client.
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
 * expects the handler to call res.json() / res.send() — not return a Response.
 */

// Vercel extends IncomingMessage / ServerResponse at runtime.
// Using any avoids installing @vercel/node as a devDependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const clientId = process.env.VITE_GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "OAuth credentials not configured on server" });
    return;
  }

  const { code, verifier, redirectUri } = (req.body ?? {}) as {
    code?: string;
    verifier?: string;
    redirectUri?: string;
  };

  if (!code || !verifier || !redirectUri) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    grant_type: "authorization_code",
  });

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

    // Return only the access_token — client_secret and refresh_token never leave the server.
    res.status(200).json({ access_token: data.access_token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Token exchange failed: ${message}` });
  }
}
