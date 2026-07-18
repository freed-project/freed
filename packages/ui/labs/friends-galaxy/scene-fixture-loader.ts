import type {
  GalaxyLabFixture,
  GalaxyLabFixtureOptions,
} from "./scene-fixture.js";
import {
  validateGalaxyLabFixtureEnvelope,
  type GalaxyLabFixtureWorkerReceipt,
  type GalaxyLabFixtureWorkerRequest,
} from "./scene-fixture-worker-protocol.js";

const DEFAULT_FIXTURE_WORKER_TIMEOUT_MS = 30_000;

export interface GalaxyLabFixtureWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
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
      worker.onmessageerror = null;
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
      if (!response || typeof response !== "object") {
        finish(() =>
          reject(
            new Error("Friends Galaxy worker returned an invalid response."),
          ),
        );
        return;
      }
      const candidate = response as Record<string, unknown>;
      if (!Number.isInteger(candidate.requestId)) {
        finish(() =>
          reject(
            new Error("Friends Galaxy worker returned an invalid request id."),
          ),
        );
        return;
      }
      if (candidate.requestId !== requestId) return;
      if (candidate.kind === "error") {
        if (
          typeof candidate.message !== "string" ||
          candidate.message.length === 0
        ) {
          finish(() =>
            reject(
              new Error(
                "Friends Galaxy worker returned an invalid error response.",
              ),
            ),
          );
          return;
        }
        const message = candidate.message;
        finish(() => reject(new Error(message)));
        return;
      }
      if (candidate.kind !== "ready") {
        finish(() =>
          reject(
            new Error(
              "Friends Galaxy worker returned an unknown response kind.",
            ),
          ),
        );
        return;
      }
      const fixture = candidate.fixture as GalaxyLabFixture;
      const receipt = candidate.receipt as GalaxyLabFixtureWorkerReceipt;
      try {
        validateGalaxyLabFixtureEnvelope(fixture, receipt);
      } catch (error) {
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
        return;
      }
      finish(() =>
        resolve({
          fixture,
          receipt,
        }),
      );
    };
    worker.onerror = (event) => {
      finish(() =>
        reject(new Error(event.message || "Friends Galaxy worker failed.")),
      );
    };
    worker.onmessageerror = () => {
      finish(() =>
        reject(
          new Error("Friends Galaxy worker response could not be deserialized."),
        ),
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
