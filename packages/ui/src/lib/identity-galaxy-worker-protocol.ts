import type {
  BuildIdentityGraphAtlasInput,
  IdentityGraphAtlas,
} from "./identity-graph-atlas.js";
import type { IdentityGalaxyScene } from "./identity-galaxy-scene.js";

export interface IdentityGalaxyWorkerRequest extends BuildIdentityGraphAtlasInput {
  requestId: number;
}

export interface IdentityGalaxyWorkerResponse {
  requestId: number;
  atlas: IdentityGraphAtlas;
  scene: IdentityGalaxyScene;
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
