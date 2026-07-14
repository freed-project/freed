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
