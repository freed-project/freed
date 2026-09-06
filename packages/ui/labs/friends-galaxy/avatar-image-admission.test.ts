import { describe, expect, it } from "vitest";
import {
  FriendsGalaxyAvatarImageAdmission,
  type FriendsGalaxyAvatarImageRequest,
} from "../../src/lib/friends-galaxy-avatar-image-admission.js";

interface FakeImage {
  sourceKey: string;
  close: () => void;
}

function request(nodeId: string, sourceKey = nodeId): FriendsGalaxyAvatarImageRequest {
  return { nodeId, sourceKey };
}

function asCanvasSource(image: FakeImage): CanvasImageSource {
  return image as unknown as CanvasImageSource;
}

describe("Friends Galaxy avatar image admission", () => {
  it("tries failed candidates once and preserves a loaded profile after reordering", async () => {
    const calls: string[] = [];
    const admission = new FriendsGalaxyAvatarImageAdmission(async (sourceKey) => {
      calls.push(sourceKey);
      if (sourceKey === "broken") throw new Error("fixture failure");
      return asCanvasSource({ sourceKey, close: () => undefined });
    }, 8, 2);
    const first = await admission.admit([{ nodeId: "person:1", sourceKey: "broken", sourceKeys: ["broken", "good", "unused"] }]);
    const second = await admission.admit([{ nodeId: "person:1", sourceKey: "unused", sourceKeys: ["unused", "good", "broken"] }]);
    expect(calls).toEqual(["broken", "good"]);
    expect(second.images.get("person:1")).toBe(first.images.get("person:1"));
    const replaced = await admission.admit([{ nodeId: "person:1", sourceKey: "replacement", sourceKeys: ["replacement"] }]);
    expect(replaced.images.get("person:1")).not.toBe(first.images.get("person:1"));
    admission.dispose();
  });

  it("deduplicates overlapping candidate admissions and rejects late results after disposal", async () => {
    let resolve!: (image: CanvasImageSource) => void;
    let calls = 0;
    let closed = 0;
    const admission = new FriendsGalaxyAvatarImageAdmission(() => {
      calls += 1;
      return new Promise((done) => { resolve = done; });
    }, 8, 2);
    const requests = [{ nodeId: "person:1", sourceKey: "shared", sourceKeys: ["shared", "unused"] }];
    const first = admission.admit(requests);
    const second = admission.admit(requests);
    expect(calls).toBe(1);
    admission.dispose();
    resolve(asCanvasSource({ sourceKey: "shared", close: () => { closed += 1; } }));
    expect((await first).images.size).toBe(0);
    expect((await second).images.size).toBe(0);
    expect(closed).toBe(1);
  });
  it("deduplicates sources and holds decode concurrency below its bound", async () => {
    let activeDecodes = 0;
    let maximumActiveDecodes = 0;
    let decoderCalls = 0;
    const admission = new FriendsGalaxyAvatarImageAdmission(async (sourceKey) => {
      decoderCalls += 1;
      activeDecodes += 1;
      maximumActiveDecodes = Math.max(maximumActiveDecodes, activeDecodes);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeDecodes -= 1;
      return asCanvasSource({ sourceKey, close: () => undefined });
    }, 6, 2);

    const result = await admission.admit([
      request("person:1", "shared"),
      request("person:2", "shared"),
      request("person:3"),
      request("person:4"),
    ]);

    expect(decoderCalls).toBe(3);
    expect(maximumActiveDecodes).toBe(2);
    expect(result.requestedNodeCount).toBe(4);
    expect(result.readyNodeCount).toBe(4);
    expect(result.cachedSourceCount).toBe(3);
    admission.dispose();
  });

  it("caches failed source revisions instead of retrying on every settle", async () => {
    let decoderCalls = 0;
    const admission = new FriendsGalaxyAvatarImageAdmission(async () => {
      decoderCalls += 1;
      throw new Error("Invalid local image fixture");
    }, 4, 2);

    const first = await admission.admit([request("person:1", "broken:v1")]);
    const second = await admission.admit([request("person:1", "broken:v1")]);

    expect(decoderCalls).toBe(1);
    expect(first.readyNodeCount).toBe(0);
    expect(first.failedSourceCount).toBe(1);
    expect(second.failedSourceCount).toBe(1);
    admission.dispose();
  });

  it("evicts least-recently-used bitmaps and closes every owned image", async () => {
    const closedSources: string[] = [];
    const admission = new FriendsGalaxyAvatarImageAdmission(async (sourceKey) => asCanvasSource({
      sourceKey,
      close: () => closedSources.push(sourceKey),
    }), 2, 1);

    await admission.admit([request("person:1"), request("person:2")]);
    await admission.admit([request("person:2")]);
    const latest = await admission.admit([request("person:3")]);

    expect(latest.cachedSourceCount).toBe(2);
    expect(closedSources).toEqual(["person:1"]);
    admission.dispose();
    expect(closedSources.sort()).toEqual(["person:1", "person:2", "person:3"]);
  });
});
