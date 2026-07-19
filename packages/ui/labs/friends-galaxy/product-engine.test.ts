import { describe, expect, it } from "vitest";
import type { FriendsGalaxyActivityScenePatchBatch } from "../../src/lib/friends-galaxy-activity-patches.js";
import { FriendsGalaxyProductEngine } from "../../src/lib/friends-galaxy-product-engine.js";
import type { FriendsGalaxyProductWorkerPort } from "../../src/lib/friends-galaxy-product-worker-client.js";
import type {
  FriendsGalaxyProductWorkerRequest,
  FriendsGalaxyProductWorkerResponse,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import type {
  FriendsGalaxyRendererBackend,
  FriendsGalaxyRendererId,
  FriendsGalaxyRendererMetrics,
  FriendsGalaxyRendererScene,
  FriendsGalaxyViewDetail,
} from "../../src/lib/friends-galaxy-renderer.js";
import type { FriendsGalaxyInteraction } from "../../src/lib/friends-galaxy-scene-index.js";
import { FRIENDS_GALAXY_THEME_PALETTES } from "../../src/lib/friends-galaxy-theme-palettes.js";
import type { FriendsGalaxyTransform } from "../../src/lib/friends-galaxy-viewport.js";
import type { IdentityGraphAtlas } from "../../src/lib/identity-graph-atlas.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

class ControlledProductWorker implements FriendsGalaxyProductWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: FriendsGalaxyProductWorkerRequest[] = [];
  terminated = false;

  postMessage(message: FriendsGalaxyProductWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: FriendsGalaxyProductWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

class ProductRendererBackend implements FriendsGalaxyRendererBackend {
  readonly events: string[] = [];
  initializedScene: FriendsGalaxyRendererScene | null = null;
  presentationAtlas: IdentityGraphAtlas | null = null;
  disposed = false;

  constructor(
    readonly id: FriendsGalaxyRendererId,
    private readonly initializeGate?: Promise<void>,
  ) {}

  async initialize(
    _canvas: HTMLCanvasElement,
    scene: FriendsGalaxyRendererScene,
  ): Promise<void> {
    this.initializedScene = scene;
    this.events.push(`initialize:${scene.personCount}:${scene.accountCount}`);
    await this.initializeGate;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.events.push(`resize:${width}:${height}:${pixelRatio}`);
  }

  setPalette(): void {
    this.events.push("palette");
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

  setPresentationAtlas(atlas: IdentityGraphAtlas): void {
    this.presentationAtlas = atlas;
    this.events.push(`presentation:${atlas.nodes.length}`);
  }

  setViewDetail(detail: FriendsGalaxyViewDetail): void {
    this.events.push(`detail:${detail}`);
  }

  setSettledView(
    detail: FriendsGalaxyViewDetail,
    transform: FriendsGalaxyTransform,
  ): void {
    this.events.push(`settled:${detail}:${transform.scale}`);
  }

  hasActivePresentationTransition(): boolean {
    return false;
  }

  pickNode(viewportX: number, viewportY: number): string | null {
    return `pick:${viewportX}:${viewportY}`;
  }

  setInteraction(interaction: FriendsGalaxyInteraction): void {
    this.events.push(
      `interaction:${interaction.selectedNodeId}:${interaction.hoveredNodeId}`,
    );
  }

  render(transform: FriendsGalaxyTransform, timeMs: number): void {
    this.events.push(`render:${transform.scale}:${timeMs}`);
  }

  metrics(): FriendsGalaxyRendererMetrics {
    return {
      id: this.id,
      label: "Product test renderer",
      api: "test",
      semanticStarCount: this.initializedScene?.scene.nodeIds.length ?? 0,
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

function sourceRequest(sourceRevision = 1, personCount = 12, accountCount = 48) {
  return {
    kind: "source" as const,
    sourceRevision,
    source: createFriendsGalaxyProductSource(personCount, accountCount),
    viewport: {
      width: 390,
      height: 844,
      selectedAccountId: "product-account-2",
    },
    backgroundStarCount: 1_000,
    backgroundSeed: `product-engine-${sourceRevision.toLocaleString()}`,
  };
}

function presentationRequest(sourceRevision = 1, presentationRevision = 1) {
  return {
    kind: "presentation" as const,
    sourceRevision,
    presentationRevision,
    viewport: {
      width: 390,
      height: 844,
      transform: { x: 195, y: 422, scale: 0.52 },
      selectedAccountId: "product-account-2",
    },
  };
}

function response(
  service: FriendsGalaxyProductWorkerService,
  worker: ControlledProductWorker,
  index: number,
): FriendsGalaxyProductWorkerResponse {
  return service.handle(worker.messages[index]!);
}

async function flushActivation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Friends Galaxy product engine", () => {
  it("connects the real worker scene, bounded metadata, and replayed renderer state", async () => {
    const worker = new ControlledProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const backends: ProductRendererBackend[] = [];
    const sourceRevisions: number[] = [];
    const presentationRevisions: number[] = [];
    const engine = new FriendsGalaxyProductEngine({
      palette: FRIENDS_GALAXY_THEME_PALETTES.scriptorium,
      createWorker: () => worker,
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: () => undefined,
      removeSurface: () => undefined,
      createBackend: async (id) => {
        const backend = new ProductRendererBackend(id);
        backends.push(backend);
        return backend;
      },
      onSourceSceneReady: (result) => sourceRevisions.push(result.sourceRevision),
      onPresentationReady: (result) =>
        presentationRevisions.push(result.presentationRevision),
    });
    engine.resize(390, 844, 1.5);
    engine.setAmbientMotionEnabled(false);
    engine.setCameraMotion(true);
    engine.setFieldStyle("nebula-rings");
    engine.setInteraction({
      selectedNodeId: "account:product-account-2",
      hoveredNodeId: null,
    });
    engine.setSettledView("middle", { x: 195, y: 422, scale: 0.52 });

    engine.requestSource(sourceRequest());
    worker.emit(response(service, worker, 0));
    await flushActivation();

    expect(engine.activeRendererId).toBe("raw-webgpu");
    expect(sourceRevisions).toEqual([1]);
    expect(engine.metadata("account:product-account-2")?.label).toBe(
      "Product Author 2",
    );
    expect(engine.metadata("person:product-person-2")?.label).toBe(
      "Product Person 2",
    );
    expect(backends[0]?.events).toEqual(expect.arrayContaining([
      "ambient:false",
      "motion:true",
      "field:nebula-rings",
      "resize:390:844:1.5",
      "interaction:account:product-account-2:null",
      "settled:middle:0.52",
    ]));

    engine.requestSettledPresentation(presentationRequest());
    worker.emit(response(service, worker, 1));
    expect(presentationRevisions).toEqual([1]);
    expect(backends[0]?.presentationAtlas?.nodes.slice(0, 2).map((node) => node.id))
      .toEqual(["account:product-account-2", "person:product-person-2"]);
    expect(engine.pickNode(4, 9)).toBe("pick:4:9");
    engine.render({ x: 0, y: 0, scale: 0.52 }, 120);
    expect(backends[0]?.events).toContain("render:0.52:120");
  });

  it("keeps the last visible renderer when the product worker fails", async () => {
    const worker = new ControlledProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const failures: string[] = [];
    const backend = new ProductRendererBackend("raw-webgpu");
    const engine = new FriendsGalaxyProductEngine({
      palette: FRIENDS_GALAXY_THEME_PALETTES.neon,
      createWorker: () => worker,
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: () => undefined,
      removeSurface: () => undefined,
      createBackend: async () => backend,
      onWorkerFailure: (failure) => failures.push(failure.phase),
    });

    engine.requestSource(sourceRequest());
    worker.emit(response(service, worker, 0));
    await flushActivation();
    worker.onerror?.({ message: "worker stopped" } as ErrorEvent);

    expect(failures).toEqual(["runtime"]);
    expect(engine.sourceReady).toBe(true);
    expect(engine.workerSourceReady).toBe(false);
    expect(engine.activeSourceRevision).toBe(1);
    expect(engine.requestedSourceRevision).toBeNull();
    expect(engine.activeRenderer).toBe(backend);
    expect(backend.disposed).toBe(false);
    expect(engine.metadata("person:product-person-2")?.label).toBe(
      "Product Person 2",
    );
  });

  it("invalidates an initializing source scene when a newer revision arrives", async () => {
    const workers: ControlledProductWorker[] = [];
    const services = [
      new FriendsGalaxyProductWorkerService(),
      new FriendsGalaxyProductWorkerService(),
    ];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const backends: ProductRendererBackend[] = [];
    const engine = new FriendsGalaxyProductEngine({
      palette: FRIENDS_GALAXY_THEME_PALETTES.midas,
      createWorker: () => {
        const worker = new ControlledProductWorker();
        workers.push(worker);
        return worker;
      },
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: () => undefined,
      removeSurface: () => undefined,
      createBackend: async (id) => {
        const backend = new ProductRendererBackend(
          id,
          backends.length === 0 ? firstGate : undefined,
        );
        backends.push(backend);
        return backend;
      },
    });

    engine.requestSource(sourceRequest(1, 4, 12));
    workers[0]!.emit(response(services[0]!, workers[0]!, 0));
    await Promise.resolve();
    engine.requestSource(sourceRequest(2, 9, 27));
    workers[1]!.emit(response(services[1]!, workers[1]!, 0));
    await flushActivation();

    expect(engine.activeSourceRevision).toBe(2);
    expect(engine.activeRenderer).toBe(backends[1]);
    expect(backends[1]?.initializedScene?.personCount).toBe(9);
    releaseFirst();
    await flushActivation();
    expect(backends[0]?.disposed).toBe(true);
    expect(workers[0]?.terminated).toBe(true);
  });

  it("disposes its worker and active renderer exactly once", async () => {
    const worker = new ControlledProductWorker();
    const service = new FriendsGalaxyProductWorkerService();
    const backend = new ProductRendererBackend("raw-webgpu");
    const engine = new FriendsGalaxyProductEngine({
      palette: FRIENDS_GALAXY_THEME_PALETTES.ember,
      createWorker: () => worker,
      createSurface: () => ({}) as HTMLCanvasElement,
      mountSurface: () => undefined,
      showSurface: () => undefined,
      removeSurface: () => undefined,
      createBackend: async () => backend,
    });

    engine.requestSource(sourceRequest());
    worker.emit(response(service, worker, 0));
    await flushActivation();
    engine.dispose();
    engine.dispose();

    expect(worker.terminated).toBe(true);
    expect(backend.events.filter((event) => event === "dispose")).toHaveLength(1);
    expect(() => engine.requestSource(sourceRequest(2))).toThrow(
      "Friends Galaxy product engine is disposed.",
    );
  });
});
