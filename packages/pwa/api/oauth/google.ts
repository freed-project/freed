/**
 * Server-side proxy for Google Drive OAuth token exchange.
 *
 * Google's token endpoint requires a client_secret even for PKCE flows when
 * using a "Web application" OAuth client type. This edge function holds the
 * secret server-side and proxies the exchange, returning only the access_token
 * to the client.
 *
 * The PKCE code_verifier is still forwarded to Google, preserving PKCE's
 * protection against authorization code interception attacks.
 */

export const runtime = "edge";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const clientId = process.env.VITE_GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return json({ error: "OAuth credentials not configured on server" }, 500);
  }

  let code: string, verifier: string, redirectUri: string;
  try {
    const body = await req.json();
    code = body.code;
    verifier = body.verifier;
    redirectUri = body.redirectUri;
    if (!code || !verifier || !redirectUri) throw new Error("missing fields");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    grant_type: "authorization_code",
  });

  const upstream = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    const msg = data.error_description ?? data.error ?? "token exchange failed";
    return json({ error: msg }, upstream.status);
  }

  // Return only the access_token. The client_secret and refresh_token never
  // leave the server. Refresh token handling is deferred to a future phase.
  return json({ access_token: data.access_token });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
