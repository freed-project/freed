import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Person } from "@freed/shared";
import {
  applyDeviceAccountGraphPositionUpdate,
  applyDevicePersonGraphPositionUpdate,
  applyDeviceGraphLayoutToAccount,
  applyDeviceGraphLayoutToPerson,
  applyDeviceGraphLayout,
  clearDeviceGraphLayout,
  DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
  getDeviceAccountGraphLayout,
  getDeviceGraphLayout,
  getDevicePersonGraphLayout,
  migrateLegacyDeviceGraphLayout,
  pruneDeviceGraphLayout,
  resetDeviceGraphLayoutForTests,
  restoreReplacedDeviceAccountGraphPositions,
  setDeviceAccountGraphPosition,
  setDevicePersonGraphPosition,
  subscribeDeviceGraphLayout,
} from "./device-graph-layout";

function makePerson(id: string, update: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    relationshipStatus: "friend",
    careLevel: 3,
    createdAt: 1,
    updatedAt: 1,
    ...update,
  };
}

function makeAccount(id: string, update: Partial<Account> = {}): Account {
  return {
    id,
    kind: "social",
    provider: "instagram",
    externalId: id,
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
    ...update,
  };
}

describe("device graph layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDeviceGraphLayoutForTests();
  });

  it("routes legacy partial graph updates into local layout", () => {
    expect(setDevicePersonGraphPosition("person-1", 12, 24, 100)).toBe(true);
    expect(applyDevicePersonGraphPositionUpdate("person-1", {
      graphX: 18,
      graphUpdatedAt: 200,
    })).toBe(true);
    expect(getDevicePersonGraphLayout("person-1")).toEqual({
      graphX: 18,
      graphY: 24,
      graphPinned: true,
      graphUpdatedAt: 200,
    });

    expect(setDeviceAccountGraphPosition("account-1", 3, 4, 100)).toBe(true);
    expect(applyDeviceAccountGraphPositionUpdate("account-1", {})).toBe(false);
    expect(applyDeviceAccountGraphPositionUpdate("account-1", {
      graphPinned: false,
    })).toBe(true);
    expect(getDeviceAccountGraphLayout("account-1")).toBeNull();
  });

  it("persists separate versioned person and account records", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDeviceGraphLayout(listener);

    expect(setDevicePersonGraphPosition("person-1", 12.5, -4, 100)).toBe(true);
    expect(setDeviceAccountGraphPosition("account-1", 88, 44, 200)).toBe(true);

    expect(getDevicePersonGraphLayout("person-1")).toEqual({
      graphX: 12.5,
      graphY: -4,
      graphPinned: true,
      graphUpdatedAt: 100,
    });
    expect(getDeviceAccountGraphLayout("account-1")).toEqual({
      graphX: 88,
      graphY: 44,
      graphPinned: true,
      graphUpdatedAt: 200,
    });
    expect(JSON.parse(
      window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY) ?? "null",
    )).toMatchObject({
      version: 1,
      persons: { "person-1": { graphX: 12.5 } },
      accounts: { "account-1": { graphX: 88 } },
    });
    expect(listener).toHaveBeenCalledTimes(2);

    expect(applyDevicePersonGraphPositionUpdate("person-1", { graphPinned: false })).toBe(true);
    expect(applyDevicePersonGraphPositionUpdate("person-1", { graphPinned: false })).toBe(true);
    expect(applyDeviceAccountGraphPositionUpdate("account-1", { graphPinned: false })).toBe(true);
    expect(getDeviceGraphLayout().persons).toEqual({});
    expect(getDeviceGraphLayout().accounts).toEqual({});

    clearDeviceGraphLayout();
    expect(getDeviceGraphLayout()).toMatchObject({
      version: 1,
      legacyMigrationCompleted: true,
      persons: {},
      accounts: {},
    });
    unsubscribe();
  });

  it("prunes missing entities without allowing their old pins to return", () => {
    setDevicePersonGraphPosition("person-removed", 10, 20, 100);
    setDevicePersonGraphPosition("person-live", 30, 40, 200);
    setDeviceAccountGraphPosition("account-removed", 50, 60, 300);
    setDeviceAccountGraphPosition("account-live", 70, 80, 400);

    expect(pruneDeviceGraphLayout(
      { "person-live": makePerson("person-live") },
      { "account-live": makeAccount("account-live") },
    )).toBe(true);
    expect(getDevicePersonGraphLayout("person-removed")).toBeNull();
    expect(getDeviceAccountGraphLayout("account-removed")).toBeNull();
    expect(getDevicePersonGraphLayout("person-live")?.graphX).toBe(30);
    expect(getDeviceAccountGraphLayout("account-live")?.graphX).toBe(70);

    const reintroduced = applyDeviceGraphLayout(
      {
        "person-live": makePerson("person-live"),
        "person-removed": makePerson("person-removed"),
      },
      {
        "account-live": makeAccount("account-live"),
        "account-removed": makeAccount("account-removed"),
      },
    );
    expect(reintroduced.persons["person-removed"]).not.toHaveProperty("graphX");
    expect(reintroduced.accounts["account-removed"]).not.toHaveProperty("graphX");
    expect(pruneDeviceGraphLayout(reintroduced.persons, reintroduced.accounts)).toBe(false);
  });

  it("restores only retained account pins after a successful replacement", () => {
    setDeviceAccountGraphPosition("account-retained", 10, 20, 100);
    setDeviceAccountGraphPosition("account-displaced", 30, 40, 200);
    const beforeReplacement = getDeviceGraphLayout();

    expect(pruneDeviceGraphLayout({}, {})).toBe(true);
    expect(restoreReplacedDeviceAccountGraphPositions(
      ["account-retained"],
      beforeReplacement,
    )).toBe(true);

    expect(getDeviceAccountGraphLayout("account-retained")?.graphX).toBe(10);
    expect(getDeviceAccountGraphLayout("account-displaced")).toBeNull();
  });

  it("rejects non-finite writes and normalizes malformed stored coordinates", () => {
    expect(setDevicePersonGraphPosition(
      "person-invalid",
      Number.POSITIVE_INFINITY,
      10,
    )).toBe(false);
    expect(getDevicePersonGraphLayout("person-invalid")).toBeNull();

    window.localStorage.setItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, JSON.stringify({
      version: 1,
      legacyMigrationCompleted: true,
      persons: {
        valid: {
          graphX: 5,
          graphY: -7,
          graphPinned: true,
          graphUpdatedAt: 9,
          unexpected: "discarded",
        },
        invalid: { graphX: null, graphY: 4, graphPinned: true },
      },
      accounts: {
        invalid: { graphX: 1, graphY: "two", graphPinned: true },
      },
    }));
    resetDeviceGraphLayoutForTests();

    expect(getDeviceGraphLayout()).toEqual({
      version: 1,
      legacyMigrationCompleted: true,
      persons: {
        valid: {
          graphX: 5,
          graphY: -7,
          graphPinned: true,
          graphUpdatedAt: 9,
        },
      },
      accounts: {},
    });
  });

  it("does not overwrite a graph layout written by a newer app version", () => {
    const futureRecord = JSON.stringify({
      version: 2,
      legacyMigrationCompleted: true,
      coordinateSystem: "spherical",
      persons: {
        "person-future": { longitude: 12, latitude: 24 },
      },
    });
    window.localStorage.setItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, futureRecord);

    expect(migrateLegacyDeviceGraphLayout({
      "person-legacy": makePerson("person-legacy", {
        graphX: 1,
        graphY: 2,
        graphPinned: true,
      }),
    }, {})).toBe(false);
    expect(setDevicePersonGraphPosition("person-current-session", 3, 4, 5)).toBe(false);
    expect(window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).toBe(futureRecord);
    expect(getDevicePersonGraphLayout("person-current-session")).toBeNull();
  });

  it("does not treat a corrupt current-version graph record as migration permission", () => {
    const corruptRecord = JSON.stringify({
      version: 1,
      legacyMigrationCompleted: "perhaps",
      persons: [],
      accounts: {},
    });
    window.localStorage.setItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, corruptRecord);

    expect(migrateLegacyDeviceGraphLayout({
      "person-legacy": makePerson("person-legacy", {
        graphX: 1,
        graphY: 2,
        graphPinned: true,
      }),
    }, {})).toBe(false);
    expect(window.localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).toBe(corruptRecord);
  });

  it("migrates legacy Automerge positions once without replaying stale values", () => {
    setDevicePersonGraphPosition("person-local", 100, 200, 500);
    const persons = {
      "person-local": makePerson("person-local", {
        graphX: 1,
        graphY: 2,
        graphPinned: true,
        graphUpdatedAt: 10,
      }),
      "person-legacy": makePerson("person-legacy", {
        graphX: 3,
        graphY: 4,
        graphPinned: true,
        graphUpdatedAt: 20,
      }),
      "person-invalid": makePerson("person-invalid", {
        graphX: Number.NaN,
        graphY: 5,
        graphPinned: true,
      }),
    };
    const accounts = {
      "account-legacy": makeAccount("account-legacy", {
        graphX: 6,
        graphY: 7,
        graphPinned: true,
        graphUpdatedAt: 30,
      }),
    };

    expect(migrateLegacyDeviceGraphLayout(persons, accounts)).toBe(true);
    expect(getDevicePersonGraphLayout("person-local")?.graphX).toBe(100);
    expect(getDevicePersonGraphLayout("person-legacy")?.graphX).toBe(3);
    expect(getDevicePersonGraphLayout("person-invalid")).toBeNull();
    expect(getDeviceAccountGraphLayout("account-legacy")?.graphX).toBe(6);

    setDevicePersonGraphPosition("person-legacy", 90, 91, 900);
    expect(migrateLegacyDeviceGraphLayout({
      "person-legacy": makePerson("person-legacy", {
        graphX: -10,
        graphY: -20,
        graphPinned: true,
      }),
      "person-late": makePerson("person-late", {
        graphX: 8,
        graphY: 9,
        graphPinned: true,
      }),
    }, {})).toBe(false);
    expect(getDevicePersonGraphLayout("person-legacy")?.graphX).toBe(90);
    expect(getDevicePersonGraphLayout("person-late")).toBeNull();
  });

  it("overlays local positions and strips stale synced positions when no local pin exists", () => {
    const person = makePerson("person-1", {
      graphX: 1,
      graphY: 2,
      graphPinned: true,
      graphUpdatedAt: 3,
    });
    const account = makeAccount("account-1", {
      graphX: 4,
      graphY: 5,
      graphPinned: true,
      graphUpdatedAt: 6,
    });
    setDevicePersonGraphPosition(person.id, 10, 20, 30);

    const overlaidPerson = applyDeviceGraphLayoutToPerson(person);
    const overlaidAccount = applyDeviceGraphLayoutToAccount(account);
    expect(overlaidPerson).toMatchObject({
      graphX: 10,
      graphY: 20,
      graphPinned: true,
      graphUpdatedAt: 30,
    });
    expect(overlaidAccount).not.toHaveProperty("graphX");
    expect(overlaidAccount).not.toHaveProperty("graphY");
    expect(overlaidAccount).not.toHaveProperty("graphPinned");
    expect(overlaidAccount).not.toHaveProperty("graphUpdatedAt");
    expect(person.graphX).toBe(1);
    expect(account.graphX).toBe(4);

    const overlaid = applyDeviceGraphLayout(
      { [person.id]: person },
      { [account.id]: account },
    );
    expect(overlaid.persons[person.id]).toEqual(overlaidPerson);
    expect(overlaid.accounts[account.id]).toEqual(overlaidAccount);
  });

  it("keeps the last persisted graph layout when storage fails", () => {
    expect(setDevicePersonGraphPosition("person-stable", 10, 20, 100)).toBe(true);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(setDevicePersonGraphPosition("person-lost", 30, 40, 200)).toBe(false);
    expect(clearDeviceGraphLayout()).toBe(false);
    expect(getDevicePersonGraphLayout("person-stable")?.graphX).toBe(10);
    expect(getDevicePersonGraphLayout("person-lost")).toBeNull();
  });
});
