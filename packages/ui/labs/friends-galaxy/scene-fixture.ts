import {
  IdentityGalaxyColorRole,
  IdentityGalaxyNodeFlag,
  IdentityGalaxyNodeKindCode,
  IDENTITY_GALAXY_SCENE_VERSION,
  type IdentityGalaxyScene,
} from "../../src/lib/identity-galaxy-scene.js";
import {
  providerGalaxyArmCount,
  providerGalaxyLocalPoint,
} from "../../src/lib/identity-galaxy-provider-field.js";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasEdge,
  IdentityGraphAtlasLabel,
  IdentityGraphAtlasNode,
  IdentityGraphAtlasRegion,
} from "../../src/lib/identity-graph-atlas.js";

export const GALAXY_LAB_PROVIDERS = ["instagram", "facebook", "linkedin", "x", "rss"] as const;

export type GalaxyLabProvider = (typeof GALAXY_LAB_PROVIDERS)[number];
export type GalaxyLabThemeId = "scriptorium" | "neon" | "midas" | "vesper";

export interface GalaxyLabPalette {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  friend: string;
  connection: string;
  account: string;
  feed: string;
  selection: string;
  providers: Record<GalaxyLabProvider, string>;
}

export interface GalaxyLabFixtureOptions {
  personCount: number;
  accountCount: number;
  backgroundStarCount: number;
}

export interface GalaxyLabFixture {
  atlas: IdentityGraphAtlas;
  scene: IdentityGalaxyScene;
  backgroundPositions: Float32Array;
  backgroundBrightness: Float32Array;
  personCount: number;
  accountCount: number;
  linkedAccountCount: number;
  backgroundStarCount: number;
  buildMs: number;
}

export interface GalaxyLabTransform {
  x: number;
  y: number;
  scale: number;
}

export const GALAXY_LAB_THEMES: Record<GalaxyLabThemeId, GalaxyLabPalette> = {
  scriptorium: {
    background: "#f2e5cc",
    surface: "#f8efdc",
    text: "#302218",
    mutedText: "#745f4d",
    friend: "#735336",
    connection: "#477c86",
    account: "#a7794b",
    feed: "#b34f68",
    selection: "#237da0",
    providers: {
      instagram: "#c64f85",
      facebook: "#3d72c4",
      linkedin: "#2d7d9d",
      x: "#59636b",
      rss: "#d1842d",
    },
  },
  neon: {
    background: "#07090d",
    surface: "#11151d",
    text: "#f6fbff",
    mutedText: "#a2b1c1",
    friend: "#6df2d0",
    connection: "#f7d66d",
    account: "#9ac4ff",
    feed: "#ff77a9",
    selection: "#ffffff",
    providers: {
      instagram: "#ff5ea8",
      facebook: "#70a2ff",
      linkedin: "#49d4f2",
      x: "#d4dee8",
      rss: "#ffbd62",
    },
  },
  midas: {
    background: "#11100d",
    surface: "#1d1a13",
    text: "#fff8de",
    mutedText: "#c8b991",
    friend: "#f4d36b",
    connection: "#83c5be",
    account: "#d7a95e",
    feed: "#e7786f",
    selection: "#fff2a8",
    providers: {
      instagram: "#e77da7",
      facebook: "#75a7e8",
      linkedin: "#5eb7c8",
      x: "#cbc6b8",
      rss: "#f0a44a",
    },
  },
  vesper: {
    background: "#15131a",
    surface: "#211e27",
    text: "#f5f0f7",
    mutedText: "#b7acbd",
    friend: "#e7a8bf",
    connection: "#8bc5bd",
    account: "#b8a5d5",
    feed: "#ee9a78",
    selection: "#f8d7e5",
    providers: {
      instagram: "#e68eb3",
      facebook: "#8aa9e8",
      linkedin: "#72b9c6",
      x: "#c8c3cf",
      rss: "#e7a45f",
    },
  },
};

