import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import { updatePreferences } from "./schema.js";
import {
  AI_PREFERENCES_WRITE_POLICY,
  DISPLAY_PREFERENCES_WRITE_POLICY,
  FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY,
  FRIEND_SUGGESTION_PREFERENCES_WRITE_POLICY,
  READING_ENHANCEMENTS_WRITE_POLICY,
  STORY_WALL_PREFERENCES_WRITE_POLICY,
  STORY_WALL_PUBLISH_TARGET_WRITE_POLICY,
  STORY_WALL_STYLE_WRITE_POLICY,
  ULYSSES_PREFERENCES_WRITE_POLICY,
  USER_PREFERENCES_WRITE_POLICY,
  WEIGHT_PREFERENCES_WRITE_POLICY,
  X_CAPTURE_PREFERENCES_WRITE_POLICY,
} from "./sync-write-policy.js";

/**
 * The device-local boundary for preferences, proved through the real write
 * path rather than through the sanitizer in isolation.
 *
 * `updatePreferences` is the only way preferences enter the synchronized
 * document. It strips by policy, then hands what survives to `deepMergeInto`
 * and, for `fbCapture`, to a dedicated writer. A leaf marked `device-local`
 * that slipped through would propagate one machine's private setting to every
 * other device: `ai.ollamaUrl` is a LAN address, `ai.provider` and `ai.model`
 * describe local software, and the display leaves are one screen's layout.
 *
 * `locality-contract.test.ts` covers the feed item policy. Nothing covered
 * this one, so the boundary held by construction alone.
 *
 * The cases are generated from the policy objects rather than listed by hand,
 * so a leaf added tomorrow is covered without anyone remembering to add it.
 */

/** Sub-policies reachable through `USER_PREFERENCES_WRITE_POLICY`'s nested entries. */
const NESTED_PREFERENCE_POLICIES = {
  weights: WEIGHT_PREFERENCES_WRITE_POLICY,
  ulysses: ULYSSES_PREFERENCES_WRITE_POLICY,
  display: DISPLAY_PREFERENCES_WRITE_POLICY,
  xCapture: X_CAPTURE_PREFERENCES_WRITE_POLICY,
  fbCapture: FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY,
  friendSuggestions: FRIEND_SUGGESTION_PREFERENCES_WRITE_POLICY,
  ai: AI_PREFERENCES_WRITE_POLICY,
  storyWall: STORY_WALL_PREFERENCES_WRITE_POLICY,
} as const;

type Disposition = string;

const dispositionOf = (entry: unknown): Disposition =>
  typeof entry === "string"
    ? entry
    : String((entry as { disposition?: unknown })?.disposition);

/** Writes `updates` through the only path preferences reach the document by. */
const writtenPreferences = (updates: unknown): Record<string, unknown> => {
  const doc = A.change(A.from({ preferences: {} } as never), (draft: never) => {
    updatePreferences(draft as never, updates as never);
  });
  return (doc as never as { preferences: Record<string, unknown> }).preferences;
};

/**
 * Two probe shapes. The sanitizer does not type check except for
 * `positive-sync`, which requires a positive finite number, and the `fbCapture`
 * writer expects records. Trying both keeps the positive control honest
 * without weakening the negative one, which must hold for either shape.
 */
const PROBES = [1, { probeKey: true }] as const;

/**
 * Sub-objects one level deeper that carry their own policy.
 *
 * The first version of this file stopped at two levels and would have missed
 * `display.reading.dualColumnMode`, `storyWall.publishTarget.lastError`, and
 * `storyWall.publishTarget.status`, all device-local. The other `nested`
 * entries are records and arrays whose values are sanitized as collections
 * rather than against a named policy, so they have no leaves to enumerate.
 */
const DEEP_PREFERENCE_POLICIES = {
  "display.reading": READING_ENHANCEMENTS_WRITE_POLICY,
  "storyWall.style": STORY_WALL_STYLE_WRITE_POLICY,
  "storyWall.publishTarget": STORY_WALL_PUBLISH_TARGET_WRITE_POLICY,
} as const;

