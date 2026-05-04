import type { GoogleContact } from "./types.js";

export interface GoogleContactsConnectionsResponse {
  connections?: Array<{
    resourceName: string;
    etag?: string;
    metadata?: { deleted?: boolean };
    names?: Array<{ displayName?: string; givenName?: string; familyName?: string; middleName?: string; metadata?: { primary?: boolean } }>;
    emailAddresses?: Array<{ value: string; type?: string }>;
    phoneNumbers?: Array<{ value: string; type?: string }>;
    photos?: Array<{ url: string; default?: boolean }>;
    organizations?: Array<{ name?: string; title?: string }>;
  }>;
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleContactsResult {
  contacts: GoogleContact[];
  nextSyncToken: string;
  deleted: string[];
}

export type GoogleContactsPageFetcher = (
  accessToken: string,
  params: URLSearchParams,
) => Promise<GoogleContactsConnectionsResponse>;

function parseContact(raw: NonNullable<GoogleContactsConnectionsResponse["connections"]>[number]): GoogleContact {
  const primaryName = raw.names?.find(n => n.metadata?.primary) ?? raw.names?.[0];
  return {
    resourceName: raw.resourceName,
    etag: raw.etag,
    name: {
      displayName: primaryName?.displayName,
      givenName: primaryName?.givenName,
      familyName: primaryName?.familyName,
      middleName: primaryName?.middleName,
    },
    emails: (raw.emailAddresses ?? []).map(e => ({ value: e.value, type: e.type })),
    phones: (raw.phoneNumbers ?? []).map(p => ({ value: p.value, type: p.type })),
    photos: (raw.photos ?? []).map(ph => ({ url: ph.url, default: ph.default })),
    organizations: (raw.organizations ?? []).map(o => ({ name: o.name, title: o.title })),
    metadata: raw.metadata,
  };
}

async function fetchPage(
  accessToken: string,
  params: URLSearchParams
): Promise<GoogleContactsConnectionsResponse> {
  const url = `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const status = res.status;
    throw Object.assign(new Error(`People API error ${status}`), { status });
  }
  return res.json() as Promise<GoogleContactsConnectionsResponse>;
}

export async function fetchGoogleContactsWithPageFetcher(
  accessToken: string,
  syncToken: string | null | undefined,
  pageFetcher: GoogleContactsPageFetcher,
): Promise<GoogleContactsResult> {
  const baseParams = new URLSearchParams({
    personFields: "names,emailAddresses,phoneNumbers,photos,organizations",
    pageSize: "1000",
  });
  if (syncToken) {
    baseParams.set("syncToken", syncToken);
    baseParams.set("requestSyncToken", "true");
  } else {
    baseParams.set("requestSyncToken", "true");
  }

  const allRaw: NonNullable<GoogleContactsConnectionsResponse["connections"]> = [];
  let nextSyncToken = "";
  let pageToken: string | undefined;

  try {
    do {
      const params = new URLSearchParams(baseParams);
      if (pageToken) params.set("pageToken", pageToken);
      const page = await pageFetcher(accessToken, params);
      allRaw.push(...(page.connections ?? []));
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err: unknown) {
    // 410 GONE = expired syncToken, fall back to full sync
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status: number }).status === 410 &&
      syncToken
    ) {
      return fetchGoogleContactsWithPageFetcher(accessToken, null, pageFetcher);
    }
    throw err;
  }

  const contacts: GoogleContact[] = [];
  const deleted: string[] = [];

  for (const raw of allRaw) {
    if (raw.metadata?.deleted) {
      deleted.push(raw.resourceName);
    } else {
      contacts.push(parseContact(raw));
    }
  }

  return { contacts, nextSyncToken, deleted };
}

export async function fetchGoogleContacts(
  accessToken: string,
  syncToken?: string | null
): Promise<GoogleContactsResult> {
  return fetchGoogleContactsWithPageFetcher(accessToken, syncToken, fetchPage);
}

export function mergeContactChanges(
  cached: GoogleContact[],
  changed: GoogleContact[],
  deletedResourceNames: string[]
): GoogleContact[] {
  const deletedSet = new Set(deletedResourceNames);
  const map = new Map<string, GoogleContact>(
    cached.filter(c => !deletedSet.has(c.resourceName)).map(c => [c.resourceName, c])
  );
  for (const c of changed) {
    map.set(c.resourceName, c);
  }
  return Array.from(map.values());
}
