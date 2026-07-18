import type { GalaxyLabInteractionRole } from "./scene-index.js";
import { GALAXY_LAB_STAR_INSTANCE_FLOATS } from "./star-instance-data.js";

export function writeGalaxyLabInteractionInstances(
  target: Float32Array,
  semanticInstances: Float32Array,
  roles: ReadonlyMap<number, GalaxyLabInteractionRole>,
): number {
  target.fill(0);
  const capacity = Math.floor(target.length / GALAXY_LAB_STAR_INSTANCE_FLOATS);
  let interactionCount = 0;
  for (const [nodeIndex, role] of roles) {
    if (interactionCount >= capacity) break;
    const sourceOffset = nodeIndex * GALAXY_LAB_STAR_INSTANCE_FLOATS;
    if (
      sourceOffset < 0 ||
      sourceOffset + GALAXY_LAB_STAR_INSTANCE_FLOATS > semanticInstances.length
    ) {
      throw new Error(
        `Friends Galaxy interaction node ${nodeIndex.toLocaleString()} is outside the resident scene.`,
      );
    }
    const targetOffset = interactionCount * GALAXY_LAB_STAR_INSTANCE_FLOATS;
    for (let component = 0; component < GALAXY_LAB_STAR_INSTANCE_FLOATS; component += 1) {
      target[targetOffset + component] = semanticInstances[sourceOffset + component]!;
    }
    target[targetOffset + 3] *= role === "selected"
      ? 1.58
      : role === "hovered" ? 1.36 : 1.16;
    target[targetOffset + 6] = role === "linked" ? 0.62 : 1;
    target[targetOffset + 7] = 1;
    interactionCount += 1;
  }
  return interactionCount;
}