export function galaxyLabSemanticColor(
  fixture: GalaxyLabFixture,
  palette: GalaxyLabPalette,
  index: number,
): string {
  const provider = fixture.scene.providers[index] as GalaxyLabProvider | null | undefined;
  if (provider && provider in palette.providers) return palette.providers[provider];
  const kind = fixture.scene.kinds[index];
  if (kind === IdentityGalaxyNodeKindCode.FriendPerson) return palette.friend;
  if (kind === IdentityGalaxyNodeKindCode.ConnectionPerson) return palette.connection;
  if (kind === IdentityGalaxyNodeKindCode.Feed) return palette.feed;
  return palette.account;
}

const PERSON_FIELD_RADIUS = 1_680;
const PERSON_ARM_COUNT = 6;
const PROVIDER_RING_RADIUS = 3_080;
const PROVIDER_FIELD_RADIUS_X = 540;
const PROVIDER_FIELD_RADIUS_Y = 390;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashValue(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(value: string): number {
  return hashValue(value) / 0xffff_ffff;
}

function providerCenter(providerIndex: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + providerIndex * (Math.PI * 2 / GALAXY_LAB_PROVIDERS.length);
  return {
    x: Math.cos(angle) * PROVIDER_RING_RADIUS,
    y: Math.sin(angle) * PROVIDER_RING_RADIUS * 0.78,
  };
}

function providerFieldPoint(provider: GalaxyLabProvider, index: number, count: number): { x: number; y: number } {
  const providerIndex = GALAXY_LAB_PROVIDERS.indexOf(provider);
  const center = providerCenter(providerIndex);
  const armCount = providerGalaxyArmCount(provider);
  const armIndex = index % armCount;
  const indexInArm = Math.floor(index / armCount);
  const armPopulation = Math.max(1, Math.ceil((Math.max(1, count) - armIndex) / armCount));
  const progress = (indexInArm + 0.42) / (armPopulation + 0.42);
  const angularJitter = (seededUnit(`${provider}:${index}:angle`) - 0.5) *
    (0.18 + progress * 0.18);
  const radialJitter = (seededUnit(`${provider}:${index}:radius`) - 0.5) * 0.075;
  const point = providerGalaxyLocalPoint(
    provider,
    armIndex,
    clamp(progress + radialJitter, 0.012, 0.988),
    PROVIDER_FIELD_RADIUS_X,
    PROVIDER_FIELD_RADIUS_Y,
    angularJitter,
  );
  const scatter = 12 + progress * 34;
  return {
    x: center.x + point.x + (seededUnit(`${provider}:${index}:x`) - 0.5) * scatter,
    y: center.y + point.y + (seededUnit(`${provider}:${index}:y`) - 0.5) * scatter * 0.72,
  };
}

function boundsForScene(positions: Float32Array): IdentityGalaxyScene["bounds"] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < positions.length; offset += 3) {
    minX = Math.min(minX, positions[offset]!);
    maxX = Math.max(maxX, positions[offset]!);
    minY = Math.min(minY, positions[offset + 1]!);
    maxY = Math.max(maxY, positions[offset + 1]!);
    minZ = Math.min(minZ, positions[offset + 2]!);
    maxZ = Math.max(maxZ, positions[offset + 2]!);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function buildRegions(accountCount: number, linkedAccountCount: number): IdentityGraphAtlasRegion[] {
  return GALAXY_LAB_PROVIDERS.map((provider, providerIndex) => {
    const center = providerCenter(providerIndex);
    const providerAccounts = Math.floor(accountCount / GALAXY_LAB_PROVIDERS.length) +
      (providerIndex < accountCount % GALAXY_LAB_PROVIDERS.length ? 1 : 0);
    const providerLinked = Math.floor(linkedAccountCount / GALAXY_LAB_PROVIDERS.length) +
      (providerIndex < linkedAccountCount % GALAXY_LAB_PROVIDERS.length ? 1 : 0);
    return {
      id: `lab-region:${provider}`,
      provider,
      label: provider === "rss" ? "RSS" : provider === "x" ? "X" : `${provider[0]!.toUpperCase()}${provider.slice(1)}`,
      x: center.x,
      y: center.y,
      radiusX: PROVIDER_FIELD_RADIUS_X + 90,
      radiusY: PROVIDER_FIELD_RADIUS_Y + 70,
      count: providerAccounts,
      linkedCount: providerLinked,
      unlinkedCount: providerAccounts - providerLinked,
    };
  });
}

export function createGalaxyLabFixture({
  personCount,
  accountCount,
  backgroundStarCount,
}: GalaxyLabFixtureOptions): GalaxyLabFixture {
  const startedAt = nowMs();
  const safePersonCount = Math.max(1, Math.floor(personCount));
  const safeAccountCount = Math.max(0, Math.floor(accountCount));
  const safeBackgroundCount = Math.max(0, Math.floor(backgroundStarCount));
  const semanticCount = safePersonCount + safeAccountCount;
  const linkedAccountCount = Math.min(safeAccountCount, safePersonCount * 4);
  const unlinkedAccountCount = safeAccountCount - linkedAccountCount;
  const nodeIds = new Array<string>(semanticCount);
  const personIds = new Array<string | null>(semanticCount).fill(null);
  const accountIds = new Array<string | null>(semanticCount).fill(null);
  const linkedPersonIds = new Array<string | null>(semanticCount).fill(null);
  const providers = new Array<string | null>(semanticCount).fill(null);
  const kinds = new Uint8Array(semanticCount);
  const colorRoles = new Uint8Array(semanticCount);
  const flags = new Uint16Array(semanticCount);
  const positions = new Float32Array(semanticCount * 3);
  const radii = new Float32Array(semanticCount);
  const pointSizes = new Float32Array(semanticCount);
  const prominence = new Float32Array(semanticCount);
  const brightness = new Float32Array(semanticCount);
  const emphasis = new Float32Array(semanticCount);
  const atlasNodes = new Array<IdentityGraphAtlasNode>(semanticCount);
  const edges = new Array<IdentityGraphAtlasEdge>(linkedAccountCount);
  const edgeIndices = new Uint32Array(linkedAccountCount * 2);
  const personX = new Float32Array(safePersonCount);
  const personY = new Float32Array(safePersonCount);
  const personZ = new Float32Array(safePersonCount);

  for (let index = 0; index < safePersonCount; index += 1) {
    const id = `lab-person-${index}`;
    const careLevel = (5 - (index % 5)) as 1 | 2 | 3 | 4 | 5;
    const normalized = Math.sqrt((index + 0.5) / safePersonCount);
    const arm = index % PERSON_ARM_COUNT;
    const armProgress = Math.floor(index / PERSON_ARM_COUNT) /
      Math.max(1, Math.ceil(safePersonCount / PERSON_ARM_COUNT) - 1);
    const angle = -Math.PI / 2 + arm * (Math.PI * 2 / PERSON_ARM_COUNT) +
      armProgress * Math.PI * 4.8 +
      (seededUnit(`${id}:arm`) - 0.5) * (0.09 + normalized * 0.08);
    const carePull = 0.74 + (5 - careLevel) * 0.055;
    const armRadius = 115 + normalized * PERSON_FIELD_RADIUS * carePull;
    const armWidth = 18 + normalized * 54;
    const lateral = (seededUnit(`${id}:lateral`) - 0.5) * armWidth;
    const x = Math.cos(angle) * armRadius - Math.sin(angle) * lateral;
    const y = (Math.sin(angle) * armRadius + Math.cos(angle) * lateral) * 0.7;
    const activity = 0.35 + seededUnit(`${id}:activity`) * 0.65;
    const nodeProminence = clamp(0.58 + careLevel * 0.075 + activity * 0.035, 0, 1);
    const z = -220 + nodeProminence * 440 + (seededUnit(`${id}:z`) - 0.5) * 8;
    const pointSize = 25 + careLevel * 4 + activity * 6;
    personX[index] = x;
    personY[index] = y;
    personZ[index] = z;
    nodeIds[index] = `person:${id}`;
    personIds[index] = id;
    kinds[index] = IdentityGalaxyNodeKindCode.FriendPerson;
    colorRoles[index] = IdentityGalaxyColorRole.Friend;
    flags[index] = index < 3 ? IdentityGalaxyNodeFlag.SuggestedHigh : 0;
    positions[index * 3] = x;
    positions[index * 3 + 1] = -y;
    positions[index * 3 + 2] = z;
    radii[index] = pointSize;
    pointSizes[index] = pointSize;
    prominence[index] = nodeProminence;
    brightness[index] = 0.78 + activity * 0.22;
    emphasis[index] = 1;
    atlasNodes[index] = {
      id: nodeIds[index]!,
      kind: "friend_person",
      label: `Identity ${index.toLocaleString()}`,
      x,
      y,
      radius: pointSize,
      priority: 900 + careLevel * 40,
      personId: id,
      initials: `I${index % 10}`,
      activityCount: Math.floor(activity * 240),
      careLevel,
    };
  }

  for (let accountIndex = 0; accountIndex < safeAccountCount; accountIndex += 1) {
    const sceneIndex = safePersonCount + accountIndex;
    const id = `lab-account-${accountIndex}`;
    const provider = GALAXY_LAB_PROVIDERS[accountIndex % GALAXY_LAB_PROVIDERS.length]!;
    const linked = accountIndex < linkedAccountCount;
    let x: number;
    let y: number;
    let z: number;
    let linkedPersonId: string | null = null;
    if (linked) {
      const personIndex = accountIndex % safePersonCount;
      const orbitIndex = Math.floor(accountIndex / safePersonCount);
      const orbitAngle = seededUnit(`lab-person-${personIndex}:orbit`) * Math.PI * 2 +
        orbitIndex * (Math.PI * 2 / 4);
      const orbit = 24 + orbitIndex * 8;
      x = personX[personIndex]! + Math.cos(orbitAngle) * orbit;
      y = personY[personIndex]! + Math.sin(orbitAngle) * orbit * 0.86;
      z = personZ[personIndex]! - 4 - orbitIndex * 2;
      linkedPersonId = `lab-person-${personIndex}`;
      edges[accountIndex] = {
        id: `lab-edge:${personIndex}:${accountIndex}`,
        sourceId: `person:${linkedPersonId}`,
        targetId: `account:${id}`,
      };
      edgeIndices[accountIndex * 2] = personIndex;
      edgeIndices[accountIndex * 2 + 1] = sceneIndex;
    } else {
      const unlinkedIndex = accountIndex - linkedAccountCount;
      const providerIndex = GALAXY_LAB_PROVIDERS.indexOf(provider);
      const providerLocalIndex = Math.floor(unlinkedIndex / GALAXY_LAB_PROVIDERS.length);
      const providerCount = Math.ceil(unlinkedAccountCount / GALAXY_LAB_PROVIDERS.length);
      const point = providerFieldPoint(provider, providerLocalIndex, providerCount);
      x = point.x;
      y = point.y;
      z = -150 + providerIndex * 10 + (seededUnit(`${id}:z`) - 0.5) * 36;
    }
    const activity = seededUnit(`${id}:activity`);
    const nodeProminence = linked ? 0.2 + activity * 0.05 : 0.1 + activity * 0.04;
    const pointSize = linked ? 11 + activity * 4 : 8 + activity * 3;
    nodeIds[sceneIndex] = `account:${id}`;
    accountIds[sceneIndex] = id;
    linkedPersonIds[sceneIndex] = linkedPersonId;
    providers[sceneIndex] = provider;
    kinds[sceneIndex] = provider === "rss"
      ? IdentityGalaxyNodeKindCode.Feed
      : IdentityGalaxyNodeKindCode.Account;
    colorRoles[sceneIndex] = provider === "rss"
      ? IdentityGalaxyColorRole.Feed
      : IdentityGalaxyColorRole.Account;
    positions[sceneIndex * 3] = x;
    positions[sceneIndex * 3 + 1] = -y;
    positions[sceneIndex * 3 + 2] = z;
    radii[sceneIndex] = pointSize;
    pointSizes[sceneIndex] = pointSize;
    prominence[sceneIndex] = nodeProminence;
    brightness[sceneIndex] = 0.72 + activity * 0.28;
    emphasis[sceneIndex] = 1;
    atlasNodes[sceneIndex] = {
      id: nodeIds[sceneIndex]!,
      kind: provider === "rss" ? "feed" : "account",
      label: `${provider === "rss" ? "Feed" : "Channel"} ${accountIndex.toLocaleString()}`,
      x,
      y,
      radius: pointSize,
      priority: linked ? 430 : 280,
      accountId: id,
      provider,
      linkedPersonId,
      activityCount: Math.floor(activity * 180),
    };
  }

  const regions = buildRegions(safeAccountCount, linkedAccountCount);
  const labeledPersonCount = Math.min(72, safePersonCount);
  const labeledPeople = Array.from({ length: labeledPersonCount }, (_, index) => {
    const personIndex = Math.floor((index + 0.5) * safePersonCount / labeledPersonCount);
    return atlasNodes[Math.min(safePersonCount - 1, personIndex)]!;
  });
  const labels: IdentityGraphAtlasLabel[] = [
    ...regions.map((region) => ({
      id: `label:${region.id}`,
      nodeId: `provider:${region.provider}`,
      text: `${region.label} ${region.count.toLocaleString()}`,
      x: region.x,
      y: region.y,
      priority: 1_500 + region.count,
      kind: "provider_cluster" as const,
    })),
    ...labeledPeople.map((node) => ({
      id: `label:${node.id}`,
      nodeId: node.id,
      text: node.label,
      x: node.x,
      y: node.y,
      priority: node.priority,
      kind: node.kind,
    })),
  ];
  const sceneBounds = boundsForScene(positions);
  const atlas: IdentityGraphAtlas = {
    nodes: atlasNodes,
    edges,
    regions,
    labels,
    hitBuckets: [],
    bounds: {
      left: sceneBounds.minX,
      right: sceneBounds.maxX,
      top: -sceneBounds.maxY,
      bottom: -sceneBounds.minY,
    },
    metrics: {
      sourceNodeCount: semanticCount,
      visibleNodeCount: Math.min(240, semanticCount),
      renderedPrimitiveCount: semanticCount + edges.length + regions.length + labels.length,
      visibleLabelCount: labels.length,
      clusterNodeCount: regions.length,
      lod: "middle",
      capped: semanticCount > 240,
      buildMs: 0,
    },
  };
  const scene: IdentityGalaxyScene = {
    version: IDENTITY_GALAXY_SCENE_VERSION,
    nodeIds,
    personIds,
    accountIds,
    linkedPersonIds,
    providers,
    kinds,
    colorRoles,
    flags,
    positions,
    radii,
    pointSizes,
    prominence,
    brightness,
    emphasis,
    edgeIndices,
    bounds: sceneBounds,
  };

  const backgroundPositions = new Float32Array(safeBackgroundCount * 3);
  const backgroundBrightness = new Float32Array(safeBackgroundCount);
  for (let index = 0; index < safeBackgroundCount; index += 1) {
    const radius = 1_800 + Math.sqrt(seededUnit(`background:${index}:radius`)) * 7_600;
    const angle = seededUnit(`background:${index}:angle`) * Math.PI * 2;
    backgroundPositions[index * 3] = Math.cos(angle) * radius;
    backgroundPositions[index * 3 + 1] = Math.sin(angle) * radius * 0.68;
    backgroundPositions[index * 3 + 2] = -260 - seededUnit(`background:${index}:depth`) * 1_300;
    backgroundBrightness[index] = 0.2 + seededUnit(`background:${index}:brightness`) * 0.8;
  }

  const buildMs = nowMs() - startedAt;
  atlas.metrics.buildMs = buildMs;
  return {
    atlas,
    scene,
    backgroundPositions,
    backgroundBrightness,
    personCount: safePersonCount,
    accountCount: safeAccountCount,
    linkedAccountCount,
    backgroundStarCount: safeBackgroundCount,
    buildMs,
  };
}
