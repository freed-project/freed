import type { FriendsGalaxyInteractionRole } from "./friends-galaxy-scene-index.js";
import { FRIENDS_GALAXY_STAR_INSTANCE_FLOATS } from "./friends-galaxy-star-instances.js";

export function writeFriendsGalaxyInteractionInstances(
  target: Float32Array,
  semanticInstances: Float32Array,
  roles: ReadonlyMap<number, FriendsGalaxyInteractionRole>,
): number {
  target.fill(0);
  const capacity = Math.floor(target.length / FRIENDS_GALAXY_STAR_INSTANCE_FLOATS);
  let interactionCount = 0;
  for (const [nodeIndex, role] of roles) {
    if (interactionCount >= capacity) break;
    const sourceOffset = nodeIndex * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS;
    if (
      sourceOffset < 0 ||
      sourceOffset + FRIENDS_GALAXY_STAR_INSTANCE_FLOATS > semanticInstances.length
    ) {
      throw new Error(
        `Friends Galaxy interaction node ${nodeIndex.toLocaleString()} is outside the resident scene.`,
      );
    }
    const targetOffset = interactionCount * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS;
    for (
      let component = 0;
      component < FRIENDS_GALAXY_STAR_INSTANCE_FLOATS;
      component += 1
    ) {
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
