import type {
  GalaxyLabFixture,
  GalaxyLabFixtureOptions,
} from "./scene-fixture.js";
import type {
  GalaxyLabFixtureWorkerReceipt,
  GalaxyLabFixtureWorkerRequest,
  GalaxyLabFixtureWorkerResponse,
} from "./scene-fixture-worker-protocol.js";

const DEFAULT_FIXTURE_WORKER_TIMEOUT_MS = 30_000;

export interface GalaxyLabFixtureWorkerPort {
  onmessage:
    ((event: MessageEvent<GalaxyLabFixtureWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GalaxyLabFixtureWorkerRequest): void;
  terminate(): void;
}

export interface GalaxyLabFixtureLoadResult {
  fixture: GalaxyLabFixture;
  receipt: GalaxyLabFixtureWorkerReceipt;
}

export function loadGalaxyLabFixture(
  worker: GalaxyLabFixtureWorkerPort,
  options: GalaxyLabFixtureOptions,
  timeoutMs = DEFAULT_FIXTURE_WORKER_TIMEOUT_MS,
): Promise<GalaxyLabFixtureLoadResult> {
  const requestId = 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeout !== null) globalThis.clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      settle();
    };

    timeout = globalThis.setTimeout(
      () => {
        finish(() =>
          reject(
            new Error(
              "Friends Galaxy worker timed out before producing a scene.",
            ),
          ),
        );
      },
      Math.max(1, timeoutMs),
    );

    worker.onmessage = (event) => {
      const response = event.data;
      if (response.requestId !== requestId) return;
      if (response.kind === "error") {
        finish(() => reject(new Error(response.message)));
        return;
      }
      finish(() =>
        resolve({ fixture: response.fixture, receipt: response.receipt }),
      );
    };
    worker.onerror = (event) => {
      finish(() =>
        reject(new Error(event.message || "Friends Galaxy worker failed.")),
      );
    };
    try {
      worker.postMessage({ kind: "build", requestId, options });
    } catch (error) {
      finish(() =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
    }
  });
}
