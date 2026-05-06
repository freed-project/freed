import { invoke } from "@tauri-apps/api/core";
import {
  fetchGoogleContactsWithPageFetcher,
  type GoogleContactsConnectionsResponse,
  type GoogleContactsResult,
} from "@freed/shared/google-contacts";

const GOOGLE_CONTACTS_CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";
const NETWORK_FAILURE_MESSAGES = new Set([
  "Load failed",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
]);

function coerceGoogleApiError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Google API error\s+(\d{3})|HTTP\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1] ?? statusMatch[2]) : undefined;
  if (!status && NETWORK_FAILURE_MESSAGES.has(message)) {
    return Object.assign(
      new Error("Google Contacts request failed before Google returned a response. Check your network connection and try again."),
      { rawMessage: message },
    );
  }
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
