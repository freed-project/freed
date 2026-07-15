import { lookup as dnsLookup } from "node:dns/promises";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

interface ResolvedAddress {
  address: string;
  family: number;
}

interface ServerlessRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface TextServerlessResponse {
  setHeader(name: string, value: string): void;
  status(code: number): TextServerlessResponse;
  send(body: string): void;
}

type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

function allowedOrigin(origin: string): boolean {
  if (origin === "https://app.freed.wtf") return true;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return true;
  if (process.env.VERCEL_ENV !== "production") {
    try {
      const parsed = new URL(origin);
      return (
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      );
    } catch {
      return false;
    }
  }
  return false;
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().range() === "unicast";
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

async function resolvePublicHost(
  hostname: string,
  resolveHost: ResolveHost,
): Promise<ResolvedAddress[]> {
  const addresses = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
        },
      ]
    : await resolveHost(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error("Destination must resolve only to public network addresses.");
  }
  return addresses;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new Error("Article too large to save through the PWA.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new Error("Article too large to save through the PWA.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function fetchPublicHtml(
  input: URL,
  {
    resolveHost = (hostname) =>
      dnsLookup(hostname, { all: true, verbatim: true }),
    fetchImpl = fetch,
  }: {
    resolveHost?: ResolveHost;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ html: string; status: number }> {
  let current = input;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    if (!["http:", "https:"].includes(current.protocol)) {
      throw new Error("Only http and https URLs are supported.");
    }
    if (current.username || current.password) {
      throw new Error("Credentialed URLs are not supported.");
    }
    const addresses = await resolvePublicHost(current.hostname, resolveHost);
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          const family = typeof options === "number" ? options : options.family;
          const candidates = family
            ? addresses.filter((entry) => entry.family === family)
            : addresses;
          const selected = candidates[0] ?? addresses[0]!;
          if (typeof options !== "number" && options.all) {
            callback(null, candidates.length > 0 ? candidates : addresses);
          } else {
            callback(null, selected.address, selected.family);
          }
        },
      },
    });
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        dispatcher,
      } as RequestInit & { dispatcher: Agent });
    } finally {
      await dispatcher.close();
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Upstream redirect is missing a location.");
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error("Too many article redirects.");
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) return { html: "", status: response.status };
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("The destination did not return an HTML document.");
    }
    return { html: await readBoundedText(response), status: response.status };
  }
  throw new Error("Too many article redirects.");
}

export default async function handler(
  req: ServerlessRequest,
  res: TextServerlessResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const origin = Array.isArray(req.headers?.origin)
    ? req.headers.origin[0] ?? ""
    : req.headers?.origin ?? "";
  if (!allowedOrigin(origin)) {
    res.status(403).send("Origin rejected");
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

  try {
    const result = await fetchPublicHtml(parsed);
    if (result.status < 200 || result.status >= 300) {
      res.status(result.status).send(`Upstream fetch failed with ${result.status}`);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(result.html);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Article fetch failed.";
    const clientError =
      /(?:supported|public network|credentialed|HTML document|redirect|too large)/i.test(
        message,
      );
    res
      .status(clientError ? 400 : 502)
      .send(clientError ? message : "Article fetch failed.");
  }
}
