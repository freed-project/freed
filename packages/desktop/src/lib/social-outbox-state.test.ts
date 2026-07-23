import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSocialOutboxAttempt,
  completeSocialOutboxIntent,
  getSocialOutboxRecordForTests,
  getExplicitSocialOutboxIntent,
  markSocialOutboxPlatformConfirmed,
  recordExplicitSocialOutboxIntent,
  resetSocialOutboxStateForTests,
  type SocialOutboxIntent,
} from "./social-outbox-state";

const STORAGE_KEY = "freed-device-social-outbox-v1";

function likeIntent(intentAt: number, globalId = "x:post-1"): SocialOutboxIntent {
  return {
    globalId,
    platform: "x",
    action: "like",
    intentAt,
  };
}

describe("device-local social outbox state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSocialOutboxStateForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists a three-attempt budget across restarts", () => {
    const intent = likeIntent(100);

    expect(beginSocialOutboxAttempt(intent, 1_000)).toMatchObject({ kind: "attempt", attempt: 1 });
    expect(beginSocialOutboxAttempt(intent, 2_000)).toMatchObject({ kind: "attempt", attempt: 2 });

    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(intent, 3_000)).toMatchObject({
      kind: "attempt",
      attempt: 3,
      exhaustedAfterAttempt: true,
    });
    expect(beginSocialOutboxAttempt(intent, 4_000)).toEqual({ kind: "exhausted", attempts: 3 });
    expect(getSocialOutboxRecordForTests(intent)?.attempts).toBe(3);
  });

  it("gives a new exact intent a fresh budget and removes the stale budget", () => {
    const historical = likeIntent(100);
    const current = likeIntent(200);
    beginSocialOutboxAttempt(historical, 1_000);
    beginSocialOutboxAttempt(historical, 2_000);
    beginSocialOutboxAttempt(historical, 3_000);

    expect(beginSocialOutboxAttempt(current, 4_000)).toMatchObject({ kind: "attempt", attempt: 1 });
    expect(getSocialOutboxRecordForTests(historical)).toBeNull();
    expect(getSocialOutboxRecordForTests(current)?.attempts).toBe(1);
  });

  it("persists an explicit local intent that can supersede a replayed legacy sentinel", () => {
    const intent = likeIntent(250);

    expect(recordExplicitSocialOutboxIntent(intent, 1_000)).toBe(true);
    resetSocialOutboxStateForTests();

    expect(getExplicitSocialOutboxIntent(intent.globalId, "like")).toEqual(intent);
    expect(beginSocialOutboxAttempt(intent, 2_000)).toMatchObject({ kind: "attempt", attempt: 1 });
    expect(getSocialOutboxRecordForTests(intent)?.explicitLocalIntent).toBe(true);
  });

  it("keeps each Desktop budget independent", () => {
    const intent = likeIntent(100);
    beginSocialOutboxAttempt(intent, 1_000);
    beginSocialOutboxAttempt(intent, 2_000);
    beginSocialOutboxAttempt(intent, 3_000);
    const firstDesktopState = window.localStorage.getItem(STORAGE_KEY);

    window.localStorage.clear();
    resetSocialOutboxStateForTests();
    expect(beginSocialOutboxAttempt(intent, 4_000)).toMatchObject({ kind: "attempt", attempt: 1 });

    window.localStorage.setItem(STORAGE_KEY, firstDesktopState!);
    resetSocialOutboxStateForTests();
    expect(beginSocialOutboxAttempt(intent, 5_000)).toEqual({ kind: "exhausted", attempts: 3 });
  });

  it("persists a provider confirmation without repeating the provider attempt", () => {
    const intent = likeIntent(100);
    beginSocialOutboxAttempt(intent, 1_000);
    markSocialOutboxPlatformConfirmed(intent, 1_500);

    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(intent, 2_000)).toEqual({
      kind: "confirmed",
      confirmedAt: 1_500,
    });
    completeSocialOutboxIntent(intent);
    expect(getSocialOutboxRecordForTests(intent)).toBeNull();
  });

  it("fails closed on malformed persisted records without replacing them", () => {
    const corrupt = JSON.stringify({
      version: 1,
      entries: {
        bad: {
          globalId: "x:bad",
          platform: "x",
          action: "like",
          intentAt: 100,
          attempts: 99,
          updatedAt: 200,
        },
      },
    });
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(likeIntent(100, "x:bad"), 1_000)).toEqual({
      kind: "capacity",
    });
    expect(recordExplicitSocialOutboxIntent(likeIntent(100, "x:bad"), 1_000)).toBe(false);
    expect(getSocialOutboxRecordForTests(likeIntent(100, "x:bad"))).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(corrupt);
  });

  it.each([
    ["provider confirmation receipt", { platformConfirmedAt: "1,500" }],
    ["explicit local intent marker", { explicitLocalIntent: false }],
  ])("fails closed on a malformed %s without replacing it", (_label, malformedField) => {
    const intent = likeIntent(100);
    const key = JSON.stringify([
      intent.action,
      intent.platform,
      intent.globalId,
      intent.intentAt,
    ]);
    const corrupt = JSON.stringify({
      version: 1,
      entries: {
        [key]: {
          ...intent,
          attempts: 1,
          updatedAt: 200,
          ...malformedField,
        },
      },
    });
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(intent, 1_000)).toEqual({ kind: "capacity" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(corrupt);
  });

  it("refuses to downgrade a future version or run a provider attempt", () => {
    const future = JSON.stringify({ version: 2, entries: { future: true } });
    window.localStorage.setItem(STORAGE_KEY, future);
    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(likeIntent(100), 1_000)).toEqual({ kind: "capacity" });
    expect(recordExplicitSocialOutboxIntent(likeIntent(100), 1_000)).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(future);
  });

  it("does not turn corrupt data into a fresh provider attempt budget", () => {
    const corrupt = "{this is not json";
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(likeIntent(100), 1_000)).toEqual({ kind: "capacity" });
    expect(recordExplicitSocialOutboxIntent(likeIntent(100), 1_000)).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(corrupt);
  });

  it("fails closed when local storage cannot be read", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    resetSocialOutboxStateForTests();

    expect(beginSocialOutboxAttempt(likeIntent(100), 1_000)).toEqual({ kind: "capacity" });
  });
});
