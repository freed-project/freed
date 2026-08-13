import { describe, expect, it } from "vitest";

import {
  FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA,
} from "./operation-payload-contracts.js";

describe("Library Core operation payload contracts", () => {
  it("snapshots the exact feed-item read assignment payload", () => {
    const input = { read_at_ms: 1_783_000_000_000 };
    const result = FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate(input);

    expect(result).toStrictEqual({
      ok: true,
      value: { read_at_ms: 1_783_000_000_000 },
    });
    if (!result.ok) throw new Error(result.reason);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value).not.toBe(input);

    input.read_at_ms = 1;
    expect(result.value.read_at_ms).toBe(1_783_000_000_000);
  });

  it("rejects noncanonical shapes and unsafe read timestamps", () => {
    const accessor = Object.defineProperty({}, "read_at_ms", {
      enumerable: true,
      get: () => 1,
    });
    const symbol = { read_at_ms: 1 };
    Object.defineProperty(symbol, Symbol("extra"), { value: true });

    for (const invalid of [
      null,
      [],
      new Date(),
      {},
      { read_at_ms: 1, extra: true },
      { read_at_ms: -0 },
      { read_at_ms: -1 },
      { read_at_ms: 1.5 },
      { read_at_ms: Number.MAX_SAFE_INTEGER + 1 },
      { read_at_ms: "1" },
      accessor,
      symbol,
    ]) {
      expect(
        FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate(invalid),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("requires an explicit idempotent user-state assignment", () => {
    expect(
      FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA.validate({
        assigned: true,
        assigned_at_ms: 1_783_000_000_000,
      }),
    ).toStrictEqual({
      ok: true,
      value: { assigned: true, assigned_at_ms: 1_783_000_000_000 },
    });
    for (const invalid of [
      { toggle: "archived", toggled_at_ms: 1 },
      { assigned: "true", assigned_at_ms: 1 },
      { assigned: true, assigned_at_ms: -1 },
      { assigned: true, assigned_at_ms: 1, extra: true },
    ]) {
      expect(
        FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA.validate(invalid),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("accepts only synchronized RSS feed fields", () => {
    const result = RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate({
      feed: {
        url: "https://example.com/feed.xml",
        title: "Example",
        enabled: true,
        trackUnread: true,
        pollInterval: 3_600,
      },
    });
    expect(result).toMatchObject({ ok: true });

    for (const invalid of [
      { feed: { url: "https://example.com/feed.xml" } },
      {
        feed: {
          url: "https://example.com/feed.xml",
          title: "Example",
          enabled: true,
          trackUnread: true,
          consecutiveFailures: 2,
        },
      },
      {
        feed: {
          url: "https://example.com/feed.xml",
          title: "Example",
          enabled: "true",
          trackUnread: true,
        },
      },
    ]) {
      expect(RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate(invalid)).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
  });

  it("requires an exact RSS removal timestamp", () => {
    expect(
      RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA.validate({
        removed_at_ms: 1_783_000_000_000,
      }),
    ).toStrictEqual({
      ok: true,
      value: { removed_at_ms: 1_783_000_000_000 },
    });
    expect(
      RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA.validate({
        removed_at_ms: 1,
        include_items: true,
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("accepts synchronized preference patches and rejects device-local leaves", () => {
    const accepted = PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate({
        updates: {
          display: { archivePruneDays: 14 },
          ai: { autoSummarize: true },
        },
      });
    expect(accepted, accepted.ok ? undefined : accepted.reason).toMatchObject({ ok: true });
    for (const updates of [
      {},
      { sync: { autoBackup: true } },
      { display: { themeId: "dark-star" } },
      { display: { reading: { dualColumnMode: true } } },
      { ai: { ollamaUrl: "http://localhost:11434" } },
      { fbCapture: { knownGroups: {} } },
      { storyWall: { publishTarget: { lastError: "nope" } } },
    ]) {
      expect(
        PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate({ updates }),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });
});
