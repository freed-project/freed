import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  enqueueReadAssignments: vi.fn(),
  enqueueFeedItemRemove: vi.fn(),
  enqueueRssFeedRemove: vi.fn(),
  enqueueRssFeedUpsert: vi.fn(),
  enqueuePreferencesLeafAssignment: vi.fn(),
  enqueuePersonUpserts: vi.fn(),
  enqueuePersonRemove: vi.fn(),
  enqueueAccountUpserts: vi.fn(),
  enqueueAccountRemove: vi.fn(),
  enqueueUserStateAssignments: vi.fn(),
  readSelectedCollectionPage: vi.fn(),
  readSelectedMaterializedRow: vi.fn(),
}));

vi.mock("./library-core-portable-checkpoint-store", () => ({
  PWA_LIBRARY_CORE_ACCOUNT_UPSERT_BATCH_LIMIT: 128,
  PWA_LIBRARY_CORE_PERSON_UPSERT_BATCH_LIMIT: 128,
  createPwaLibraryCorePortableCheckpointStore: () => ({
    enqueueReadAssignments: mocks.enqueueReadAssignments,
    enqueueFeedItemRemove: mocks.enqueueFeedItemRemove,
    enqueueRssFeedRemove: mocks.enqueueRssFeedRemove,
    enqueueRssFeedUpsert: mocks.enqueueRssFeedUpsert,
    enqueuePreferencesLeafAssignment: mocks.enqueuePreferencesLeafAssignment,
    enqueuePersonUpserts: mocks.enqueuePersonUpserts,
    enqueuePersonRemove: mocks.enqueuePersonRemove,
    enqueueAccountUpserts: mocks.enqueueAccountUpserts,
    enqueueAccountRemove: mocks.enqueueAccountRemove,
    enqueueUserStateAssignments: mocks.enqueueUserStateAssignments,
    readSelectedCollectionPage: mocks.readSelectedCollectionPage,
    readSelectedMaterializedRow: mocks.readSelectedMaterializedRow,
  }),
}));

vi.mock("./factory-reset-coordinator", () => ({
  registerPwaFactoryResetQuiesceHandler: vi.fn(),
}));

import {
  PWA_LIBRARY_CORE_ENABLED_KEY,
  enqueuePwaLibraryCoreArchiveItems,
  enqueuePwaLibraryCoreArchiveAllReadUnsaved,
  enqueuePwaLibraryCoreDeleteAllArchived,
  isPwaLibraryCoreEnabled,
  enqueuePwaLibraryCoreUserStateToggle,
  enqueuePwaLibraryCoreMarkAllAsRead,
  enqueuePwaLibraryCoreFeedItemRemove,
  enqueuePwaLibraryCoreRssFeedRemove,
  enqueuePwaLibraryCoreRssFeedUpsert,
  enqueuePwaLibraryCorePreferencesPatch,
  enqueuePwaLibraryCorePersonUpserts,
  enqueuePwaLibraryCorePersonRemove,
  enqueuePwaLibraryCoreAccountUpserts,
  enqueuePwaLibraryCoreAccountRemove,
  enqueuePwaLibraryCoreUnarchiveSavedItems,
  readPwaLibraryCoreItemDetail,
  scanPwaLibraryCoreItems,
} from "./library-core-runtime";

function entry(registryKey: string, globalId: string) {
  return {
    value: {
      registry_key: registryKey,
      row: { globalId },
    },
  };
}

