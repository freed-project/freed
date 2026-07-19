import type { BuildIdentityGraphAtlasModelInput, IdentityGraphAtlas } from "./identity-graph-atlas.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import {
  friendsGalaxyRendererSceneTransferables,
  validateFriendsGalaxyWorkerScene,
  type FriendsGalaxyWorkerSceneReceipt,
} from "./friends-galaxy-worker-scene.js";
import {
  FRIENDS_GALAXY_PRESENTATION_NODE_CAP,
  validateFriendsGalaxyPresentationAtlas,
} from "./friends-galaxy-presentation-atlas.js";
import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";

export const FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION = 1 as const;

export interface FriendsGalaxyProductWorkerSelection {
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
}

export interface FriendsGalaxyProductWorkerViewport extends
  FriendsGalaxyProductWorkerSelection {
  width: number;
  height: number;
  transform: FriendsGalaxyTransform;
}

interface FriendsGalaxyProductWorkerRequestBase {
  protocolVersion: typeof FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION;
  requestId: number;
  sourceRevision: number;
}

export interface FriendsGalaxyProductWorkerSourceRequest extends
  FriendsGalaxyProductWorkerRequestBase {
  kind: "source";
  source: BuildIdentityGraphAtlasModelInput;
  viewport: Omit<FriendsGalaxyProductWorkerViewport, "transform">;
  backgroundStarCount?: number;
  backgroundSeed?: string;
}

export interface FriendsGalaxyProductWorkerPresentationRequest extends
  FriendsGalaxyProductWorkerRequestBase {
  kind: "presentation";
  presentationRevision: number;
  viewport: FriendsGalaxyProductWorkerViewport;
}

export type FriendsGalaxyProductWorkerRequest =
  | FriendsGalaxyProductWorkerSourceRequest
  | FriendsGalaxyProductWorkerPresentationRequest;

interface FriendsGalaxyProductWorkerResponseBase {
  protocolVersion: typeof FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION;
  requestId: number;
  sourceRevision: number;
  durationMs: number;
}

export interface FriendsGalaxyProductWorkerSourceResponse extends
  FriendsGalaxyProductWorkerResponseBase {
  kind: "source-ready";
  rendererScene: FriendsGalaxyRendererScene;
  receipt: FriendsGalaxyWorkerSceneReceipt;
}

export interface FriendsGalaxyProductWorkerPresentationResponse extends
  FriendsGalaxyProductWorkerResponseBase {
  kind: "presentation-ready";
  presentationRevision: number;
  atlas: IdentityGraphAtlas;
}

export interface FriendsGalaxyProductWorkerErrorResponse extends
  FriendsGalaxyProductWorkerResponseBase {
  kind: "error";
  requestKind: FriendsGalaxyProductWorkerRequest["kind"] | "unknown";
  message: string;
}

export type FriendsGalaxyProductWorkerResponse =
  | FriendsGalaxyProductWorkerSourceResponse
  | FriendsGalaxyProductWorkerPresentationResponse
  | FriendsGalaxyProductWorkerErrorResponse;

function assertEnvelopeInteger(label: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Friends Galaxy worker returned an invalid ${label}.`);
  }
}

function assertResponseBase(
  candidate: FriendsGalaxyProductWorkerResponse,
  request: FriendsGalaxyProductWorkerRequest,
): void {
  if (candidate.protocolVersion !== FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION) {
    throw new Error("Friends Galaxy worker returned an unsupported protocol version.");
  }
  assertEnvelopeInteger("request id", candidate.requestId);
  assertEnvelopeInteger("source revision", candidate.sourceRevision);
  if (
    candidate.requestId !== request.requestId ||
    candidate.sourceRevision !== request.sourceRevision
  ) {
    throw new Error("Friends Galaxy worker response does not match its request.");
  }
  if (!Number.isFinite(candidate.durationMs) || candidate.durationMs < 0) {
    throw new Error("Friends Galaxy worker returned an invalid duration.");
  }
}

export function friendsGalaxyProductWorkerResponseTransferables(
  response: FriendsGalaxyProductWorkerResponse,
): ArrayBuffer[] {
  return response.kind === "source-ready"
    ? friendsGalaxyRendererSceneTransferables(response.rendererScene)
    : [];
}

export function validateFriendsGalaxyProductWorkerResponse(
  candidate: unknown,
  request: FriendsGalaxyProductWorkerRequest,
  residentScene?: FriendsGalaxyRendererScene,
): asserts candidate is FriendsGalaxyProductWorkerResponse {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Friends Galaxy worker returned an invalid response.");
  }
  const response = candidate as FriendsGalaxyProductWorkerResponse;
  assertResponseBase(response, request);
  if (response.kind === "error") {
    if (
      typeof response.message !== "string" ||
      response.message.length === 0 ||
      response.message.length > 240
    ) {
      throw new Error("Friends Galaxy worker returned an invalid error response.");
    }
    if (response.requestKind !== request.kind) {
      throw new Error("Friends Galaxy worker error does not match its request lane.");
    }
    return;
  }
  if (request.kind === "source" && response.kind === "source-ready") {
    validateFriendsGalaxyWorkerScene(
      response.rendererScene,
      response.receipt,
      { metadataNodeCap: FRIENDS_GALAXY_PRESENTATION_NODE_CAP },
    );
    if (response.rendererScene.presentationCandidateSource !== "atlas") {
      throw new Error("Friends Galaxy product scene must use worker presentation candidates.");
    }
    return;
  }
  if (request.kind === "presentation" && response.kind === "presentation-ready") {
    assertEnvelopeInteger("presentation revision", response.presentationRevision);
    if (response.presentationRevision !== request.presentationRevision || !residentScene) {
      throw new Error("Friends Galaxy presentation response does not match its request.");
    }
    validateFriendsGalaxyPresentationAtlas(
      response.atlas,
      residentScene.scene,
      residentScene.interactionIndex,
    );
    return;
  }
  throw new Error("Friends Galaxy worker returned the wrong response lane.");
}
