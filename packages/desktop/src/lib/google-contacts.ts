import { invoke } from "@tauri-apps/api/core";
import {
  fetchGoogleContactsWithPageFetcher,
  type GoogleContactsConnectionsResponse,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";

const GOOGLE_CONTACTS_CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";

function coerceGoogleApiError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Google API error\s+(\d{3})|HTTP\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1] ?? statusMatch[2]) : undefined;
  return Object.assign(new Error(message), status ? { status } : {});
}

export async function fetchGoogleContactsViaTauri(
  accessToken: string,
  syncToken?: string | null,
): Promise<GoogleContactsResult> {
  return fetchGoogleContactsWithPageFetcher(accessToken, syncToken, async (token, params) => {
    const url = `${GOOGLE_CONTACTS_CONNECTIONS_URL}?${params.toString()}`;
    try {
      const raw = await invoke<string>("google_api_request", { url, accessToken: token });
      return JSON.parse(raw) as GoogleContactsConnectionsResponse;
    } catch (error) {
      throw coerceGoogleApiError(error);
    }
  });
}