describe("PWA Library Core bounded scanner", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.readSelectedCollectionPage.mockReset();
    mocks.readSelectedMaterializedRow.mockReset();
    mocks.enqueueUserStateAssignments.mockReset();
    mocks.enqueueReadAssignments.mockReset();
    mocks.enqueueFeedItemRemove.mockReset();
    mocks.enqueueRssFeedRemove.mockReset();
    mocks.enqueueRssFeedUpsert.mockReset();
    mocks.enqueuePreferencesLeafAssignment.mockReset();
    mocks.enqueuePersonUpserts.mockReset();
    mocks.enqueuePersonRemove.mockReset();
    mocks.enqueueAccountUpserts.mockReset();
    mocks.enqueueAccountRemove.mockReset();
  });

  it("uses IndexedDB Library Core by default with an explicit local rollback", () => {
    expect(isPwaLibraryCoreEnabled()).toBe(true);
    localStorage.setItem(PWA_LIBRARY_CORE_ENABLED_KEY, "0");
    expect(isPwaLibraryCoreEnabled()).toBe(false);
  });

  it("pages the selected IndexedDB generation and stops without reading another page", async () => {
    mocks.readSelectedCollectionPage
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-1")],
        nextOrdinal: 31,
      })
      .mockResolvedValueOnce({
        entries: [entry("00_library_shell", "shell")],
        nextOrdinal: 63,
      })
      .mockResolvedValueOnce({
        entries: [entry("10_feed_items", "item-2")],
        nextOrdinal: 95,
      });
    const visited: string[][] = [];

    await scanPwaLibraryCoreItems((items) => {
      visited.push(items.map((item) => item.globalId));
      return visited.length === 2 ? "stop" : "continue";
    });

    expect(visited).toEqual([["item-1"], ["item-2"]]);
    expect(mocks.readSelectedCollectionPage).toHaveBeenCalledTimes(3);
    expect(mocks.readSelectedCollectionPage.mock.calls).toEqual([
      [{ afterOrdinal: null, collection: "materialized_rows", limit: 32 }],
      [{ afterOrdinal: 31, collection: "materialized_rows", limit: 32 }],
      [{ afterOrdinal: 63, collection: "materialized_rows", limit: 32 }],
    ]);
  });

  it("reads one complete item from IndexedDB without consulting Automerge", async () => {
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });

    await expect(readPwaLibraryCoreItemDetail("item-9")).resolves.toEqual({
      globalId: "item-9",
      preservedContent: { html: "<p>Saved locally</p>" },
    });
    expect(mocks.readSelectedMaterializedRow).toHaveBeenCalledWith(
      "10_feed_items",
      "item-9",
    );
  });

  it("queues user-state changes through the signed IndexedDB intent path", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:assignment",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue({
      globalId: "item-9",
      userState: { liked: false },
    });

    await enqueuePwaLibraryCoreUserStateToggle("item-9", "liked");

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "item-9",
        field: "liked",
      },
    ]);
  });

  it("queues FeedItem removal through the signed IndexedDB intent path", async () => {
    mocks.enqueueFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });

    await enqueuePwaLibraryCoreFeedItemRemove("item-9");

    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledWith({
      entityId: "item-9",
      removedAtMs: expect.any(Number),
    });
  });

  it("repairs saved archived items without waking Automerge", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:unarchive",
    });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "saved-archived",
              userState: { saved: true, archived: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "plain-archived",
              userState: { archived: true },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreUnarchiveSavedItems();

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: false,
        assignedAtMs: expect.any(Number),
        entityId: "saved-archived",
        field: "archived",
      },
    ]);
  });

  it("deletes only archived unsaved items without waking Automerge", async () => {
    mocks.enqueueFeedItemRemove.mockResolvedValue({ operationId: "op:remove" });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "plain-archived",
              userState: { archived: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "saved-archived",
              userState: { saved: true, archived: true },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreDeleteAllArchived();

    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueueFeedItemRemove).toHaveBeenCalledWith({
      entityId: "plain-archived",
      removedAtMs: expect.any(Number),
    });
  });

  it("marks the complete selected platform read in bounded intent batches", async () => {
    mocks.enqueueReadAssignments.mockResolvedValue({ operationId: "op:read" });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-unread",
              platform: "rss",
              userState: {},
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "youtube-unread",
              platform: "youtube",
              userState: {},
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-read",
              platform: "rss",
              userState: { readAt: 1 },
            },
          },
        },
      ],
      nextOrdinal: null,
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

    await enqueuePwaLibraryCoreMarkAllAsRead("rss");

    expect(mocks.enqueueReadAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueReadAssignments).toHaveBeenCalledWith({
      entityIds: ["rss-unread"],
      readAtMs: expect.any(Number),
    });
  });

  it("archives only eligible selected items through explicit assignments", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:archive",
    });
    mocks.readSelectedMaterializedRow
      .mockResolvedValueOnce({
        globalId: "eligible",
        userState: { readAt: 1 },
      })
      .mockResolvedValueOnce({
        globalId: "saved",
        userState: { readAt: 1, saved: true },
      })
      .mockResolvedValueOnce({
        globalId: "unread",
        userState: {},
      });

    await enqueuePwaLibraryCoreArchiveItems([
      "eligible",
      "saved",
      "unread",
      "eligible",
    ]);

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledOnce();
    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "eligible",
        field: "archived",
      },
    ]);
  });

  it("archives the complete selected scope in one bounded assignment batch", async () => {
    mocks.enqueueUserStateAssignments.mockResolvedValue({
      operationId: "op:bulk",
    });
    mocks.readSelectedCollectionPage.mockResolvedValueOnce({
      entries: [
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-eligible",
              platform: "rss",
              rssSource: { feedUrl: "https://example.test/feed" },
              userState: { readAt: 1 },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "rss-saved",
              platform: "rss",
              rssSource: { feedUrl: "https://example.test/feed" },
              userState: { readAt: 1, saved: true },
            },
          },
        },
        {
          value: {
            registry_key: "10_feed_items",
            row: {
              globalId: "other-feed",
              platform: "rss",
              rssSource: { feedUrl: "https://other.test/feed" },
              userState: { readAt: 1 },
            },
          },
        },
      ],
      nextOrdinal: null,
    });

    await enqueuePwaLibraryCoreArchiveAllReadUnsaved(
      "rss",
      "https://example.test/feed",
    );

    expect(mocks.enqueueUserStateAssignments).toHaveBeenCalledWith([
      {
        assigned: true,
        assignedAtMs: expect.any(Number),
        entityId: "rss-eligible",
        field: "archived",
      },
    ]);
  });

  it("routes RSS configuration through signed Library Core intents", async () => {
    mocks.enqueueRssFeedUpsert.mockResolvedValue({ operationId: "op:rss:add" });
    mocks.enqueueRssFeedRemove.mockResolvedValue({
      operationId: "op:rss:remove",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
    const feed = {
      url: "https://example.test/feed.xml",
      title: "Example",
      enabled: true,
      trackUnread: true,
    };

    await enqueuePwaLibraryCoreRssFeedUpsert(feed);
    await enqueuePwaLibraryCoreRssFeedRemove(feed.url, true);

    expect(mocks.enqueueRssFeedUpsert).toHaveBeenCalledWith(feed);
    expect(mocks.enqueueRssFeedRemove).toHaveBeenCalledWith({
      includeItems: true,
      removedAtMs: expect.any(Number),
      url: feed.url,
    });
  });

  it("routes synchronized preferences through a signed Library Core patch", async () => {
    mocks.enqueuePreferencesLeafAssignment.mockResolvedValue({
      operationId: "op:preferences",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
    const update = {
      display: {
        ...createDefaultPreferences().display,
        archivePruneDays: 14,
      },
    };

    await enqueuePwaLibraryCorePreferencesPatch(update);

    expect(mocks.enqueuePreferencesLeafAssignment).toHaveBeenCalledWith(update);
  });

  it("batches synchronized Persons and removes device-local graph state", async () => {
    mocks.enqueuePersonUpserts.mockResolvedValue({
      operationId: "op:persons",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
    const person = {
      id: "person:one",
      name: "One Person",
      relationshipStatus: "friend" as const,
      careLevel: 3 as const,
      graphX: 12,
      graphY: 34,
      createdAt: 1,
      updatedAt: 2,
    };

    await enqueuePwaLibraryCorePersonUpserts([person]);

    expect(mocks.enqueuePersonUpserts).toHaveBeenCalledOnce();
    expect(mocks.enqueuePersonUpserts).toHaveBeenCalledWith([
      {
        id: "person:one",
        name: "One Person",
        relationshipStatus: "friend",
        careLevel: 3,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  it("queues one atomic Person and linked-account removal", async () => {
    mocks.enqueuePersonRemove.mockResolvedValue({
      operationId: "op:person-remove",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);

    await enqueuePwaLibraryCorePersonRemove("person:one");

    expect(mocks.enqueuePersonRemove).toHaveBeenCalledOnce();
    expect(mocks.enqueuePersonRemove).toHaveBeenCalledWith(
      "person:one",
      expect.any(Number),
    );
  });

  it("batches synchronized Accounts, strips graph state, and queues removal", async () => {
    mocks.enqueueAccountUpserts.mockResolvedValue({
      operationId: "op:accounts",
    });
    mocks.enqueueAccountRemove.mockResolvedValue({
      operationId: "op:account-remove",
    });
    mocks.readSelectedMaterializedRow.mockResolvedValue(null);
    const account = {
      id: "account:one",
      personId: "person:one",
      kind: "social" as const,
      provider: "instagram" as const,
      externalId: "one",
      discoveredFrom: "manual_entry" as const,
      firstSeenAt: 1,
      lastSeenAt: 2,
      graphX: 12,
      graphY: 34,
      createdAt: 1,
      updatedAt: 2,
    };

    await enqueuePwaLibraryCoreAccountUpserts([account]);
    await enqueuePwaLibraryCoreAccountRemove(account.id);

    expect(mocks.enqueueAccountUpserts).toHaveBeenCalledWith([
      {
        id: "account:one",
        personId: "person:one",
        kind: "social",
        provider: "instagram",
        externalId: "one",
        discoveredFrom: "manual_entry",
        firstSeenAt: 1,
        lastSeenAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    expect(mocks.enqueueAccountRemove).toHaveBeenCalledWith(
      "account:one",
      expect.any(Number),
    );
  });
});
