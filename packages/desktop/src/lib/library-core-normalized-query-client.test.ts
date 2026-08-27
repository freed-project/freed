import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  normalizeLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowsePageRequestV3,
} from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const {
  mutateNormalizedDeviceContacts,
  queryNormalizedDeviceContacts,
  queryNormalizedLibrary,
} = await import("./library-core-normalized-query-client");

const request = {
  cancellationId: "desktop-query-test",
  cursor: null,
  direction: "next",
  filter: normalizeLibraryCoreFeedBrowseFilterV1({ platform: "rss" }),
  friendsPredicateSchemaVersion:
    LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  identityMode: "all_content",
  limit: 64,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  rankingClockMs: 123_456,
  readerSessionId: "desktop-reader-test",
  recommendationOrderSchemaVersion:
    LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
} as LibraryCoreFeedBrowsePageRequestV3;

const response = {
  filter: request.filter,
  friendsPredicateSchemaVersion:
    LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  identityMode: "all_content",
  nextCursor: null,
  nextOrder: null,
  previousCursor: null,
  previousOrder: null,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  rankingClockMs: request.rankingClockMs,
  recommendationOrderSchemaVersion:
    LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  rows: [],
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  source: {
    generationId: "a".repeat(64),
    projectionRevision: 1,
    transitionSequence: 1,
  },
  totalCount: 0,
};

describe("Freed Desktop normalized query client", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("sends only the validated typed request to the native boundary", async () => {
    mocks.invoke.mockResolvedValue(response);

    await expect(queryNormalizedLibrary(request)).resolves.toEqual(response);
    expect(mocks.invoke).toHaveBeenCalledWith("query_normalized_library", {
      request,
    });
  });

  it("rejects a native response with compatibility payload fields", async () => {
    mocks.invoke.mockResolvedValue({ ...response, shellJson: "{}" });

    await expect(queryNormalizedLibrary(request)).rejects.toThrow(
      "response fields do not match schema version 3",
    );
  });

  it("runs closed device contact mutations through the native core", async () => {
    const mutation = {
      generationId: "contacts:1",
      mutationKind: "device_contact_generation_begin_v1" as const,
      schemaVersion: 1 as const,
      startedAt: 42,
    };
    const receipt = {
      activeGenerationId: null,
      changed: true,
      generationId: mutation.generationId,
      matchedContactCount: 0,
      revision: 1,
      schemaVersion: 1,
      stagedContactCount: 0,
    };
    mocks.invoke.mockResolvedValue(receipt);

    await expect(mutateNormalizedDeviceContacts(mutation)).resolves.toEqual(
      receipt,
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mutate_normalized_device_contacts",
      { mutation },
    );
  });

  it("dispatches bounded device contact queries without a generic SQL lane", async () => {
    const contactRequest = {
      cursor: null,
      limit: 50,
      queryId: "device_contact_unmatched_page_v1" as const,
      schemaVersion: 1 as const,
    };
    const contactResponse = {
      nextCursor: null,
      queryId: contactRequest.queryId,
      revision: 2,
      rows: [],
      schemaVersion: 1,
    };
    mocks.invoke.mockResolvedValue(contactResponse);

    await expect(
      queryNormalizedDeviceContacts(contactRequest),
    ).resolves.toEqual(contactResponse);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "query_normalized_device_contact_unmatched_page",
      { request: contactRequest },
    );
  });

  it("rejects compatibility fields in a device contact response", async () => {
    const statusRequest = {
      queryId: "device_contact_status_v1" as const,
      schemaVersion: 1 as const,
    };
    mocks.invoke.mockResolvedValue({
      activeContactCount: 0,
      activeGenerationId: null,
      authStatus: "reconnect_required",
      createdFriendCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: null,
      pendingSuggestionCount: 0,
      queryId: statusRequest.queryId,
      revision: 0,
      schemaVersion: 1,
      shellJson: "{}",
      syncStartedAt: null,
      syncStatus: "idle",
      syncToken: null,
      updatedAt: 0,
    });

    await expect(queryNormalizedDeviceContacts(statusRequest)).rejects.toThrow(
      "device contact status response is invalid",
    );
  });
});
