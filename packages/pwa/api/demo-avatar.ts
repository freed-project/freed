import { createHash } from "node:crypto";
import demoAvatarSources from "../src/lib/demo-avatar-sources.json" with { type: "json" };

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
export const DEMO_AVATAR_TIMEOUT_MS = 5_000;

interface ServerlessRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface BinaryServerlessResponse {
  setHeader(name: string, value: string): void;
  status(code: number): BinaryServerlessResponse;
  send(body: Uint8Array): void;
  end(): void;
}

export interface DemoAvatarSource {
  sha1: string;
  imageUrl: string;
}

export type DemoAvatarRegistry = readonly DemoAvatarSource[];

const DEMO_AVATAR_REGISTRY: DemoAvatarRegistry = Object.entries(demoAvatarSources).map(
  ([sha1, imageUrl]) => ({ sha1, imageUrl }),
);

type FetchImplementation = typeof fetch;
type AvatarContentType = "image/jpeg" | "image/png" | "image/webp";

type AvatarFetchResult =
  | { kind: "success"; bytes: Uint8Array; contentType: AvatarContentType }
  | { kind: "upstream-failure" };

/** Pure registry lookup. Query values never choose an upstream URL. */
export function findDemoAvatarSource(
  sha1: string,
  registry: DemoAvatarRegistry = DEMO_AVATAR_REGISTRY,
): DemoAvatarSource | undefined {
  return registry.find((source) => source.sha1 === sha1);
}

function isKnownSha1(value: string | string[] | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

async function readBoundedImage(response: Response, contentType: AvatarContentType): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES) {
    await cancelResponseBody(response);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_AVATAR_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (contentType === "image/webp") {
    // RIFF alone also identifies non-image containers; require WEBP as well.
    if (bytes.length < 12 ||
      [0x52, 0x49, 0x46, 0x46].some((byte, index) => bytes[index] !== byte) ||
      [0x57, 0x45, 0x42, 0x50].some((byte, index) => bytes[index + 8] !== byte)) return null;
    return bytes;
  }
  const signature = contentType === "image/png"
    ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    : [0xff, 0xd8];
  if (bytes.length < signature.length || signature.some((byte, index) => bytes[index] !== byte)) return null;
  return bytes;
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function fetchAvatarSource(
  source: DemoAvatarSource,
  fetchImpl: FetchImplementation,
): Promise<AvatarFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(source.imageUrl, {
      method: "GET",
      headers: { accept: "image/jpeg, image/png, image/webp" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(DEMO_AVATAR_TIMEOUT_MS),
    });
  } catch {
    return { kind: "upstream-failure" };
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    return { kind: "upstream-failure" };
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") {
    await cancelResponseBody(response);
    return { kind: "upstream-failure" };
  }
  const bytes = await readBoundedImage(response, contentType);
  if (!bytes) return { kind: "upstream-failure" };
  const actualSha1 = createHash("sha1").update(bytes).digest("hex");
  if (actualSha1 !== source.sha1) return { kind: "upstream-failure" };
  return { kind: "success", bytes, contentType };
}

function setNoStore(res: BinaryServerlessResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function setSuccessHeaders(res: BinaryServerlessResponse, length: number, contentType: AvatarContentType): void {
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(length));
  res.setHeader("X-Content-Type-Options", "nosniff");
}

/**
 * Factory permits deterministic offline fixtures. Production uses only the
 * closed reviewed registry and never exposes URL selection to a request.
 */
export function createDemoAvatarHandler({
  fetchImpl = fetch,
  registry = DEMO_AVATAR_REGISTRY,
}: {
  fetchImpl?: FetchImplementation;
  registry?: DemoAvatarRegistry;
} = {}) {
  return async function handler(
    req: ServerlessRequest,
    res: BinaryServerlessResponse,
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      setNoStore(res);
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).end();
      return;
    }

    const requestedSha1 = req.query?.sha;
    // Extra query keys can multiply CDN cache entries for the same upstream image.
    if (!isKnownSha1(requestedSha1) || Object.keys(req.query ?? {}).some((key) => key !== "sha")) {
      setNoStore(res);
      res.status(400).end();
      return;
    }

    const source = findDemoAvatarSource(requestedSha1, registry);
    if (!source) {
      setNoStore(res);
      res.status(404).end();
      return;
    }

    const result = await fetchAvatarSource(source, fetchImpl);
    if (result.kind !== "success") {
      setNoStore(res);
      res.status(502).end();
      return;
    }

    setSuccessHeaders(res, result.bytes.byteLength, result.contentType);
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    res.status(200).send(Buffer.from(result.bytes));
  };
}

export default createDemoAvatarHandler();
