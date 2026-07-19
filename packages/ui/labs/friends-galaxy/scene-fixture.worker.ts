import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  compactGalaxyLabFixtureMetadata,
  galaxyLabFixtureTransferables,
  galaxyLabFixtureWorkerReceipt,
  type GalaxyLabFixtureWorkerRequest,
  type GalaxyLabFixtureWorkerResponse,
} from "./scene-fixture-worker-protocol.js";

interface GalaxyLabFixtureWorkerScope {
  onmessage:
    ((event: MessageEvent<GalaxyLabFixtureWorkerRequest>) => void) | null;
  postMessage(
    message: GalaxyLabFixtureWorkerResponse,
    transfer?: Transferable[],
  ): void;
}

const workerScope = self as unknown as GalaxyLabFixtureWorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind !== "build") return;
  try {
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture(request.options),
    );
    const transferables = galaxyLabFixtureTransferables(fixture);
    const response: GalaxyLabFixtureWorkerResponse = {
      kind: "ready",
      requestId: request.requestId,
      fixture,
      receipt: galaxyLabFixtureWorkerReceipt(fixture, transferables.length),
    };
    workerScope.postMessage(response, transferables);
  } catch (error) {
    const response: GalaxyLabFixtureWorkerResponse = {
      kind: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};

export {};
