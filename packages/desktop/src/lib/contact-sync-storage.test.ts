/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { CONTACT_SYNC_STORAGE_KEY } from "@freed/shared";
import { setContactSyncError, writeContactSyncStateJson } from "./contact-sync-storage";

describe("contact sync storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("does not replace corrupt evidence when reconnect reports an error", () => {
    const raw = "{corrupt-contact-ledger";
    localStorage.setItem(CONTACT_SYNC_STORAGE_KEY, raw);

    const state = setContactSyncError("Reconnect failed.", "auth");

    expect(state).toMatchObject({ syncStatus: "error", lastErrorCode: "unknown" });
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(raw);
  });

  it("restores unreadable snapshot state without normalizing its raw value", () => {
    const raw = JSON.stringify({ version: 99, syncToken: "future-token" });

    const state = writeContactSyncStateJson(raw);

    expect(state).toMatchObject({ syncStatus: "error", lastErrorCode: "unknown" });
    expect(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY)).toBe(raw);
  });
});
