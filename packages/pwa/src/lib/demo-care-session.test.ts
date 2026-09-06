import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryCoreNormalizedCheckpointRecordV2 } from "@freed/shared/library-core";

const fixture = vi.hoisted(() => ({
  demo: true,
  failActivation: false,
  staged: [] as LibraryCoreNormalizedCheckpointRecordV2[],
  active: [] as LibraryCoreNormalizedCheckpointRecordV2[],
}));
vi.mock("./demo-mode", () => ({ isFreedDemoMode: () => fixture.demo }));
vi.mock("./library-core-sqlite-runtime", () => ({
  beginPwaNormalizedCheckpointStage: vi.fn(async () => { fixture.staged = []; }),
  appendPwaNormalizedCheckpointStagePage: vi.fn(async ({ records }) => {
    fixture.staged.push(...records);
  }),
  activatePwaNormalizedCheckpointStage: vi.fn(async () => {
    if (fixture.failActivation) throw new Error("activation failed");
    fixture.active = fixture.staged;
  }),
  queryPwaNormalizedLibrary: vi.fn(async () => ({ summary: {
    totalCount: fixture.active.filter(entry => entry.registryKey === "10_feed_item").length,
  } })),
}));

beforeEach(() => {
  vi.resetModules();
  fixture.demo = true;
  fixture.failActivation = false;
  fixture.staged = [];
  fixture.active = [];
});

describe("demo care session", () => {
  it("serializes care edits, preserves the timeline and other edits, and resets on document reload", async () => {
    const session = await import("./demo-checkpoint");
    await session.installFreedDemoCheckpoint();
    const initial = fixture.active;
    const people = initial.filter(entry => entry.registryKey === "30_person");
    const first = people[0]!;
    const second = people[1]!;
    expect(people.length).toBeGreaterThan(1);
    await Promise.all([
      session.setFreedDemoPersonCare(String(first.primaryKey), 1),
      session.setFreedDemoPersonCare(String(second.primaryKey), 5),
    ]);
    expect(fixture.active.find(entry => entry.registryKey === "30_person" && entry.primaryKey === first.primaryKey)?.payload)
      .toMatchObject({ careLevel: 1, relationshipStatus: "connection" });
    expect(fixture.active.find(entry => entry.registryKey === "30_person" && entry.primaryKey === second.primaryKey)?.payload)
      .toMatchObject({ careLevel: 5, relationshipStatus: "friend" });
    expect(fixture.active.filter(entry => entry.registryKey !== "30_person"))
      .toEqual(initial.filter(entry => entry.registryKey !== "30_person"));
    vi.resetModules();
    const reloaded = await import("./demo-checkpoint");
    await reloaded.installFreedDemoCheckpoint();
    const ratings = (entries: typeof people) => entries.map(entry =>
      [entry.primaryKey, entry.payload.careLevel, entry.payload.relationshipStatus]);
    expect(ratings(fixture.active.filter(entry => entry.registryKey === "30_person")))
      .toEqual(ratings(people));
  });

  it("rejects non-demo and unknown identities and does not retain failed edits", async () => {
    const session = await import("./demo-checkpoint");
    await session.installFreedDemoCheckpoint();
    const people = fixture.active.filter(entry => entry.registryKey === "30_person");
    const first = people[0]!;
    const second = people[1]!;
    fixture.demo = false;
    await expect(session.setFreedDemoPersonCare(String(first.primaryKey), 5)).rejects.toThrow("outside the demo");
    fixture.demo = true;
    await expect(session.setFreedDemoPersonCare("unknown", 3)).rejects.toThrow("not part of this demo");
    fixture.failActivation = true;
    await expect(session.setFreedDemoPersonCare(String(first.primaryKey), 1)).rejects.toThrow("activation failed");
    fixture.failActivation = false;
    await expect(session.setFreedDemoPersonCare(String(second.primaryKey), 3)).rejects.toThrow("Reload the demo");
    expect(fixture.active.find(entry => entry.registryKey === "30_person" && entry.primaryKey === first.primaryKey))
      .toEqual(first);
  });
});
