import {
  buildIdentityGraphAtlasModel,
  fitTransformToAtlasBounds,
  sliceIdentityGraphAtlas,
  type IdentityGraphAtlasModel,
} from "./identity-graph-atlas.js";
import {
  FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP,
  FriendsGalaxyActivityScenePatchEncoder,
  type FriendsGalaxyActivitySceneBinding,
} from "./friends-galaxy-activity-patches.js";
import { FRIENDS_GALAXY_PRESENTATION_NODE_CAP } from "./friends-galaxy-presentation-atlas.js";
import { compileFriendsGalaxyProductRendererScene } from "./friends-galaxy-product-scene.js";
import {
  compactFriendsGalaxyPresentationMetadata,
  includeFriendsGalaxyPriorityMetadata,
} from "./friends-galaxy-renderer-scene.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  type FriendsGalaxyProductWorkerActivityRequest,
  type FriendsGalaxyProductWorkerActivityResponse,
  type FriendsGalaxyProductWorkerErrorResponse,
  type FriendsGalaxyProductWorkerPresentationRequest,
  type FriendsGalaxyProductWorkerPresentationResponse,
  type FriendsGalaxyProductWorkerRequest,
  type FriendsGalaxyProductWorkerResponse,
  type FriendsGalaxyProductWorkerSourceRequest,
  type FriendsGalaxyProductWorkerSourceResponse,
} from "./friends-galaxy-product-worker-protocol.js";
import { friendsGalaxyWorkerSceneReceipt } from "./friends-galaxy-worker-scene.js";
import { socialActivitySummaryKey } from "./identity-graph-activity-summary.js";

export const FRIENDS_GALAXY_PRODUCT_LAYOUT_WIDTH = 1_400;
export const FRIENDS_GALAXY_PRODUCT_LAYOUT_HEIGHT = 900;

interface CachedFriendsGalaxyProductSource {
  sourceRevision: number;
  model: IdentityGraphAtlasModel;
  semanticNodeCount: number;
  linkedPersonNodeIdByAccountId: Map<string, string>;
  metadataByNodeId: Map<string, IdentityGraphAtlasModel["nodes"][number]>;
  activityEncoder: FriendsGalaxyActivityScenePatchEncoder;
}

interface FriendsGalaxyProductSourceIndexes {
  linkedPersonNodeIdByAccountId: Map<string, string>;
  metadataByNodeId: Map<string, IdentityGraphAtlasModel["nodes"][number]>;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function requestInteger(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid Friends Galaxy ${label}.`);
  }
  return value;
}

function viewportDimension(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid Friends Galaxy ${label}.`);
  }
  return value;
}

function priorityNodeIds(
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
  linkedPersonNodeIdByAccountId: ReadonlyMap<string, string>,
): string[] {
  const nodeIds: string[] = [];
  if (selectedPersonId) nodeIds.push(`person:${selectedPersonId}`);
  if (selectedAccountId) {
    nodeIds.push(`account:${selectedAccountId}`);
    const linkedPersonNodeId = linkedPersonNodeIdByAccountId.get(selectedAccountId);
    if (linkedPersonNodeId) {
      if (!nodeIds.includes(linkedPersonNodeId)) nodeIds.push(linkedPersonNodeId);
    }
  }
  return nodeIds;
}

function productSourceIndexes(
  model: IdentityGraphAtlasModel,
): FriendsGalaxyProductSourceIndexes {
  const linkedPersonNodeIdByAccountId = new Map<string, string>();
  const metadataByNodeId = new Map<
    string,
    IdentityGraphAtlasModel["nodes"][number]
  >();
  for (const node of model.nodes) {
    metadataByNodeId.set(node.id, node);
    if (node.accountId && node.linkedPersonId) {
      linkedPersonNodeIdByAccountId.set(
        node.accountId,
        `person:${node.linkedPersonId}`,
      );
    }
  }
  return { linkedPersonNodeIdByAccountId, metadataByNodeId };
}

function productActivityBindings(
  request: FriendsGalaxyProductWorkerSourceRequest,
  rendererScene: ReturnType<typeof compileFriendsGalaxyProductRendererScene>,
): FriendsGalaxyActivitySceneBinding[] {
  const bindings: FriendsGalaxyActivitySceneBinding[] = [];
  for (
    let nodeIndex = 0;
    nodeIndex < rendererScene.scene.nodeIds.length;
    nodeIndex += 1
  ) {
    const nodeId = rendererScene.scene.nodeIds[nodeIndex]!;
    if (nodeId.startsWith("account:")) {
      const account = request.source.accounts[nodeId.slice("account:".length)];
      if (!account?.provider || !account.externalId) continue;
      bindings.push({
        namespace: "social",
        key: socialActivitySummaryKey(account.provider, account.externalId),
        nodeIndex,
      });
      continue;
    }
    if (nodeId.startsWith("feed:")) {
      bindings.push({
        namespace: "rss",
        key: nodeId.slice("feed:".length),
        nodeIndex,
      });
    }
  }
  return bindings;
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const characters = Array.from(message.trim() || "Friends Galaxy worker failed.");
  return characters.slice(0, 240).join("");
}

export class FriendsGalaxyProductWorkerService {
  private cached: CachedFriendsGalaxyProductSource | null = null;

