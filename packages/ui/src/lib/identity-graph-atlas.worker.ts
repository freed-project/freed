import {
  buildIdentityGraphAtlas,
} from "./identity-graph-atlas.js";
import { compileIdentityGalaxyScene } from "./identity-galaxy-scene.js";
import {
  identityGalaxySceneTransferables,
  type IdentityGalaxyWorkerRequest,
  type IdentityGalaxyWorkerResponse,
} from "./identity-galaxy-worker-protocol.js";

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

self.onmessage = (event: MessageEvent<IdentityGalaxyWorkerRequest>) => {
  const startedAt = nowMs();
  const atlas = buildIdentityGraphAtlas(event.data);
  const scene = compileIdentityGalaxyScene(atlas, {
    quality: event.data.quality,
    selectedPersonId: event.data.selectedPersonId,
    selectedAccountId: event.data.selectedAccountId,
  });
  const response: IdentityGalaxyWorkerResponse = {
    requestId: event.data.requestId,
    atlas,
    scene,
    durationMs: nowMs() - startedAt,
  };
  self.postMessage(response, identityGalaxySceneTransferables(scene));
};

export {};
