// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyDeviceGraphLayoutImport,
  DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
  migrateLegacyDeviceGraphLayoutToSqlite,
} from "./device-graph-layout";

function detailResponse(kind: "person" | "account", present: boolean) {
  return kind === "person"
    ? {
        linkedAccountCount: 0,
        linkedAccounts: [],
        person: present
          ? {
              avatarUrl: null,
              bio: null,
              careLevel: 3,
              createdAt: 1,
              id: "person-1",
              name: "Person",
              notes: null,
              reachOutIntervalDays: null,
              relationshipStatus: "friend",
              reachOuts: [],
              sampleBatchId: null,
              sampleGeneratedAt: null,
              sampleGeneratorVersion: null,
              tags: [],
              updatedAt: 1,
            }
          : null,
        queryId: "person_detail_v1",
        schemaVersion: 1,
      }
    : {
        account: present
          ? {
              address: null,
              avatarUrl: null,
              createdAt: 1,
              discoveredFrom: "captured_item",
              displayName: null,
              email: null,
              externalId: "account-1",
              firstSeenAt: 1,
              followRosterActive: null,
              followRosterRoles: [],
              followRosterSyncedAt: null,
              handle: null,
              id: "account-1",
              importedAt: null,
              kind: "social",
              lastSeenAt: 1,
              personId: null,
              phone: null,
              profileUrl: null,
              provider: "instagram",
              sampleBatchId: null,
              sampleGeneratedAt: null,
              sampleGeneratorVersion: null,
              updatedAt: 1,
            }
          : null,
        queryId: "account_detail_v1",
        schemaVersion: 1,
      };
}

describe("retired device graph layout import", () => {
  beforeEach(() => window.localStorage.clear());

  it("imports valid pins through typed SQLite mutations and deletes the shell", async () => {
    window.localStorage.setItem(
      DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        legacyMigrationCompleted: true,
        persons: {
          "person-1": {
            graphPinned: true,
            graphUpdatedAt: 100,
            graphX: 12,
            graphY: 24,
          },
        },
        accounts: {
          "account-1": {
            graphPinned: true,
            graphUpdatedAt: 200,
            graphX: 3,
            graphY: 4,
          },
        },
      }),
    );
    const mutate = vi.fn(async (mutation) => ({
      changed: true,
      layoutRevision: 1,
      mutationId: mutation.mutationId,
      schemaVersion: 1 as const,
    }));
    const query = vi.fn(async (request: { queryId: string }) =>
      detailResponse(
        request.queryId === "person_detail_v1" ? "person" : "account",
        true,
      ),
    );

    await expect(
      migrateLegacyDeviceGraphLayoutToSqlite({ mutate, query: query as never }),
    ).resolves.toBe(2);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it("drops missing entities and preserves the source when SQLite fails", async () => {
    const seed = () =>
      window.localStorage.setItem(
        DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          persons: {
            "person-1": {
              graphPinned: true,
              graphUpdatedAt: 100,
              graphX: 12,
              graphY: 24,
            },
          },
          accounts: {},
        }),
      );
    seed();
    await expect(
      migrateLegacyDeviceGraphLayoutToSqlite({
        mutate: vi.fn(),
        query: vi.fn(async () => detailResponse("person", false)) as never,
      }),
    ).resolves.toBe(0);
    expect(window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).toBeNull();

    seed();
    await expect(
      migrateLegacyDeviceGraphLayoutToSqlite({
        mutate: vi.fn(async () => {
          throw new Error("SQLite unavailable");
        }),
        query: vi.fn(async () => detailResponse("person", true)) as never,
      }),
    ).rejects.toThrow("SQLite unavailable");
    expect(window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).not.toBeNull();
  });

  it("factory reset removes the historical key and its recovery copies", () => {
    window.localStorage.setItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, "legacy");
    window.localStorage.setItem(
      `${DEVICE_GRAPH_LAYOUT_STORAGE_KEY}.recovery.1.0`,
      "legacy-copy",
    );
    expect(clearLegacyDeviceGraphLayoutImport()).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });
});
