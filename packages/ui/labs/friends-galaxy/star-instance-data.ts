import {
  IdentityGalaxyNodeKindCode,
  type IdentityGalaxyScene,
} from "../../src/lib/identity-galaxy-scene.js";

export const GALAXY_LAB_STAR_INSTANCE_FLOATS = 8;

export const GalaxyLabStarColorRole = {
  Friend: 0,
  Connection: 1,
  Account: 2,
  Feed: 3,
  Instagram: 4,
  Facebook: 5,
  LinkedIn: 6,
  X: 7,
  Rss: 8,
  Background: 9,
  Selection: 10,
} as const;

export const GALAXY_LAB_STAR_PALETTE_ROLE_COUNT = 11;

export interface GalaxyLabPackedStarInstances {
  semantic: Float32Array;
  background: Float32Array;
}

export interface GalaxyLabPackedStarInstanceInput {
  scene: IdentityGalaxyScene;
  backgroundPositions: Float32Array;
  backgroundBrightness: Float32Array;
}

function semanticColorRole(scene: IdentityGalaxyScene, index: number): number {
  switch (scene.providers[index]) {
    case "instagram": return GalaxyLabStarColorRole.Instagram;
    case "facebook": return GalaxyLabStarColorRole.Facebook;
    case "linkedin": return GalaxyLabStarColorRole.LinkedIn;
    case "x": return GalaxyLabStarColorRole.X;
    case "rss": return GalaxyLabStarColorRole.Rss;
    default:
      break;
  }
  switch (scene.kinds[index]) {
    case IdentityGalaxyNodeKindCode.FriendPerson:
      return GalaxyLabStarColorRole.Friend;
    case IdentityGalaxyNodeKindCode.ConnectionPerson:
      return GalaxyLabStarColorRole.Connection;
    case IdentityGalaxyNodeKindCode.Feed:
      return GalaxyLabStarColorRole.Feed;
    default:
      return GalaxyLabStarColorRole.Account;
  }
}

export function createGalaxyLabPackedStarInstances({
  scene,
  backgroundPositions,
  backgroundBrightness,
}: GalaxyLabPackedStarInstanceInput): GalaxyLabPackedStarInstances {
  if (backgroundPositions.length !== backgroundBrightness.length * 3) {
    throw new Error("Friends Galaxy background positions and brightness lengths do not match.");
  }
  const semantic = new Float32Array(scene.nodeIds.length * GALAXY_LAB_STAR_INSTANCE_FLOATS);
  for (let index = 0; index < scene.nodeIds.length; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * GALAXY_LAB_STAR_INSTANCE_FLOATS;
    semantic[targetOffset] = scene.positions[sourceOffset]!;
    semantic[targetOffset + 1] = scene.positions[sourceOffset + 1]!;
    semantic[targetOffset + 2] = scene.positions[sourceOffset + 2]!;
    semantic[targetOffset + 3] = Math.max(4.5, scene.pointSizes[index]! * 0.42);
    semantic[targetOffset + 4] = scene.brightness[index]!;
    semantic[targetOffset + 5] = semanticColorRole(scene, index);
    semantic[targetOffset + 6] = 0;
    semantic[targetOffset + 7] = 1;
  }

  const background = new Float32Array(
    backgroundBrightness.length * GALAXY_LAB_STAR_INSTANCE_FLOATS,
  );
  for (let index = 0; index < backgroundBrightness.length; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * GALAXY_LAB_STAR_INSTANCE_FLOATS;
    background[targetOffset] = backgroundPositions[sourceOffset]!;
    background[targetOffset + 1] = backgroundPositions[sourceOffset + 1]!;
    background[targetOffset + 2] = backgroundPositions[sourceOffset + 2]!;
    background[targetOffset + 3] = 0.42 + backgroundBrightness[index]! * 1.08;
    background[targetOffset + 4] = backgroundBrightness[index]! * 0.72;
    background[targetOffset + 5] = GalaxyLabStarColorRole.Background;
    background[targetOffset + 6] = 0;
    background[targetOffset + 7] = 1;
  }
  return { semantic, background };
}
