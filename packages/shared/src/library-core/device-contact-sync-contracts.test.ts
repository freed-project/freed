import { describe, expect, it } from "vitest";
import {
  LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS,
  digestLibraryCoreDeviceContactSyncMutationV1,
  parseLibraryCoreDeviceContactMutationReceiptV1,
  parseLibraryCoreDeviceContactSyncMutationV1,
} from "./device-contact-sync-contracts.js";

function contact(resourceName = "people/1") {
  return {
    emails: [{ type: "home", value: "person@example.com" }],
    name: { displayName: "Example Person" },
    organizations: [],
    phones: [],
    photos: [],
    resourceName,
  };
}

describe("device contact sync contracts", () => {
  it("accepts a closed bounded contact delta", () => {
    const parsed = parseLibraryCoreDeviceContactSyncMutationV1({
      batchOrdinal: 0,
      contacts: [contact()],
      deletedResourceNames: ["people/deleted"],
      generationId: "contacts:1",
      mutationKind: "device_contact_delta_append_v1",
      schemaVersion: 1,
      updatedAt: 10,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        batchOrdinal: 0,
        generationId: "contacts:1",
      });
    }
  });

  it("shares one canonical mutation digest with the native core", () => {
    expect(
      digestLibraryCoreDeviceContactSyncMutationV1({
        batchOrdinal: 0,
        contacts: [],
        deletedResourceNames: ["people/deleted"],
        generationId: "contacts-1",
        mutationKind: "device_contact_delta_append_v1",
        schemaVersion: 1,
        updatedAt: 110,
      }),
    ).toBe(
      "966cf9a2505a7ddcae8260bacab9aaa4aaa109a609f668a9359d962c4be6fccd",
    );
  });

  it("accepts the largest legal child windows and rejects one oversized field", () => {
    const maximumContact = {
      emails: Array.from({ length: 16 }, (_, index) => ({
        type: `email-${index.toLocaleString("en-US")}`,
        value: "e".repeat(2_048),
      })),
      etag: "e".repeat(2_048),
      name: {
        displayName: "d".repeat(2_048),
        familyName: "f".repeat(2_048),
        givenName: "g".repeat(2_048),
        middleName: "m".repeat(2_048),
      },
      organizations: Array.from({ length: 4 }, () => ({
        name: "n".repeat(1_024),
        title: "t".repeat(1_024),
      })),
      phones: Array.from({ length: 16 }, () => ({ value: "p".repeat(2_048) })),
      photos: Array.from({ length: 4 }, () => ({ url: "u".repeat(8_192) })),
      resourceName: "r".repeat(1_024),
    };
    const mutation = {
      batchOrdinal: 0,
      contacts: [maximumContact],
      deletedResourceNames: [],
      generationId: "contacts:maximum",
      mutationKind: "device_contact_delta_append_v1",
      schemaVersion: 1,
      updatedAt: 10,
    };
    expect(parseLibraryCoreDeviceContactSyncMutationV1(mutation).ok).toBe(true);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        ...mutation,
        contacts: [
          {
            ...maximumContact,
            emails: [{ value: "e".repeat(2_049) }],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        authStatus: "connected",
        errorCode: null,
        errorMessage: null,
        mutationKind: "device_contact_status_set_v1",
        schemaVersion: 1,
        syncStartedAt: -1,
        syncStatus: "idle",
        updatedAt: 10,
      }).ok,
    ).toBe(false);
  });

  it("rejects duplicate identities, oversized batches, aliases, and accessors", () => {
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        batchOrdinal: 0,
        contacts: [contact("people/1")],
        deletedResourceNames: ["people/1"],
        generationId: "contacts:1",
        mutationKind: "device_contact_delta_append_v1",
        schemaVersion: 1,
        updatedAt: 10,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        batchOrdinal: 0,
        contacts: Array.from(
          { length: LIBRARY_CORE_DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS + 1 },
          (_, index) => contact(`people/${index.toLocaleString("en-US")}`),
        ),
        deletedResourceNames: [],
        generationId: "contacts:1",
        mutationKind: "device_contact_delta_append_v1",
        schemaVersion: 1,
        updatedAt: 10,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        batchOrdinal: 0,
        contacts: [contact()],
        deletedResourceNames: [],
        generationId: "contacts:1",
        mutationKind: "device_contact_delta_append_v1",
        schemaVersion: 1,
        sql: "DELETE FROM library_device_contacts",
        updatedAt: 10,
      }).ok,
    ).toBe(false);
    const accessor = {
      get generationId() {
        throw new Error("must not run");
      },
      mutationKind: "device_contact_generation_begin_v1",
      schemaVersion: 1,
      startedAt: 10,
    };
    expect(parseLibraryCoreDeviceContactSyncMutationV1(accessor).ok).toBe(
      false,
    );
  });

  it("accepts explicit unmatched receipts and closed suggestions", () => {
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        generationId: "contacts:1",
        matchedAt: 20,
        matches: [{ resourceName: "people/1", suggestion: null }],
        mutationKind: "device_contact_match_append_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        generationId: "contacts:1",
        matchedAt: 20,
        matches: [
          {
            resourceName: "people/1",
            suggestion: {
              accountIds: ["account:1"],
              confidence: "high",
              createdAt: 20,
              id: "suggestion:1",
              kind: "attach_accounts_to_person",
              label: "Example Person",
              personId: "person:1",
              reason: "Exact match",
            },
          },
        ],
        mutationKind: "device_contact_match_append_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
  });

  it("requires coherent status transitions and closed receipts", () => {
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        authStatus: "connected",
        errorCode: null,
        errorMessage: null,
        mutationKind: "device_contact_status_set_v1",
        schemaVersion: 1,
        syncStartedAt: 10,
        syncStatus: "syncing",
        updatedAt: 10,
      }).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreDeviceContactSyncMutationV1({
        authStatus: "connected",
        errorCode: null,
        errorMessage: null,
        mutationKind: "device_contact_status_set_v1",
        schemaVersion: 1,
        syncStartedAt: null,
        syncStatus: "syncing",
        updatedAt: 10,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceContactMutationReceiptV1({
        activeGenerationId: "contacts:1",
        changed: true,
        generationId: "contacts:2",
        matchedContactCount: 2,
        revision: 3,
        schemaVersion: 1,
        stagedContactCount: 2,
      }).ok,
    ).toBe(true);
  });
});