  handle(request: FriendsGalaxyProductWorkerRequest): FriendsGalaxyProductWorkerResponse {
    const startedAt = nowMs();
    try {
      if (request.protocolVersion !== FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION) {
        throw new Error("Unsupported Friends Galaxy worker protocol version.");
      }
      requestInteger("request id", request.requestId);
      requestInteger("source revision", request.sourceRevision);
      if (request.kind === "source") return this.buildSource(request, startedAt);
      if (request.kind === "presentation") return this.buildPresentation(request, startedAt);
      if (request.kind === "activity") return this.buildActivity(request, startedAt);
      throw new Error("Unknown Friends Galaxy worker request.");
    } catch (error) {
      const response: FriendsGalaxyProductWorkerErrorResponse = {
        kind: "error",
        protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
        requestId: Number.isSafeInteger(request?.requestId) ? request.requestId : 0,
        sourceRevision: Number.isSafeInteger(request?.sourceRevision)
          ? request.sourceRevision
          : 0,
        requestKind: request?.kind === "source" ||
          request?.kind === "presentation" ||
          request?.kind === "activity"
          ? request.kind
          : "unknown",
        durationMs: Math.max(0, nowMs() - startedAt),
        message: boundedErrorMessage(error),
      };
      return response;
    }
  }

  private buildSource(
    request: FriendsGalaxyProductWorkerSourceRequest,
    startedAt: number,
  ): FriendsGalaxyProductWorkerSourceResponse {
    const width = viewportDimension("viewport width", request.viewport.width);
    const height = viewportDimension("viewport height", request.viewport.height);
    const model = buildIdentityGraphAtlasModel({
      ...request.source,
      width: FRIENDS_GALAXY_PRODUCT_LAYOUT_WIDTH,
      height: FRIENDS_GALAXY_PRODUCT_LAYOUT_HEIGHT,
    });
    const initialTransform = fitTransformToAtlasBounds(model.bounds, width, height, 96);
    const atlas = sliceIdentityGraphAtlas({
      model,
      transform: initialTransform,
      width,
      height,
      quality: "settled",
      selectedPersonId: request.viewport.selectedPersonId,
      selectedAccountId: request.viewport.selectedAccountId,
    });
    const rendererScene = compileFriendsGalaxyProductRendererScene({
      atlas,
      source: model,
      selectedPersonId: request.viewport.selectedPersonId,
      selectedAccountId: request.viewport.selectedAccountId,
      backgroundStarCount: request.backgroundStarCount,
      backgroundSeed: request.backgroundSeed,
    });
    const sourceIndexes = productSourceIndexes(model);
    const activityEncoder = new FriendsGalaxyActivityScenePatchEncoder(
      productActivityBindings(request, rendererScene),
    );
    this.cached = {
      sourceRevision: request.sourceRevision,
      model,
      semanticNodeCount: rendererScene.scene.nodeIds.length,
      ...sourceIndexes,
      activityEncoder,
    };
    return {
      kind: "source-ready",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      sourceRevision: request.sourceRevision,
      rendererScene,
      receipt: friendsGalaxyWorkerSceneReceipt(rendererScene),
      durationMs: Math.max(0, nowMs() - startedAt),
    };
  }

  private buildPresentation(
    request: FriendsGalaxyProductWorkerPresentationRequest,
    startedAt: number,
  ): FriendsGalaxyProductWorkerPresentationResponse {
    requestInteger("presentation revision", request.presentationRevision);
    const cached = this.cached;
    if (!cached || cached.sourceRevision !== request.sourceRevision) {
      throw new Error("Friends Galaxy presentation requested without its source revision.");
    }
    const priorityIds = priorityNodeIds(
      request.viewport.selectedPersonId,
      request.viewport.selectedAccountId,
      cached.linkedPersonNodeIdByAccountId,
    );
    const atlas = compactFriendsGalaxyPresentationMetadata(
      includeFriendsGalaxyPriorityMetadata(
        sliceIdentityGraphAtlas({
          model: cached.model,
          transform: request.viewport.transform,
          width: viewportDimension("viewport width", request.viewport.width),
          height: viewportDimension("viewport height", request.viewport.height),
          quality: "settled",
          selectedPersonId: request.viewport.selectedPersonId,
          selectedAccountId: request.viewport.selectedAccountId,
        }),
        cached.metadataByNodeId,
        priorityIds,
      ),
      cached.semanticNodeCount,
      FRIENDS_GALAXY_PRESENTATION_NODE_CAP,
      priorityIds,
    );
    return {
      kind: "presentation-ready",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      sourceRevision: request.sourceRevision,
      presentationRevision: request.presentationRevision,
      atlas,
      durationMs: Math.max(0, nowMs() - startedAt),
    };
  }

  private buildActivity(
    request: FriendsGalaxyProductWorkerActivityRequest,
    startedAt: number,
  ): FriendsGalaxyProductWorkerActivityResponse {
    requestInteger("activity revision", request.activityRevision);
    if (!Number.isFinite(request.referenceTime) || request.referenceTime < 0) {
      throw new Error("Friends Galaxy activity requested with an invalid reference time.");
    }
    if (
      !Array.isArray(request.patches) ||
      request.patches.length > FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP
    ) {
      throw new Error("Friends Galaxy activity requested with invalid patches.");
    }
    const cached = this.cached;
    if (!cached || cached.sourceRevision !== request.sourceRevision) {
      throw new Error("Friends Galaxy activity requested without its source revision.");
    }
    return {
      kind: "activity-ready",
      protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      sourceRevision: request.sourceRevision,
      activityRevision: request.activityRevision,
      scenePatches: cached.activityEncoder.encode(
        request.patches,
        request.activityRevision,
        request.referenceTime,
      ),
      durationMs: Math.max(0, nowMs() - startedAt),
    };
  }
}
