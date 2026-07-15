import type {
  BuildIdentityGraphAtlasInput,
  BuildIdentityGraphAtlasModelInput,
  IdentityGraphAtlas,
} from "./identity-graph-atlas.js";
import type { IdentityGalaxyScene } from "./identity-galaxy-scene.js";

export type IdentityGalaxyWorkerViewportInput = Pick<
  BuildIdentityGraphAtlasInput,
  "transform" | "width" | "height" | "quality" | "selectedPersonId" | "selectedAccountId"
>;

export type IdentityGalaxyWorkerSelection = Pick<
  IdentityGalaxyWorkerViewportInput,
  "selectedPersonId" | "selectedAccountId"
>;

export function identityGalaxyWorkerSelectionsMatch(
  left: IdentityGalaxyWorkerSelection,
  right: IdentityGalaxyWorkerSelection,
): boolean {
  return (left.selectedPersonId ?? null) === (right.selectedPersonId ?? null) &&
    (left.selectedAccountId ?? null) === (right.selectedAccountId ?? null);
}

export function shouldReconcileIdentityGalaxyWorkerSelection(
  requestSelection: IdentityGalaxyWorkerSelection,
  currentSelection: IdentityGalaxyWorkerSelection,
): boolean {
  return !identityGalaxyWorkerSelectionsMatch(requestSelection, currentSelection);
}

export function shouldRequestIdentityGalaxyWorkerSelection(
  latestRequestSelection: IdentityGalaxyWorkerSelection | undefined,
  currentSelection: IdentityGalaxyWorkerSelection,
): boolean {
  return !latestRequestSelection ||
    !identityGalaxyWorkerSelectionsMatch(latestRequestSelection, currentSelection);
}

export type IdentityGalaxyWorkerResponseDisposition = "apply" | "ignore" | "reconcile";

export function identityGalaxyWorkerResponseDisposition(
  requestId: number,
  latestResolvedRequestId: number,
  requestSelection: IdentityGalaxyWorkerSelection | undefined,
  currentSelection: IdentityGalaxyWorkerSelection,
): IdentityGalaxyWorkerResponseDisposition {
  if (requestId <= latestResolvedRequestId) return "ignore";
  if (
    requestSelection &&
    shouldReconcileIdentityGalaxyWorkerSelection(requestSelection, currentSelection)
  ) {
    return "reconcile";
  }
  return "apply";
}

interface IdentityGalaxyWorkerRequestBase {
  requestId: number;
  sourceRevision: number;
  viewport: IdentityGalaxyWorkerViewportInput;
}

export interface IdentityGalaxyWorkerBuildRequest extends IdentityGalaxyWorkerRequestBase {
  kind: "build";
  source: BuildIdentityGraphAtlasModelInput;
}

export interface IdentityGalaxyWorkerViewportRequest extends IdentityGalaxyWorkerRequestBase {
  kind: "viewport";
}

export type IdentityGalaxyWorkerRequest =
  | IdentityGalaxyWorkerBuildRequest
  | IdentityGalaxyWorkerViewportRequest;

export interface IdentityGalaxyWorkerResponse {
  requestId: number;
  sourceRevision: number;
  atlas: IdentityGraphAtlas;
  scene?: IdentityGalaxyScene;
  edgeIndices?: Uint32Array;
  durationMs: number;
}

export function identityGalaxySceneTransferables(
  scene: IdentityGalaxyScene,
): ArrayBuffer[] {
  const buffers = [
    scene.kinds.buffer,
    scene.colorRoles.buffer,
    scene.flags.buffer,
    scene.positions.buffer,
    scene.radii.buffer,
    scene.pointSizes.buffer,
    scene.prominence.buffer,
    scene.brightness.buffer,
    scene.emphasis.buffer,
    scene.edgeIndices.buffer,
  ];
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return [...unique];
}

export function identityGalaxyWorkerResponseTransferables(
  response: IdentityGalaxyWorkerResponse,
): ArrayBuffer[] {
  if (response.scene) return identityGalaxySceneTransferables(response.scene);
  if (response.edgeIndices?.buffer instanceof ArrayBuffer) return [response.edgeIndices.buffer];
  return [];
}
