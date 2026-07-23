import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FbGroupInfo } from "@freed/shared";

const { mockRecordUpdate } = vi.hoisted(() => ({
  mockRecordUpdate: vi.fn(),
}));

vi.mock("./runtime-health-events", () => ({
  recordFacebookGroupDiscoveryUpdate: mockRecordUpdate,
}));

import {
  FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY,
  getFacebookGroupDiscovery,
  migrateLegacyFacebookGroupDiscovery,
  removeFacebookGroupDiscovery,
  resetFacebookGroupDiscoveryForTests,
  updateFacebookGroupDiscovery,
} from "./facebook-group-discovery";

function group(id: string, name = `Group ${id}`): FbGroupInfo {
  return {
    id,
    name,
    url: `https://www.facebook.com/groups/${id}`,
  };
}

describe("device-local Facebook group discovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetFacebookGroupDiscoveryForTests();
    mockRecordUpdate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("migrates legacy groups once, including an explicit empty migration", () => {
    expect(migrateLegacyFacebookGroupDiscovery({ one: group("one") })).toBe(true);
    expect(getFacebookGroupDiscovery()).toEqual({ one: group("one") });
    expect(migrateLegacyFacebookGroupDiscovery({ two: group("two") })).toBe(false);

    window.localStorage.clear();
    resetFacebookGroupDiscoveryForTests();
    expect(migrateLegacyFacebookGroupDiscovery({})).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY)!)).toEqual({
      version: 1,
      legacyMigrationCompleted: true,
      knownGroups: {},
    });
  });

  it("updates and repairs local discovery without exposing group data in telemetry", () => {
    migrateLegacyFacebookGroupDiscovery({
      one: group("one", "one"),
    });
    mockRecordUpdate.mockClear();

    const result = updateFacebookGroupDiscovery(
      [group("one", "North Idaho Life"), group("two")],
      "group_scrape",
    );

    expect(result).toMatchObject({ changedCount: 2, repairedNameCount: 1, persisted: true });
    expect(getFacebookGroupDiscovery()).toEqual({
      one: group("one", "North Idaho Life"),
      two: group("two"),
    });
    expect(mockRecordUpdate).toHaveBeenCalledWith({
      source: "group_scrape",
      observedCount: 2,
      storedCount: 2,
      changedCount: 2,
      removedCount: 0,
    });
    expect(Object.keys(mockRecordUpdate.mock.calls[0][0]).sort()).toEqual([
      "changedCount",
      "observedCount",
      "removedCount",
      "source",
      "storedCount",
    ]);
  });

  it("supports updates and removal while keeping the store bounded", () => {
    migrateLegacyFacebookGroupDiscovery({
      one: group("one"),
      two: group("two"),
    });

    expect(updateFacebookGroupDiscovery([group("two", "Renamed")], "feed_items").persisted).toBe(true);
    expect(getFacebookGroupDiscovery()).toEqual({
      one: group("one"),
      two: group("two", "Renamed"),
    });
    expect(removeFacebookGroupDiscovery("one")).toEqual({ existed: true, persisted: true });
    expect(removeFacebookGroupDiscovery("two")).toEqual({ existed: true, persisted: true });
    expect(removeFacebookGroupDiscovery("missing")).toEqual({ existed: false, persisted: true });
    expect(getFacebookGroupDiscovery()).toEqual({});
  });

  it("refuses to downgrade a future version", () => {
    const future = JSON.stringify({
      version: 2,
      legacyMigrationCompleted: true,
      knownGroups: { future: group("future") },
    });
    window.localStorage.setItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY, future);
    resetFacebookGroupDiscoveryForTests();

    expect(updateFacebookGroupDiscovery([group("one")], "group_scrape").persisted).toBe(false);
    expect(removeFacebookGroupDiscovery("future")).toEqual({ existed: false, persisted: false });
    expect(migrateLegacyFacebookGroupDiscovery({ one: group("one") })).toBe(false);
    expect(window.localStorage.getItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY)).toBe(future);
  });

  it("keeps automatic observations from replacing corrupt discovery state", () => {
    const corrupt = "not-json";
    window.localStorage.setItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY, corrupt);
    resetFacebookGroupDiscoveryForTests();

    expect(updateFacebookGroupDiscovery([group("one")], "feed_items").persisted).toBe(false);
    expect(updateFacebookGroupDiscovery([group("one")], "membership_check").persisted).toBe(false);
    expect(window.localStorage.getItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY)).toBe(corrupt);
  });

  it("lets an explicit full group refresh repair corrupt discovery state", () => {
    const corrupt = "not-json";
    window.localStorage.setItem(FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY, corrupt);
    resetFacebookGroupDiscoveryForTests();

    expect(updateFacebookGroupDiscovery([group("one")], "group_scrape").persisted).toBe(true);

    const recoveryKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    ).find((key) => key?.startsWith(`${FACEBOOK_GROUP_DISCOVERY_STORAGE_KEY}.recovery.`));
    expect(recoveryKey).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(recoveryKey!)!)).toMatchObject({
      reason: "corrupt",
      raw: corrupt,
    });
  });

  it("fails closed when local storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    resetFacebookGroupDiscoveryForTests();

    expect(updateFacebookGroupDiscovery([group("one")], "group_scrape").persisted).toBe(false);
  });
});
