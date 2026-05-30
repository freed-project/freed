import { invoke } from "@tauri-apps/api/core";
import {
  fetchGoogleContactsWithPageFetcher,
  type GoogleContactsConnectionsResponse,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";

const GOOGLE_CONTACTS_CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";

interface NativeGoogleApiResponse {
  status: number;
  headers: Array<[string, string]>;
  body: number[];
}

function decodeBody(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body));
}

function googleErrorMessage(prefix: string, status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `${prefix} (${status})`;
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      } | string;
    };
    if (typeof parsed.error === "string") return `${prefix} (${status}): ${parsed.error}`;
    const message = parsed.error?.message;
    const reason = parsed.error?.errors?.find((entry) => entry.reason)?.reason;
    if (message && reason) return `${prefix} (${status}): ${message} (${reason})`;
    if (message) return `${prefix} (${status}): ${message}`;
  } catch {
    // Use the raw body below.
  }
  return `${prefix} (${status}): ${trimmed.slice(0, 500)}`;
}

function coerceGoogleApiError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Google Contacts API failed\s+\((\d{3})\)|Google API error\s+(\d{3})|HTTP\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1] ?? statusMatch[2] ?? statusMatch[3]) : undefined;
  return Object.assign(new Error(message), status ? { status } : {});
}

export async function fetchGoogleContactsViaTauri(
  accessToken: string,
  syncToken?: string | null,
): Promise<GoogleContactsResult> {
  return fetchGoogleContactsWithPageFetcher(accessToken, syncToken, async (token, params) => {
    const url = `${GOOGLE_CONTACTS_CONNECTIONS_URL}?${params.toString()}`;
    try {
      const response = await invoke<NativeGoogleApiResponse>("google_api_request", { url, accessToken: token });
      const raw = decodeBody(response.body);
      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(
          new Error(googleErrorMessage("Google Contacts API failed", response.status, raw)),
          { status: response.status },
        );
      }
      return JSON.parse(raw) as GoogleContactsConnectionsResponse;
    } catch (error) {
      throw coerceGoogleApiError(error);
    }
  });
}
