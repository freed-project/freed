import { describe, expect, it } from "vitest";
import type { FriendsGalaxyActivityScenePatchBatch } from "../../src/lib/friends-galaxy-activity-patches.js";
import { FriendsGalaxyRendererHost } from "../../src/lib/friends-galaxy-renderer-host.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyRendererScene,
  FriendsGalaxyViewDetail,
} from "../../src/lib/friends-galaxy-renderer.js";
import type { FriendsGalaxyInteraction } from "../../src/lib/friends-galaxy-scene-index.js";
import type { FriendsGalaxyTransform } from "../../src/lib/friends-galaxy-viewport.js";
import {
  createGalaxyLabFixture,
  GALAXY_LAB_THEMES,
  galaxyLabNodePresentation,
} from "./scene-fixture.js";

class FakeRendererBackend implements FriendsGalaxyRendererBackend {
  readonly events: string[] = [];
  disposed = false;

  constructor(readonly id: FriendsGalaxyRendererId) {}

  async initialize(
    _canvas: HTMLCanvasElement,
    scene: FriendsGalaxyRendererScene,
    palette: typeof GALAXY_LAB_THEMES.scriptorium,
  ): Promise<void> {
    this.events.push(`initialize:${scene.scene.nodeIds.length}:${palette.background}`);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.events.push(`resize:${width}:${height}:${pixelRatio}`);
  }

  setPalette(palette: typeof GALAXY_LAB_THEMES.scriptorium): void {
    this.events.push(`palette:${palette.background}`);
  }

  applyActivityPatches(patches: FriendsGalaxyActivityScenePatchBatch): void {
    this.events.push(`activity:${patches.revision}`);
  }

  setAmbientMotionEnabled(enabled: boolean): void {
    this.events.push(`ambient:${enabled}`);
  }

  setCameraMotion(active: boolean): void {
    this.events.push(`motion:${active}`);
  }

  setFieldStyle(style: "nebula" | "rings" | "nebula-rings"): void {
    this.events.push(`field:${style}`);
  }

  setViewDetail(detail: FriendsGalaxyViewDetail): void {
    this.events.push(`detail:${detail}`);
  }

  setSettledView(detail: FriendsGalaxyViewDetail, transform: FriendsGalaxyTransform): void {
    this.events.push(`settled:${detail}:${transform.scale}`);
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    return `pick:${viewportX}:${viewportY}`;
  }

  setInteraction(interaction: FriendsGalaxyInteraction): void {
    this.events.push(`interaction:${interaction.selectedNodeId}:${interaction.hoveredNodeId}`);
  }

  render(transform: FriendsGalaxyTransform, timeMs: number): void {
    this.events.push(`render:${transform.scale}:${timeMs}`);
  }

  metrics(): FriendsGalaxyRendererMetrics {
    return {
      id: this.id,
      label: this.id,
      api: "test",
      semanticStarCount: 9,
      decorativeStarCount: 0,
      drawCalls: 1,
      labelCount: 0,
      avatarCount: 0,
      contextualEdgeCount: 0,
      bufferUploadCount: 0,
      fallbackReason: null,
      adapterDescription: null,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.events.push("dispose");
  }
}

function emptyActivityPatches(revision: number): FriendsGalaxyActivityScenePatchBatch {
  return {
    revision,
    nodeIndices: new Uint32Array(),
    itemCounts: new Uint32Array(),
    latestActivityAt: new Float64Array(),
    sizeScales: new Float32Array(),
    brightnessScales: new Float32Array(),
    flags: new Uint8Array(),
    avatarUrls: [],
    unknownSources: [],
  };
}

describe("Friends Galaxy renderer host", () => {
  it("replays complete renderer state before each backend becomes visible", async () => {
    const scene = createGalaxyLabFixture({
      personCount: 3,
      accountCount: 6,
      backgroundStarCount: 0,
    });
    const backends: FakeRendererBackend[] = [];
    const visibleIds: FriendsGalaxyRendererId[] = [];
    const removedSurfaces: HTMLCanvasElement[] = [];
    const host = new FriendsGalaxyRendererHost({
      scene,
      palette: GALAXY_LAB_THEMES.scriptorium,
      resolvePresentation: galaxyLabNodePresentation,
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: (_surface, id) => visibleIds.push(id),
      removeSurface: (surface) => removedSurfaces.push(surface),
      createBackend: async (id) => {
        const backend = new FakeRendererBackend(id);
        backends.push(backend);
        return backend;
      },
    });
    host.resize(390, 844, 1.5);
    host.setAmbientMotionEnabled(false);
    host.setCameraMotion(true);
    host.setFieldStyle("rings");
    host.setInteraction({ selectedNodeId: "person:1", hoveredNodeId: "account:2" });
    host.setSettledView("close", { x: 12, y: -8, scale: 0.92 });
    host.applyActivityPatches(emptyActivityPatches(7));

    await host.activate("raw-webgpu");
    host.setPalette(GALAXY_LAB_THEMES.neon);
    await host.activate("three-webgpu");

    expect(visibleIds).toEqual(["raw-webgpu", "three-webgpu"]);
    expect(backends[0]?.events).toContain("palette:#07090d");
    expect(backends[0]?.disposed).toBe(true);
    expect(backends[1]?.events).toEqual([
      "initialize:9:#07090d",
      "ambient:false",
      "motion:true",
      "field:rings",
      "resize:390:844:1.5",
      "interaction:person:1:account:2",
      "settled:close:0.92",
      "activity:7",
    ]);
    expect(removedSurfaces).toHaveLength(1);
  });

  it("forwards picking, rendering, metrics, and disposal to the active backend", async () => {
    const backend = new FakeRendererBackend("raw-webgpu");
    const host = new FriendsGalaxyRendererHost({
      scene: createGalaxyLabFixture({
        personCount: 1,
        accountCount: 0,
        backgroundStarCount: 0,
      }),
      palette: GALAXY_LAB_THEMES.vesper,
      resolvePresentation: galaxyLabNodePresentation,
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: () => undefined,
      removeSurface: () => undefined,
      createBackend: async () => backend,
    });

    await host.activate("raw-webgpu");
    expect(host.pickNode(4, 5)).toBe("pick:4:5");
    host.render({ x: 0, y: 0, scale: 0.4 }, 120);
    expect(host.metrics()?.id).toBe("raw-webgpu");
    expect(backend.events).toContain("render:0.4:120");
    host.dispose();
    expect(backend.disposed).toBe(true);
    expect(host.activeBackend).toBeNull();
  });
});
