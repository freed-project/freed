import { describe, expect, it } from "vitest";
import { createFreedDemoCheckpointRecords } from "./demo-checkpoint";

describe("demo checkpoint", () => {
  it("builds the same curated local showcase every time", () => {
    const first = createFreedDemoCheckpointRecords();
    const second = createFreedDemoCheckpointRecords();

    expect(second).toEqual(first);
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(393);
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(80);
  });

  it("contains no remote display images or private actor credentials", () => {
    const serialized = JSON.stringify(createFreedDemoCheckpointRecords());

    expect(serialized).not.toContain("picsum.photos");
    expect(serialized).not.toMatch(/"(?:authorAvatarUrl|avatarUrl|imageUrl|sourceUrl)":"https?:\/\/[^"]+\.(?:avif|gif|jpe?g|png|webp)/i);
    expect(serialized).not.toMatch(/private[_-]?key/i);
  });
});
