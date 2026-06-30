import {
  buildIdentityGraphAtlas,
  type BuildIdentityGraphAtlasInput,
  type IdentityGraphAtlas,
} from "./identity-graph-atlas.js";

interface AtlasRequest extends BuildIdentityGraphAtlasInput {
  requestId: number;
}

interface AtlasResponse {
  requestId: number;
  atlas: IdentityGraphAtlas;
  durationMs: number;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

self.onmessage = (event: MessageEvent<AtlasRequest>) => {
  const startedAt = nowMs();
  const atlas = buildIdentityGraphAtlas(event.data);
  const response: AtlasResponse = {
    requestId: event.data.requestId,
    atlas,
    durationMs: nowMs() - startedAt,
  };
  self.postMessage(response);
};

export {};
