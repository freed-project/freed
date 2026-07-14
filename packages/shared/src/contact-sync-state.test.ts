import { describe, expect, it } from "vitest";
import {
  CONTACT_SYNC_STATE_VERSION,
  createEmptyContactSyncState,
  parseContactSyncState,
  serializeContactSyncState,
} from "./contact-sync-state";

describe("contact sync state", () => {
  it("preserves corrupt JSON and requires manual repair", () => {
    const raw = "{not-json";

    const parsed = parseContactSyncState(raw);

    expect(parsed).toMatchObject({
      status: "corrupt",
      raw,
      state: {
        syncStatus: "error",
        lastErrorCode: "unknown",
      },
    });
    expect(parsed.state.lastErrorMessage).toContain("Sync Now");
  });

  it("rejects structurally malformed state without discarding the raw value", () => {
    const raw = JSON.stringify({
      version: CONTACT_SYNC_STATE_VERSION,
      syncToken: "token",
      cachedContacts: "not-an-array",
    });

    const parsed = parseContactSyncState(raw);

    expect(parsed).toMatchObject({ status: "corrupt", raw });
    expect(parsed.state.cachedContacts).toEqual([]);
  });

  it("preserves unsupported versions for explicit repair", () => {
    const raw = JSON.stringify({
      version: CONTACT_SYNC_STATE_VERSION + 1,
      syncToken: "future-token",
    });

    const parsed = parseContactSyncState(raw);

    expect(parsed).toMatchObject({
      status: "unsupported",
      raw,
      version: CONTACT_SYNC_STATE_VERSION + 1,
      state: { syncStatus: "error" },
    });
    expect(parsed.state.lastErrorMessage).toContain("newer version");
  });

  it("normalizes valid unversioned legacy state", () => {
    const raw = JSON.stringify({
      syncToken: "legacy-token",
      lastSyncedAt: 1_700_000_000_000,
      cachedContacts: [{
        resourceName: "people/1",
        name: { displayName: "Legacy Contact" },
        emails: [{ value: "legacy@example.com", type: "home" }],
        phones: [],
        photos: [],
        organizations: [],
      }],
      pendingMatches: [{ id: "legacy-match" }],
      dismissedMatches: [{
        contactResourceName: "people/1",
        friendIdOrAuthorId: "friend-1",
      }],
      autoCreatedCount: 2,
    });

    const parsed = parseContactSyncState(raw);

    expect(parsed).toMatchObject({
      status: "valid",
      format: "legacy",
      raw,
      state: {
        authStatus: "reconnect_required",
        syncStatus: "idle",
        syncToken: "legacy-token",
        lastSyncedAt: 1_700_000_000_000,
        createdFriendCount: 2,
      },
    });
    expect(parsed.state.cachedContacts).toHaveLength(1);
    expect(parsed.state.pendingSuggestions).toEqual([]);
    expect(parsed.state.dismissedSuggestionIds).toEqual([]);
  });

  it("round trips the current versioned format", () => {
    const raw = serializeContactSyncState({
      ...createEmptyContactSyncState(),
      authStatus: "connected",
      syncToken: "current-token",
    });

    const parsed = parseContactSyncState(raw);

    expect(parsed).toMatchObject({
      status: "valid",
      format: "current",
      state: {
        authStatus: "connected",
        syncToken: "current-token",
      },
    });
  });
});
