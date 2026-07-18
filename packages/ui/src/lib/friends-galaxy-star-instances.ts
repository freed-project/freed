import {
  IdentityGalaxyNodeKindCode,
  type IdentityGalaxyScene,
} from "./identity-galaxy-scene.js";

export const FRIENDS_GALAXY_STAR_INSTANCE_FLOATS = 8;

export const FriendsGalaxyStarColorRole = {
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

export const FRIENDS_GALAXY_STAR_PALETTE_ROLE_COUNT = 11;

export interface FriendsGalaxyPackedStarInstances {
  semantic: Float32Array;
  background: Float32Array;
}

export interface FriendsGalaxyPackedStarInstanceInput {
  scene: IdentityGalaxyScene;
  backgroundPositions: Float32Array;
  backgroundBrightness: Float32Array;
}

function semanticColorRole(scene: IdentityGalaxyScene, index: number): number {
  switch (scene.providers[index]) {
    case "instagram": return FriendsGalaxyStarColorRole.Instagram;
    case "facebook": return FriendsGalaxyStarColorRole.Facebook;
    case "linkedin": return FriendsGalaxyStarColorRole.LinkedIn;
    case "x": return FriendsGalaxyStarColorRole.X;
    case "rss": return FriendsGalaxyStarColorRole.Rss;
    default:
      break;
  }
  switch (scene.kinds[index]) {
    case IdentityGalaxyNodeKindCode.FriendPerson:
      return FriendsGalaxyStarColorRole.Friend;
    case IdentityGalaxyNodeKindCode.ConnectionPerson:
      return FriendsGalaxyStarColorRole.Connection;
    case IdentityGalaxyNodeKindCode.Feed:
      return FriendsGalaxyStarColorRole.Feed;
    default:
      return FriendsGalaxyStarColorRole.Account;
  }
}

export function createFriendsGalaxyPackedStarInstances({
  scene,
  backgroundPositions,
  backgroundBrightness,
}: FriendsGalaxyPackedStarInstanceInput): FriendsGalaxyPackedStarInstances {
  if (backgroundPositions.length !== backgroundBrightness.length * 3) {
    throw new Error("Friends Galaxy background positions and brightness lengths do not match.");
  }
  const semantic = new Float32Array(
    scene.nodeIds.length * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
  );
  for (let index = 0; index < scene.nodeIds.length; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS;
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
    backgroundBrightness.length * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
  );
  for (let index = 0; index < backgroundBrightness.length; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS;
    background[targetOffset] = backgroundPositions[sourceOffset]!;
    background[targetOffset + 1] = backgroundPositions[sourceOffset + 1]!;
    background[targetOffset + 2] = backgroundPositions[sourceOffset + 2]!;
    background[targetOffset + 3] = 0.42 + backgroundBrightness[index]! * 1.08;
    background[targetOffset + 4] = backgroundBrightness[index]! * 0.72;
    background[targetOffset + 5] = FriendsGalaxyStarColorRole.Background;
    background[targetOffset + 6] = 0;
    background[targetOffset + 7] = 1;
  }
  return { semantic, background };
}
