import { invoke } from "@tauri-apps/api/core";

interface NativeGoogleDriveResponse {
  status: number;
  headers: Array<[string, string]>;
  body: number[];
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

function bodyToBytes(body?: BodyInit | null): number[] | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return Array.from(new TextEncoder().encode(body));
  if (body instanceof Uint8Array) return Array.from(body);
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
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
    body: bodyToBytes(init.body),
  });

  throwIfAborted(init.signal);

  const body = response.body.length > 0 ? new Uint8Array(response.body) : null;
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}
