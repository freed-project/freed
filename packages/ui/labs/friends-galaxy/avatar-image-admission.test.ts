import { describe, expect, it } from "vitest";
import {
  GalaxyLabAvatarImageAdmission,
  type GalaxyLabAvatarImageRequest,
} from "./avatar-image-admission.js";

interface FakeImage {
  sourceKey: string;
  close: () => void;
}

function request(nodeId: string, sourceKey = nodeId): GalaxyLabAvatarImageRequest {
  return { nodeId, sourceKey };
}

function asCanvasSource(image: FakeImage): CanvasImageSource {
  return image as unknown as CanvasImageSource;
}

describe("Friends Galaxy avatar image admission", () => {
  it("deduplicates sources and holds decode concurrency below its bound", async () => {
    let activeDecodes = 0;
    let maximumActiveDecodes = 0;
    let decoderCalls = 0;
    const admission = new GalaxyLabAvatarImageAdmission(async (sourceKey) => {
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
    const admission = new GalaxyLabAvatarImageAdmission(async () => {
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
    const admission = new GalaxyLabAvatarImageAdmission(async (sourceKey) => asCanvasSource({
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
