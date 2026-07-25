import { invoke } from "@tauri-apps/api/core";

interface NativeGoogleDriveResponse {
  status: number;
  headers: Array<[string, string]>;
  /**
   * Base64 rather than `number[]`.
   *
   * Tauri serialises a Rust `Vec<u8>` as a JSON array of numbers, so a 38 MB
   * cloud document arrived as 38 million boxed JS numbers, roughly 300 MB of
   * renderer heap, plus the JSON string Tauri built to carry it. WebKit's
   * allocator does not return that promptly, so every cloud sync ratcheted the
   * renderer upward. One base64 string is ~1.33x the byte length and a single
   * allocation.
   */
  bodyB64: string;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const error = new Error("Google Drive request canceled.");
    error.name = "AbortError";
    throw error;
  }
}

function headersToEntries(headers?: HeadersInit): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) return Array.from(headers.entries());
  if (Array.isArray(headers)) return headers.map(([key, value]) => [key, value]);
  return Object.entries(headers).map(([key, value]) => [key, String(value)]);
}

// Chunked so a large document does not blow the argument limit of
// String.fromCharCode.apply, and so no intermediate holds the whole corpus as
// individually boxed values.
const BASE64_CHUNK_BYTES = 32_768;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Backed by an explicit ArrayBuffer so the result is Uint8Array<ArrayBuffer>,
// which is what BodyInit requires. A plain `new Uint8Array(n)` widens to
// ArrayBufferLike and will not satisfy the Response constructor.
export function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  if (encoded.length === 0) return new Uint8Array(new ArrayBuffer(0));
  const binary = atob(encoded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bodyToBase64(body?: BodyInit | null): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return bytesToBase64(new TextEncoder().encode(body));
  if (body instanceof Uint8Array) return bytesToBase64(body);
  if (body instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(body));
  throw new Error("Google Drive native requests only support string and binary bodies.");
}

export async function googleDriveFetchViaTauri(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = String(input);
  throwIfAborted(init.signal);

  const response = await invoke<NativeGoogleDriveResponse>("google_drive_request", {
    url,
    method: init.method ?? "GET",
    headers: headersToEntries(init.headers),
    bodyB64: bodyToBase64(init.body),
  });

  throwIfAborted(init.signal);

  const decoded = base64ToBytes(response.bodyB64 ?? "");
  const body = decoded.length > 0 ? decoded : null;
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}
