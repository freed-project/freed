import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchGoogleContacts,
  mergeContactChanges,
  fetchGoogleContactsWithPageFetcher,
} from "@freed/shared/google-contacts";
import { createContactAccountFromGoogleContact } from "@freed/shared/google-contacts-automation";

describe("google contacts helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchGoogleContacts paginates and separates deleted contacts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connections: [
              {
                resourceName: "people/1",
                names: [
                  {
                    displayName: "Jane Doe",
                    givenName: "Jane",
                    familyName: "Doe",
                  },
                ],
                emailAddresses: [{ value: "jane@example.com" }],
              },
            ],
            nextPageToken: "page-2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connections: [
              {
                resourceName: "people/2",
                metadata: { deleted: true },
              },
            ],
            nextSyncToken: "sync-2",
          }),
        ),
      );

    const result = await fetchGoogleContacts("token-123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.nextSyncToken).toBe("sync-2");
    expect(result.deleted).toEqual(["people/2"]);
    expect(result.contacts[0].name.displayName).toBe("Jane Doe");
  });

  it.each([410, 400])("fetchGoogleContacts retries with a full sync after expired token status %s", async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Sync token is expired. Clear local cache and retry call without the sync token." } }), { status }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connections: [
              {
                resourceName: "people/3",
                names: [{ displayName: "Retry Person" }],
              },
            ],
            nextSyncToken: "fresh-sync",
          }),
        ),
      );

    const result = await fetchGoogleContacts("token-123", "expired-sync-token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.contacts).toHaveLength(1);
    expect(result.nextSyncToken).toBe("fresh-sync");
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("syncToken")).toBe(false);
  });

  it("discards incremental pages and their cursor before full recovery", async () => {
    const pageFetcher = vi.fn()
      .mockResolvedValueOnce({ connections: [{ resourceName: "people/stale" }, { resourceName: "people/deleted", metadata: { deleted: true } }], nextPageToken: "incremental-page" })
      .mockRejectedValueOnce(Object.assign(new Error("Google Contacts API failed (400): Sync token is expired. Clear local cache and retry call without the sync token."), { status: 400 }))
      .mockResolvedValueOnce({ connections: [{ resourceName: "people/fresh" }], nextPageToken: "fresh-page" })
      .mockResolvedValueOnce({ connections: [], nextSyncToken: "replacement" });
    const result = await fetchGoogleContactsWithPageFetcher("token", "expired", pageFetcher);
    expect(result.contacts.map(contact => contact.resourceName)).toEqual(["people/fresh"]);
    expect(result.deleted).toEqual([]);
    expect(result.nextSyncToken).toBe("replacement");
    expect(pageFetcher).toHaveBeenCalledTimes(4);
    expect(pageFetcher.mock.calls[2][1].has("syncToken")).toBe(false);
    expect(pageFetcher.mock.calls[2][1].has("pageToken")).toBe(false);
    expect(pageFetcher.mock.calls[3][1].get("pageToken")).toBe("fresh-page");
  });

  it.each([400, 410])("does not repeat failed full recovery after status %s", async status => {
    const failure = Object.assign(new Error("Sync token is expired. Clear local cache and retry call without the sync token."), { status });
    const pageFetcher = vi.fn().mockRejectedValue(failure);
    await expect(fetchGoogleContactsWithPageFetcher("token", "expired", pageFetcher)).rejects.toBe(failure);
    expect(pageFetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves unrelated HTTP 400 errors without retry", async () => {
    const pageFetcher = vi.fn().mockRejectedValue(Object.assign(new Error("Invalid personFields"), { status: 400 }));
    await expect(fetchGoogleContactsWithPageFetcher("token", "retained", pageFetcher)).rejects.toThrow("Invalid personFields");
    expect(pageFetcher).toHaveBeenCalledTimes(1);
  });

  it("mergeContactChanges replaces updated contacts and removes deleted ones", () => {
    const merged = mergeContactChanges(
      [
        {
          resourceName: "people/1",
          name: { displayName: "Old Name" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
        {
          resourceName: "people/2",
          name: { displayName: "Delete Me" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
      ],
      [
        {
          resourceName: "people/1",
          name: { displayName: "New Name" },
          emails: [],
          phones: [],
          photos: [],
          organizations: [],
        },
      ],
      ["people/2"],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        resourceName: "people/1",
        name: expect.objectContaining({ displayName: "New Name" }),
      }),
    ]);
  });

  it("creates the normalized Google contact Account consumed by the Library", () => {
    expect(
      createContactAccountFromGoogleContact(
        {
          resourceName: "people/10",
          name: { displayName: "Jane Doe" },
          emails: [{ value: "jane@example.com" }],
          phones: [{ value: "+1 555 0100" }],
          photos: [],
          organizations: [],
        },
        123,
        "person-10",
      ),
    ).toEqual({
      id: "contact:google:people/10",
      personId: "person-10",
      kind: "contact",
      provider: "google_contacts",
      externalId: "people/10",
      displayName: "Jane Doe",
      email: "jane@example.com",
      phone: "+1 555 0100",
      importedAt: 123,
      firstSeenAt: 123,
      lastSeenAt: 123,
      discoveredFrom: "contact_import",
      createdAt: 123,
      updatedAt: 123,
    });
  });
});
