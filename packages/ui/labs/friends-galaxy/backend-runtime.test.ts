import { describe, expect, it } from "vitest";
import {
  FriendsGalaxyBackendRuntime,
  type FriendsGalaxyBackendActivation,
  type FriendsGalaxyBackendFailure,
  type FriendsGalaxyBackendRecovery,
} from "../../src/lib/friends-galaxy-backend-runtime.js";

type BackendId = "compatibility" | "raw" | "reference";

interface Surface {
  id: number;
  mounted: boolean;
  visible: boolean;
  removed: boolean;
}

class FakeBackend {
  disposed = 0;
  fatalError: string | null = null;

  constructor(readonly id: BackendId) {}

  takeFatalError(): string | null {
    const error = this.fatalError;
    this.fatalError = null;
    return error;
  }

  dispose(): void {
    this.disposed += 1;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtimeHarness() {
  let nextSurfaceId = 1;
  const surfaces: Surface[] = [];
  const createdBackends: FakeBackend[] = [];
  const initialization = new Map<BackendId, Deferred<void>[]>();
  const failures = new Map<BackendId, string[]>();
  const showFailures = new Map<BackendId, string[]>();
  const activations: Array<FriendsGalaxyBackendActivation<BackendId, FakeBackend, Surface>> = [];
  const recoveries: Array<FriendsGalaxyBackendRecovery<BackendId>> = [];
  const terminalFailures: Array<FriendsGalaxyBackendFailure<BackendId>> = [];
  const createCounts = new Map<BackendId, number>();

  const runtime = new FriendsGalaxyBackendRuntime<BackendId, FakeBackend, Surface>({
    compatibilityId: "compatibility",
    createSurface: () => {
      const surface = {
        id: nextSurfaceId++,
        mounted: false,
        visible: false,
        removed: false,
      };
      surfaces.push(surface);
      return surface;
    },
    mountSurface: (surface) => {
      surface.mounted = true;
    },
    showSurface: (surface, id) => {
      const failure = showFailures.get(id)?.shift();
      if (failure) throw new Error(failure);
      surface.visible = true;
    },
    removeSurface: (surface) => {
      surface.removed = true;
    },
    createBackend: async (id) => {
      createCounts.set(id, (createCounts.get(id) ?? 0) + 1);
      const failure = failures.get(id)?.shift();
      if (failure) throw new Error(failure);
      const backend = new FakeBackend(id);
      createdBackends.push(backend);
      return backend;
    },
    initializeBackend: async (_backend, _surface, id) => {
      const next = initialization.get(id)?.shift();
      if (next) await next.promise;
    },
    fallbackReason: () => null,
    onActivated: (activation) => activations.push(activation),
    onRecovering: (recovery) => recoveries.push(recovery),
    onFailure: (failure) => terminalFailures.push(failure),
  });

  return {
    runtime,
    surfaces,
    createdBackends,
    activations,
    recoveries,
    terminalFailures,
    createCounts,
    deferInitialization(id: BackendId) {
      const gate = deferred<void>();
      const queue = initialization.get(id) ?? [];
      queue.push(gate);
      initialization.set(id, queue);
      return gate;
    },
    failNextCreation(id: BackendId, reason: string) {
      const queue = failures.get(id) ?? [];
      queue.push(reason);
      failures.set(id, queue);
    },
    failNextShow(id: BackendId, reason: string) {
      const queue = showFailures.get(id) ?? [];
      queue.push(reason);
      showFailures.set(id, queue);
    },
  };
}

describe("Friends Galaxy backend runtime", () => {
  it("keeps the visible backend until a prepared replacement commits", async () => {
    const harness = runtimeHarness();
    await harness.runtime.activate("raw");
    const original = harness.runtime.activeBackend!;
    const originalSurface = harness.runtime.activeSurface!;
    const replacementGate = harness.deferInitialization("reference");

    const switching = harness.runtime.activate("reference");
    await Promise.resolve();
    expect(harness.runtime.activeBackend).toBe(original);
    expect(original.disposed).toBe(0);
    expect(originalSurface.removed).toBe(false);
    expect(harness.surfaces.at(-1)).toMatchObject({ mounted: true, visible: false });

    replacementGate.resolve();
    const activation = await switching;
    expect(activation?.id).toBe("reference");
    expect(harness.runtime.activeBackend).toBe(activation?.backend);
    expect(original.disposed).toBe(1);
    expect(originalSurface.removed).toBe(true);
    expect(activation?.surface.visible).toBe(true);
  });

  it("disposes a superseded async candidate without replacing the latest renderer", async () => {
    const harness = runtimeHarness();
    const rawGate = harness.deferInitialization("raw");
    const staleActivation = harness.runtime.activate("raw");
    await Promise.resolve();
    const staleBackend = harness.createdBackends[0]!;
    const staleSurface = harness.surfaces[0]!;

    const currentActivation = await harness.runtime.activate("compatibility");
    expect(staleSurface.removed).toBe(true);
    rawGate.resolve();
    expect(await staleActivation).toBeNull();
    expect(harness.runtime.activeBackend).toBe(currentActivation?.backend);
    expect(staleBackend.disposed).toBe(1);
    expect(staleSurface.removed).toBe(true);
    expect(harness.activations.map(({ id }) => id)).toEqual(["compatibility"]);
  });

  it("falls back after preferred activation fails and preserves the exact reason", async () => {
    const harness = runtimeHarness();
    harness.failNextCreation("raw", "Raw WebGPU unavailable");

    const activation = await harness.runtime.activate("raw");
    expect(activation).toMatchObject({
      id: "compatibility",
      fallbackReason: "Raw WebGPU unavailable",
      recovery: true,
      retained: false,
    });
    expect(harness.runtime.recoveryReason).toBe("Raw WebGPU unavailable");
    expect(harness.recoveries).toHaveLength(1);
    expect(harness.terminalFailures).toHaveLength(0);
  });

  it("cleans a prepared surface that cannot commit before falling back", async () => {
    const harness = runtimeHarness();
    harness.failNextShow("raw", "Canvas could not be presented");

    const activation = await harness.runtime.activate("raw");
    expect(activation).toMatchObject({
      id: "compatibility",
      fallbackReason: "Canvas could not be presented",
      recovery: true,
    });
    expect(harness.createdBackends[0]?.disposed).toBe(1);
    expect(harness.surfaces[0]).toMatchObject({ visible: false, removed: true });
    expect(harness.surfaces[1]).toMatchObject({ visible: true, removed: false });
  });

  it("retains an active compatibility renderer when a preferred switch fails", async () => {
    const harness = runtimeHarness();
    await harness.runtime.activate("compatibility");
    const compatibility = harness.runtime.activeBackend!;
    const surface = harness.runtime.activeSurface!;
    harness.failNextCreation("raw", "No adapter");

    const activation = await harness.runtime.activate("raw");
    expect(activation).toMatchObject({
      id: "compatibility",
      fallbackReason: "No adapter",
      recovery: true,
      retained: true,
    });
    expect(harness.runtime.activeBackend).toBe(compatibility);
    expect(harness.runtime.activeSurface).toBe(surface);
    expect(compatibility.disposed).toBe(0);
    expect(harness.createCounts.get("compatibility")).toBe(1);
  });

  it("schedules only one compatibility recovery for a fatal preferred backend", async () => {
    const harness = runtimeHarness();
    await harness.runtime.activate("raw");
    const raw = harness.runtime.activeBackend!;
    const compatibilityGate = harness.deferInitialization("compatibility");
    raw.fatalError = "Device removed";

    const recovering = harness.runtime.pollHealth();
    expect(recovering).not.toBeNull();
    expect(harness.runtime.recoveryPending).toBe(true);
    expect(harness.runtime.pollHealth()).toBeNull();
    compatibilityGate.resolve();
    const activation = await recovering;
    expect(activation?.id).toBe("compatibility");
    expect(activation?.fallbackReason).toBe("Device removed");
    expect(raw.disposed).toBe(1);
    expect(harness.runtime.recoveryPending).toBe(false);
    expect(harness.createCounts.get("compatibility")).toBe(1);
  });

  it("latches a compatibility runtime failure without entering a recovery loop", async () => {
    const harness = runtimeHarness();
    await harness.runtime.activate("compatibility");
    const compatibility = harness.runtime.activeBackend!;
    compatibility.fatalError = "Context lost";

    expect(harness.runtime.pollHealth()).toBeNull();
    expect(harness.runtime.terminalFailure).toBe(true);
    expect(harness.terminalFailures).toEqual([expect.objectContaining({
      id: "compatibility",
      phase: "runtime",
      reason: "Context lost",
    })]);
    expect(harness.runtime.pollHealth()).toBeNull();
    expect(harness.createCounts.get("compatibility")).toBe(1);
    expect(compatibility.disposed).toBe(0);
  });

  it("invalidates and cleans a pending candidate when disposed", async () => {
    const harness = runtimeHarness();
    const rawGate = harness.deferInitialization("raw");
    const activating = harness.runtime.activate("raw");
    await Promise.resolve();
    const backend = harness.createdBackends[0]!;
    const surface = harness.surfaces[0]!;

    harness.runtime.dispose();
    expect(surface.removed).toBe(true);
    rawGate.resolve();
    expect(await activating).toBeNull();
    expect(backend.disposed).toBe(1);
    expect(surface.removed).toBe(true);
    expect(harness.runtime.activeBackend).toBeNull();
  });

  it("allows an explicit activation to clear a terminal compatibility failure", async () => {
    const harness = runtimeHarness();
    await harness.runtime.activate("compatibility");
    harness.runtime.activeBackend!.fatalError = "Context lost";
    harness.runtime.pollHealth();
    expect(harness.runtime.terminalFailure).toBe(true);

    const activation = await harness.runtime.activate("raw");
    expect(activation?.id).toBe("raw");
    expect(harness.runtime.terminalFailure).toBe(false);
    expect(harness.runtime.recoveryReason).toBeNull();
  });
});
