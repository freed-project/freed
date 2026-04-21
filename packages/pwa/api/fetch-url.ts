/**
 * Server-side article fetch proxy for PWA saved URLs.
 *
 * The browser cannot reliably fetch arbitrary articles because of CORS, so the
 * PWA posts a URL here and receives the raw HTML body as plain text.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) {
    res.status(400).send("Missing url");
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).send("Invalid URL");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    res.status(400).send("Only http and https URLs are supported");
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream fetch failed with ${upstream.status}`);
      return;
    }

    const contentLength = upstream.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_HTML_BYTES) {
      res.status(413).send("Article too large to save through the PWA");
      return;
    }

    const html = await upstream.text();
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      res.status(413).send("Article too large to save through the PWA");
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(html);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch failure";
    res.status(500).send(`Article fetch failed: ${message}`);
  }
}
