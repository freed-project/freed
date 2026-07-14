import {
  buildIdentityGraphAtlasModel,
  sliceIdentityGraphAtlas,
  type IdentityGraphAtlasModel,
} from "./identity-graph-atlas.js";
import {
  compileIdentityGalaxyScene,
} from "./identity-galaxy-scene.js";
import {
  identityGalaxyWorkerResponseTransferables,
  type IdentityGalaxyWorkerRequest,
  type IdentityGalaxyWorkerResponse,
} from "./identity-galaxy-worker-protocol.js";

interface CachedGalaxyModel {
  sourceRevision: number;
  model: IdentityGraphAtlasModel;
}

let cachedGalaxy: CachedGalaxyModel | null = null;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

self.onmessage = (event: MessageEvent<IdentityGalaxyWorkerRequest>) => {
  const request = event.data;
  const startedAt = nowMs();
  let rebuilt = false;

  if (request.kind === "build") {
    const model = buildIdentityGraphAtlasModel(request.source);
    cachedGalaxy = {
      sourceRevision: request.sourceRevision,
      model,
    };
    rebuilt = true;
  }

  if (!cachedGalaxy || cachedGalaxy.sourceRevision !== request.sourceRevision) {
    throw new Error("Friends galaxy worker received a viewport request without its semantic model");
  }

  const atlas = sliceIdentityGraphAtlas({
    model: cachedGalaxy.model,
    ...request.viewport,
  });
  const response: IdentityGalaxyWorkerResponse = {
    requestId: request.requestId,
    sourceRevision: request.sourceRevision,
    atlas,
    durationMs: 0,
  };

  if (rebuilt) {
    response.scene = compileIdentityGalaxyScene({
      nodes: cachedGalaxy.model.nodes,
      edges: cachedGalaxy.model.edges,
    }, {
      quality: request.viewport.quality,
      selectedPersonId: request.viewport.selectedPersonId,
      selectedAccountId: request.viewport.selectedAccountId,
    });
  }

  response.durationMs = nowMs() - startedAt;
  self.postMessage(response, identityGalaxyWorkerResponseTransferables(response));
};

export {};