/** Builds `{a: {b: {c: probe}}}` from a dotted path. */
const nest = (path: readonly string[], probe: unknown): unknown =>
  path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), probe);

const leafAfterWrite = (
  group: string,
  leaf: string,
  probe: unknown,
): unknown => {
  const path = [...group.split("."), leaf];
  let cursor: unknown = writtenPreferences(nest(path, probe));
  for (const key of path) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
};

describe("preference locality boundary", () => {
  const cases = Object.entries({
    ...NESTED_PREFERENCE_POLICIES,
    ...DEEP_PREFERENCE_POLICIES,
  }).flatMap(([group, policy]) =>
    Object.entries(policy as Record<string, unknown>).map(([leaf, entry]) => ({
      group,
      leaf,
      disposition: dispositionOf(entry),
    })),
  );

  const local = cases.filter(
    (entry) =>
      entry.disposition === "device-local" ||
      entry.disposition === "compatibility-only",
  );
  const synced = cases.filter(
    (entry) =>
      entry.disposition === "sync" || entry.disposition === "positive-sync",
  );

  const collections = cases.filter((entry) => entry.disposition === "nested");

  it("generates cases from the policy and accounts for every leaf", () => {
    // Guard the guard. If the policies stopped being enumerable, or every leaf
    // landed in one bucket, the two suites below would pass vacuously.
    expect(cases.length).toBeGreaterThan(30);
    expect(local.length).toBeGreaterThan(10);
    expect(synced.length).toBeGreaterThan(5);

    // Every leaf is in exactly one bucket. `nested` here means a record or
    // array sanitized as a collection, with no named policy to enumerate, so
    // it is counted rather than silently dropped from the total.
    expect(local.length + synced.length + collections.length).toBe(cases.length);

    // The leaves whose leaking would be most visible to a user, including the
    // three that only a third level of traversal reaches.
    expect(local).toEqual(
      expect.arrayContaining([
        { group: "ai", leaf: "ollamaUrl", disposition: "device-local" },
        { group: "display", leaf: "themeId", disposition: "device-local" },
        { group: "fbCapture", leaf: "knownGroups", disposition: "device-local" },
        {
          group: "display.reading",
          leaf: "dualColumnMode",
          disposition: "device-local",
        },
        {
          group: "storyWall.publishTarget",
          leaf: "status",
          disposition: "device-local",
        },
        {
          group: "storyWall.publishTarget",
          leaf: "lastError",
          disposition: "device-local",
        },
      ]),
    );
  });

  it.each(local)(
    "$group.$leaf is $disposition and never reaches the document",
    ({ group, leaf }) => {
      for (const probe of PROBES) {
        expect(leafAfterWrite(group, leaf, probe)).toBeUndefined();
      }
    },
  );

  it.each(synced)(
    "$group.$leaf is $disposition and does reach the document",
    ({ group, leaf }) => {
      // The positive control. Without it, a sanitizer that dropped everything
      // would satisfy every assertion above.
      const landed = PROBES.some(
        (probe) => leafAfterWrite(group, leaf, probe) !== undefined,
      );
      expect(landed).toBe(true);
    },
  );

  it("drops the whole sync subtree, which is compatibility-only", () => {
    expect(dispositionOf(USER_PREFERENCES_WRITE_POLICY.sync)).toBe(
      "compatibility-only",
    );
    expect(
      writtenPreferences({
        sync: { cloudProvider: "gdrive", autoBackup: true, backupFrequency: "daily" },
      }),
    ).toStrictEqual({});
  });

  it("leaves the fbCapture knownGroups branch unreachable", () => {
    // `applyFbCapturePreferenceUpdate` has a dedicated `if (updates.knownGroups)`
    // branch, but `updatePreferences` strips device-local leaves before calling
    // it and is that function's only caller. The branch cannot run from here.
    // Asserted so the dead branch is not mistaken for a synchronized path.
    const written = writtenPreferences({
      fbCapture: {
        knownGroups: { group1: "Group One" },
        excludedGroupIds: { group2: true },
      },
    });
    expect(written).toStrictEqual({
      fbCapture: { excludedGroupIds: { group2: true } },
    });
  });
});
