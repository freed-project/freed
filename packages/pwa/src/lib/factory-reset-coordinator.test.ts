import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPwaFactoryResetCoordinator,
  StalePwaRuntimeError,
  type PwaFactoryResetTransport,
  type PwaFactoryResetLockManager,
} from "./factory-reset-coordinator";
import {
  isFactoryResetInProgress,
  resetFactoryResetStateForTests,
} from "@freed/ui/lib/factory-reset";

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class TestBus {
  private readonly listeners = new Set<
    (message: Parameters<PwaFactoryResetTransport["post"]>[0]) => void
  >();

  createTransport(): PwaFactoryResetTransport {
    return {
      post: (message) => {
        for (const listener of this.listeners) listener(message);
      },
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const immediateLockManager: PwaFactoryResetLockManager = {
  request: async (_name, _options, callback) => callback(),
};

class TestExclusiveLockManager implements PwaFactoryResetLockManager {
  private tail: Promise<void> = Promise.resolve();

  request<T>(
    _name: string,
    _options: { mode: "exclusive" },
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

afterEach(() => {
  resetFactoryResetStateForTests();
  vi.useRealTimers();
});

describe("PWA cross-tab factory reset", () => {
  it("closes the shared write boundary synchronously for the initiating tab", async () => {
    const storage = new TestStorage();
    const finishOperation = deferred();
    const runtime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: new TestBus().createTransport(),
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["tab-a", "reset-local-boundary"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const reset = runtime.runReset(() => finishOperation.promise);

    expect(isFactoryResetInProgress()).toBe(true);
    finishOperation.resolve();
    await reset;
    runtime.dispose();
  });

  it("closes the shared write boundary synchronously when a peer receives prepare", async () => {
    const storage = new TestStorage();
    const bus = new TestBus();
    const runtime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      randomId: () => "peer-tab",
    });
    const tombstone = {
      version: 1 as const,
      resetId: "reset-peer-boundary",
      generation: 1,
      startedAt: 1,
    };
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(tombstone),
    );

    bus.createTransport().post({ type: "prepare", tombstone });

    expect(isFactoryResetInProgress()).toBe(true);
    await Promise.resolve();
    runtime.dispose();
  });

  it("closes the shared write boundary when constructed under a durable tombstone", () => {
    const storage = new TestStorage();
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify({
        version: 1,
        resetId: "reset-construction-boundary",
        generation: 1,
        startedAt: 1,
      }),
    );

    const runtime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: new TestBus().createTransport(),
      randomId: () => "new-tab",
    });

    expect(isFactoryResetInProgress()).toBe(true);
    expect(storage.getItem("freed_pwa_runtime_new-tab")).toBeNull();
    runtime.dispose();
  });

  it("recovers a crash before the reload envelope and permits reset after reload", async () => {
    const storage = new TestStorage();
    const session = new TestStorage();
    const bus = new TestBus();
    const reload = vi.fn();
    const tombstone = {
      version: 1 as const,
      resetId: "reset-crashed-before-envelope",
      generation: 1,
      startedAt: 1,
    };
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(tombstone),
    );
    storage.setItem(
      "freed_pwa_runtime_crashed-initiator",
      JSON.stringify({
        version: 1,
        runtimeId: "crashed-initiator",
        generation: 0,
        registeredAt: 1,
      }),
    );

    const recoveryRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      reload,
      randomId: () => "recovery-tab",
    });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(
      JSON.parse(storage.getItem("freed_pwa_factory_reset_reload_envelope")!),
    ).toMatchObject({
      tombstone,
      initiatorRuntimeId: "recovery-tab",
    });
    expect(session.getItem("freed_pwa_factory_reset_reload")).not.toBeNull();
    recoveryRuntime.dispose();

    const reloadedRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["reloaded-tab", "reset-retry"];
        return () => ids.shift() ?? "unexpected-reloaded-id";
      })(),
    });
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).toBeNull();
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).toBeNull();
    expect(storage.getItem("freed_pwa_runtime_crashed-initiator")).toBeNull();

    let retryRan = false;
    await reloadedRuntime.runReset(() => {
      retryRan = true;
    });
    expect(retryRan).toBe(true);
    reloadedRuntime.dispose();
  });

  it("waits for the active reset lock before recovering a missing envelope", async () => {
    const storage = new TestStorage();
    const session = new TestStorage();
    const locks = new TestExclusiveLockManager();
    const releaseActiveReset = deferred();
    const activeLockHeld = deferred();
    const tombstone = {
      version: 1 as const,
      resetId: "reset-active-lock",
      generation: 1,
      startedAt: 1,
    };
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(tombstone),
    );
    const activeReset = locks.request(
      "factory-reset",
      { mode: "exclusive" },
      async () => {
        activeLockHeld.resolve();
        await releaseActiveReset.promise;
      },
    );
    await activeLockHeld.promise;
    const reload = vi.fn();
    const recoveryRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: new TestBus().createTransport(),
      lockManager: locks,
      reload,
      randomId: () => "waiting-recovery-tab",
    });

    await Promise.resolve();
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    storage.setItem(
      "freed_pwa_factory_reset_reload_envelope",
      JSON.stringify({
        version: 1,
        tombstone,
        initiatorRuntimeId: "active-initiator",
      }),
    );
    releaseActiveReset.resolve();
    await activeReset;
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(
      JSON.parse(storage.getItem("freed_pwa_factory_reset_reload_envelope")!),
    ).toMatchObject({ initiatorRuntimeId: "active-initiator" });
    expect(session.getItem("freed_pwa_factory_reset_reload")).not.toBeNull();
    recoveryRuntime.dispose();
  });

  it("keeps a fallback reset live until its claim expires, then recovers", async () => {
    vi.useFakeTimers();
    const storage = new TestStorage();
    const session = new TestStorage();
    const now = Date.now();
    const tombstone = {
      version: 1 as const,
      resetId: "reset-active-claim",
      generation: 1,
      startedAt: now,
    };
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(tombstone),
    );
    storage.setItem(
      "freed_pwa_factory_reset_claim_active",
      JSON.stringify({
        version: 1,
        claimId: "active",
        runtimeId: "active-initiator",
        generation: 0,
        createdAt: now,
        expiresAt: now + 100,
      }),
    );
    const reload = vi.fn();
    const recoveryRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: new TestBus().createTransport(),
      lockManager: null,
      now: Date.now,
      reload,
      randomId: () => "fallback-recovery-tab",
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(
      JSON.parse(storage.getItem("freed_pwa_factory_reset_reload_envelope")!),
    ).toMatchObject({ initiatorRuntimeId: "fallback-recovery-tab" });
    expect(reload).toHaveBeenCalledOnce();
    expect(session.getItem("freed_pwa_factory_reset_reload")).not.toBeNull();
    recoveryRuntime.dispose();

    const reloadedRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: new TestBus().createTransport(),
      lockManager: null,
      now: Date.now,
      randomId: () => "fallback-reloaded-tab",
    });
    expect(storage.getItem("freed_pwa_factory_reset_claim_active")).toBeNull();
    reloadedRuntime.dispose();
  });

  it("does not complete a current reset from a stale reload envelope", async () => {
    const storage = new TestStorage();
    const session = new TestStorage();
    const bus = new TestBus();
    const staleTabReload = vi.fn();
    const staleTab = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      reload: staleTabReload,
      randomId: () => "stale-tab",
    });
    const currentTombstone = {
      version: 1 as const,
      resetId: "current-reset",
      generation: 1,
      startedAt: 2,
    };
    storage.setItem("freed_pwa_installation_generation", "1");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(currentTombstone),
    );
    storage.setItem(
      "freed_pwa_factory_reset_reload_envelope",
      JSON.stringify({
        version: 1,
        tombstone: {
          version: 1,
          resetId: "older-reset",
          generation: 1,
          startedAt: 1,
        },
        initiatorRuntimeId: "older-initiator",
      }),
    );

    staleTab.checkForPendingReload();

    expect(staleTabReload).toHaveBeenCalledOnce();
    expect(session.getItem("freed_pwa_factory_reset_reload")).toBeNull();
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).not.toBeNull();
    staleTab.dispose();

    const recoveryReload = vi.fn();
    const recoveryRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      reload: recoveryReload,
      randomId: () => "current-recovery-tab",
    });
    await vi.waitFor(() => expect(recoveryReload).toHaveBeenCalledOnce());

    expect(
      JSON.parse(storage.getItem("freed_pwa_factory_reset_reload_envelope")!),
    ).toMatchObject({
      tombstone: currentTombstone,
      initiatorRuntimeId: "current-recovery-tab",
    });
    expect(session.getItem("freed_pwa_factory_reset_reload")).not.toBeNull();
    recoveryRuntime.dispose();
  });

  it("quiesces another runtime and rejects delayed OAuth and document commits", async () => {
    const storage = new TestStorage();
    const bus = new TestBus();
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["tab-a", "reset-one"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      randomId: () => "tab-b",
    });

    storage.setItem("freed_cloud_token_gdrive", "old-token");
    let documentValue: string | null = "old-document";
    let runtimeBQuiesced = false;
    runtimeB.registerQuiesceHandler("test-runtime", () => {
      runtimeBQuiesced = true;
    });

    const oauthResponse = deferred();
    const documentMutation = deferred();
    const oauthLifecycle = runtimeB.captureLifecycle();
    const documentLifecycle = runtimeB.captureLifecycle();
    const delayedOAuthCommit = oauthResponse.promise.then(() => {
      oauthLifecycle.assertCurrent();
      storage.setItem("freed_cloud_token_gdrive", "restored-token");
    });
    const delayedDocumentCommit = documentMutation.promise.then(() => {
      documentLifecycle.assertCurrent();
      documentValue = "restored-document";
    });

    await runtimeA.runReset(() => {
      expect(runtimeBQuiesced).toBe(true);
      storage.removeItem("freed_cloud_token_gdrive");
      documentValue = null;
    });

    oauthResponse.resolve();
    documentMutation.resolve();

    await expect(delayedOAuthCommit).rejects.toBeInstanceOf(
      StalePwaRuntimeError,
    );
    await expect(delayedDocumentCommit).rejects.toBeInstanceOf(
      StalePwaRuntimeError,
    );
    expect(storage.getItem("freed_cloud_token_gdrive")).toBeNull();
    expect(documentValue).toBeNull();
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).not.toBeNull();
    runtimeA.dispose();
    runtimeB.dispose();
  });

  it("quiesces an arbitrarily old live registration when it answers prepare", async () => {
    let now = 0;
    const storage = new TestStorage();
    const bus = new TestBus();
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      now: () => now,
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["tab-a", "reset-old-registration"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      now: () => now,
      randomId: () => "tab-b",
    });
    let runtimeBQuiesced = false;
    runtimeB.registerQuiesceHandler("test-runtime", () => {
      runtimeBQuiesced = true;
    });

    now = 10 * 365 * 24 * 60 * 60 * 1_000;
    await runtimeA.runReset(() => {
      expect(runtimeBQuiesced).toBe(true);
    });

    runtimeA.dispose();
    runtimeB.dispose();
  });

  it("fails safely for an orphaned runtime, clears it on reload, and succeeds on retry", async () => {
    vi.useFakeTimers();
    const storage = new TestStorage();
    const session = new TestStorage();
    const bus = new TestBus();
    storage.setItem(
      "freed_pwa_runtime_crashed-tab",
      JSON.stringify({
        version: 1,
        runtimeId: "crashed-tab",
        generation: 0,
        registeredAt: 1,
      }),
    );
    const runtime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      acknowledgementTimeoutMs: 25,
      randomId: (() => {
        const ids = ["tab-a", "reset-before-reload"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });
    let operationRan = false;

    const firstReset = runtime.runReset(() => {
      operationRan = true;
    });
    const firstFailure = expect(firstReset).rejects.toThrow(
      "Freed will reload safely. Retry factory reset after the reload.",
    );
    await vi.advanceTimersByTimeAsync(40);
    await firstFailure;

    expect(operationRan).toBe(false);
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).not.toBeNull();
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).not.toBeNull();
    runtime.prepareReload();
    runtime.dispose();

    const reloadedRuntime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      acknowledgementTimeoutMs: 25,
      randomId: (() => {
        const ids = ["tab-reloaded", "reset-after-reload"];
        return () => ids.shift() ?? "unexpected-reloaded-id";
      })(),
    });

    expect(storage.getItem("freed_pwa_runtime_crashed-tab")).toBeNull();
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).toBeNull();
    expect(reloadedRuntime.isCurrent()).toBe(true);

    await reloadedRuntime.runReset(() => {
      operationRan = true;
    });

    expect(operationRan).toBe(true);
    reloadedRuntime.dispose();
  });

  it("allows a peer to use the full bounded sequential quiesce budget", async () => {
    vi.useFakeTimers();
    const storage = new TestStorage();
    const bus = new TestBus();
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["tab-a", "reset-slow-peer"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      randomId: () => "tab-b",
    });
    for (const name of ["sync", "store", "automerge"]) {
      runtimeB.registerQuiesceHandler(
        name,
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 11_000);
          }),
      );
    }
    let operationRan = false;

    const reset = runtimeA.runReset(() => {
      operationRan = true;
    });
    await vi.advanceTimersByTimeAsync(33_100);
    await reset;

    expect(operationRan).toBe(true);
    runtimeA.dispose();
    runtimeB.dispose();
  });

  it.each([
    {
      label: "corrupt",
      acknowledgement: { generation: 1 },
    },
    {
      label: "stale reset",
      acknowledgement: {
        version: 1,
        resetId: "older-reset",
        runtimeId: "peer-tab",
        generation: 1,
        acknowledgedAt: 1,
        errors: [],
      },
    },
    {
      label: "wrong runtime",
      acknowledgement: {
        version: 1,
        resetId: "reset-strict-ack",
        runtimeId: "different-tab",
        generation: 1,
        acknowledgedAt: 1,
        errors: [],
      },
    },
    {
      label: "wrong generation",
      acknowledgement: {
        version: 1,
        resetId: "reset-strict-ack",
        runtimeId: "peer-tab",
        generation: 0,
        acknowledgedAt: 1,
        errors: [],
      },
    },
  ])(
    "rejects a $label acknowledgement at the expected storage key",
    async ({ acknowledgement }) => {
      vi.useFakeTimers();
      const storage = new TestStorage();
      storage.setItem(
        "freed_pwa_runtime_peer-tab",
        JSON.stringify({
          version: 1,
          runtimeId: "peer-tab",
          generation: 0,
          registeredAt: 1,
        }),
      );
      storage.setItem(
        "freed_pwa_factory_reset_ack_reset-strict-ack_peer-tab",
        JSON.stringify(acknowledgement),
      );
      const runtime = createPwaFactoryResetCoordinator({
        storage,
        sessionStorage: new TestStorage(),
        transport: new TestBus().createTransport(),
        lockManager: immediateLockManager,
        acknowledgementTimeoutMs: 25,
        randomId: (() => {
          const ids = ["tab-a", "reset-strict-ack"];
          return () => ids.shift() ?? "unexpected-id";
        })(),
      });
      let operationRan = false;

      const reset = runtime.runReset(() => {
        operationRan = true;
      });
      const rejected = expect(reset).rejects.toThrow(
        "Freed will reload safely. Retry factory reset after the reload.",
      );
      await vi.advanceTimersByTimeAsync(40);
      await rejected;

      expect(operationRan).toBe(false);
      runtime.dispose();
    },
  );

  it("elects one reset initiator when Web Locks are unavailable", async () => {
    const storage = new TestStorage();
    const bus = new TestBus();
    const now = () => 100;
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      now,
      claimElectionWindowMs: 5,
      randomId: (() => {
        const ids = ["tab-a", "claim-a", "reset-a"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      now,
      claimElectionWindowMs: 5,
      randomId: (() => {
        const ids = ["tab-b", "claim-b", "reset-b"];
        return () => ids.shift() ?? "unexpected-b-id";
      })(),
    });
    let operationCount = 0;

    const results = await Promise.allSettled([
      runtimeA.runReset(() => {
        operationCount += 1;
      }),
      runtimeB.runReset(() => {
        operationCount += 1;
      }),
    ]);

    expect(operationCount).toBe(1);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    runtimeA.dispose();
    runtimeB.dispose();
  });

  it("fails reset when a peer quiesce handler hangs and aborts its late work", async () => {
    const storage = new TestStorage();
    const bus = new TestBus();
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      quiesceHandlerTimeoutMs: 5,
      randomId: (() => {
        const ids = ["tab-a", "reset-timeout"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      quiesceHandlerTimeoutMs: 5,
      randomId: () => "tab-b",
    });
    let lateWriteRan = false;
    runtimeB.registerQuiesceHandler(
      "hanging-writer",
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              if (!signal.aborted) lateWriteRan = true;
              resolve();
            },
            { once: true },
          );
        }),
    );

    await expect(
      runtimeA.runReset(() => {
        throw new Error("destructive operation must not run");
      }),
    ).rejects.toThrow("hanging-writer did not quiesce");

    expect(lateWriteRan).toBe(false);
    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).not.toBeNull();
    runtimeA.dispose();
    runtimeB.dispose();
  });

  it("makes an acknowledged peer inert and usable only after generation reload", async () => {
    const storage = new TestStorage();
    const peerSession = new TestStorage();
    const bus = new TestBus();
    let peerInert = false;
    let peerReloaded = false;
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: immediateLockManager,
      randomId: (() => {
        const ids = ["tab-a", "reset-preferences"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const runtimeB = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: peerSession,
      transport: bus.createTransport(),
      onQuiesced: () => {
        peerInert = true;
      },
      reload: () => {
        peerReloaded = true;
      },
      randomId: () => "tab-b",
    });
    const oldPeerLifecycle = runtimeB.captureLifecycle();

    await runtimeA.runReset(() => {
      expect(peerInert).toBe(true);
      expect(oldPeerLifecycle.isCurrent()).toBe(false);
      if (!peerInert)
        storage.setItem("freed_device_display_preferences", "restored");
    });

    expect(storage.getItem("freed_device_display_preferences")).toBeNull();
    expect(peerReloaded).toBe(true);
    const reloadedPeer = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: peerSession,
      transport: bus.createTransport(),
      randomId: () => "tab-b-reloaded",
    });
    expect(reloadedPeer.isCurrent()).toBe(true);
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).toBeNull();
    storage.setItem("freed_device_display_preferences", "new-generation");
    expect(storage.getItem("freed_device_display_preferences")).toBe(
      "new-generation",
    );

    runtimeA.dispose();
    runtimeB.dispose();
    reloadedPeer.dispose();
  });

  it("reloads tabs opened both before and after the durable reload envelope", async () => {
    const storage = new TestStorage();
    const bus = new TestBus();
    const locks = new TestExclusiveLockManager();
    const operationStarted = deferred();
    const finishOperation = deferred();
    const runtimeA = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: locks,
      randomId: (() => {
        const ids = ["tab-a", "reset-mid-open"];
        return () => ids.shift() ?? "unexpected-a-id";
      })(),
    });
    const reset = runtimeA.runReset(async () => {
      operationStarted.resolve();
      await finishOperation.promise;
    });
    await operationStarted.promise;

    let beforeMessageInert = false;
    let beforeMessageReloaded = false;
    const beforeMessageTab = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: locks,
      onQuiesced: () => {
        beforeMessageInert = true;
      },
      reload: () => {
        beforeMessageReloaded = true;
      },
      randomId: () => "tab-before-message",
    });
    expect(beforeMessageInert).toBe(true);
    expect(beforeMessageReloaded).toBe(false);

    finishOperation.resolve();
    await reset;
    expect(beforeMessageReloaded).toBe(true);

    let afterMessageInert = false;
    let afterMessageReloaded = false;
    const afterMessageTab = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: new TestStorage(),
      transport: bus.createTransport(),
      lockManager: locks,
      onQuiesced: () => {
        afterMessageInert = true;
      },
      reload: () => {
        afterMessageReloaded = true;
      },
      randomId: () => "tab-after-message",
    });
    expect(afterMessageInert).toBe(true);
    expect(afterMessageReloaded).toBe(true);

    runtimeA.dispose();
    beforeMessageTab.dispose();
    afterMessageTab.dispose();
  });

  it("keeps registrations from the new generation while clearing a completed reset", () => {
    const storage = new TestStorage();
    const session = new TestStorage();
    const tombstone = {
      version: 1,
      resetId: "completed-reset",
      generation: 4,
      startedAt: 1,
    };
    storage.setItem("freed_pwa_installation_generation", "4");
    storage.setItem(
      "freed_pwa_factory_reset_tombstone",
      JSON.stringify(tombstone),
    );
    storage.setItem(
      "freed_pwa_factory_reset_reload_envelope",
      JSON.stringify({
        version: 1,
        tombstone,
        initiatorRuntimeId: "old-initiator",
      }),
    );
    storage.setItem(
      "freed_pwa_runtime_old-tab",
      JSON.stringify({
        version: 1,
        runtimeId: "old-tab",
        generation: 3,
        registeredAt: 1,
      }),
    );
    storage.setItem(
      "freed_pwa_runtime_new-tab",
      JSON.stringify({
        version: 1,
        runtimeId: "new-tab",
        generation: 4,
        registeredAt: 2,
      }),
    );
    storage.setItem(
      "freed_pwa_factory_reset_ack_completed-reset_old-tab",
      JSON.stringify({
        version: 1,
        resetId: "completed-reset",
        runtimeId: "old-tab",
        generation: 4,
        acknowledgedAt: 2,
        errors: [],
      }),
    );
    session.setItem(
      "freed_pwa_factory_reset_reload",
      JSON.stringify({
        resetId: "completed-reset",
        generation: 4,
      }),
    );

    const runtime = createPwaFactoryResetCoordinator({
      storage,
      sessionStorage: session,
      transport: new TestBus().createTransport(),
      randomId: () => "reloaded-tab",
    });

    expect(storage.getItem("freed_pwa_factory_reset_tombstone")).toBeNull();
    expect(
      storage.getItem("freed_pwa_factory_reset_reload_envelope"),
    ).toBeNull();
    expect(storage.getItem("freed_pwa_runtime_old-tab")).toBeNull();
    expect(storage.getItem("freed_pwa_runtime_new-tab")).not.toBeNull();
    expect(
      storage.getItem("freed_pwa_factory_reset_ack_completed-reset_old-tab"),
    ).toBeNull();
    runtime.dispose();
  });

  it.each([
    { acknowledgementTimeoutMs: 0 },
    { claimElectionWindowMs: Number.NaN },
    { quiesceHandlerTimeoutMs: -5 },
  ])("rejects unsafe timing options: %o", (timingOption) => {
    expect(() =>
      createPwaFactoryResetCoordinator({
        storage: new TestStorage(),
        sessionStorage: new TestStorage(),
        transport: new TestBus().createTransport(),
        ...timingOption,
      }),
    ).toThrow("must be a positive finite number");
  });
});
