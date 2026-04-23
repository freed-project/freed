import {
  buildIdentityGraphLayout,
  type GraphLayoutQuality,
  type IdentityGraphLayout,
} from "./identity-graph-layout.js";
import type { IdentityGraphModel } from "./identity-graph-model.js";

interface LayoutRequest {
  requestId: number;
  model: IdentityGraphModel;
  width: number;
  height: number;
  quality?: GraphLayoutQuality;
}

interface LayoutResponse {
  requestId: number;
  layout: IdentityGraphLayout;
  durationMs: number;
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const startMs =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const layout = buildIdentityGraphLayout({
    model: event.data.model,
    width: event.data.width,
    height: event.data.height,
    quality: event.data.quality,
  });
  const durationMs =
    (typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now()) - startMs;

  const response: LayoutResponse = {
    requestId: event.data.requestId,
    layout,
    durationMs,
  };
  self.postMessage(response);
};

export {};
