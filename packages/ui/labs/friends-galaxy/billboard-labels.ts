import {
  galaxyLabNodePresentation,
  type GalaxyLabFixture,
  type GalaxyLabPalette,
} from "./scene-fixture.js";
import type { GalaxyLabViewDetail } from "./backend.js";
import {
  galaxyLabSelectedPersonNodeId,
  selectGalaxyLabAvatars,
  type GalaxyLabAvatarSeed,
} from "./avatar-atlas.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import {
  projectGalaxyLabWorldPoint,
  type GalaxyLabViewportProjection,
} from "./viewport-projection.js";

const LABEL_INSTANCE_FLOATS = 11;
const LABEL_PIXEL_SCALE = 2;
const LABEL_TEXTURE_WIDTH = 2_048;
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 5;
const LABEL_OUTLINE_WIDTH = 3;

export interface GalaxyLabLabelSeed {
  id: string;
  nodeId: string;
  text: string;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  fontSize: number;
  gapY: number;
  priority: number;
  provider: boolean;
}

export interface GalaxyLabBillboardLabel extends GalaxyLabLabelSeed {
  width: number;
  height: number;
  uv: readonly [number, number, number, number];
}

export interface GalaxyLabBillboardAtlas {
  canvas: HTMLCanvasElement;
  itemCount: number;
  instanceData: Float32Array;
}

export interface GalaxyLabLabelAtlas extends GalaxyLabBillboardAtlas {
  labels: readonly GalaxyLabBillboardLabel[];
}

const AVATAR_LABEL_GAP = 8;
const AVATAR_EXCLUSION_RADIUS_SCALE = 1.5;

export function placeGalaxyLabLabelsAroundAvatars(
  seeds: readonly GalaxyLabLabelSeed[],
  avatars: readonly GalaxyLabAvatarSeed[],
): readonly GalaxyLabLabelSeed[] {
  if (avatars.length === 0) return seeds;

  return seeds.flatMap((seed) => {
    const ownAvatar = avatars.find((avatar) => avatar.nodeId === seed.nodeId);
    if (ownAvatar) {
      return [{
        ...seed,
        gapY: Math.max(seed.gapY, ownAvatar.size * 0.5 + AVATAR_LABEL_GAP),
      }];
    }

    const overlapsAvatar = avatars.some((avatar) => Math.hypot(
      seed.anchorX - avatar.anchorX,
      seed.anchorY - avatar.anchorY,
    ) < avatar.size * AVATAR_EXCLUSION_RADIUS_SCALE + AVATAR_LABEL_GAP);
    return overlapsAvatar ? [] : [seed];
  });
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function truncateLabel(value: string): string {
  const characters = Array.from(value.trim());
  return characters.length <= 28 ? value.trim() : `${characters.slice(0, 27).join("")}...`;
}

export function selectGalaxyLabLabels(
  fixture: GalaxyLabFixture,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  selectedNodeId: string | null = null,
  projection?: GalaxyLabViewportProjection,
): readonly GalaxyLabLabelSeed[] {
  const cap = detail === "overview"
    ? compact ? 8 : 13
    : detail === "middle"
      ? compact ? 20 : 36
      : compact ? 32 : 64;
  const selectedPersonId = galaxyLabSelectedPersonNodeId(fixture, selectedNodeId);
  const seedForAtlasLabel = (label: GalaxyLabFixture["atlas"]["labels"][number]): GalaxyLabLabelSeed => {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      fixture.scene,
      fixture.interactionIndex,
      label.nodeId,
    );
    const provider = label.kind === "provider_cluster";
    const fontSize = provider ? compact ? 15 : 18 : compact ? 12 : 14;
    const pointSize = nodeIndex === null ? 8 : Math.max(3.5, fixture.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: label.id,
      nodeId: label.nodeId,
      text: truncateLabel(label.text),
      anchorX: nodeIndex === null ? label.x : fixture.scene.positions[nodeIndex * 3]!,
      anchorY: nodeIndex === null ? -label.y : fixture.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: nodeIndex === null ? -72 : fixture.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize,
      gapY: detail === "close" && !provider
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: label.priority + (provider ? 100_000 : fixture.scene.prominence[nodeIndex ?? 0]! * 1_000) +
        (label.nodeId === selectedPersonId ? 1_000_000 : 0),
      provider,
    };
  };
  const seedForPersonNode = (nodeIndex: number): GalaxyLabLabelSeed => {
    const presentation = galaxyLabNodePresentation(fixture, nodeIndex);
    const nodeId = fixture.scene.nodeIds[nodeIndex]!;
    const pointSize = Math.max(3.5, fixture.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: `label:visible:${nodeId}`,
      nodeId,
      text: truncateLabel(presentation.label),
      anchorX: fixture.scene.positions[nodeIndex * 3]!,
      anchorY: fixture.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: fixture.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize: compact ? 12 : 14,
      gapY: detail === "close"
        ? Math.max(pointSize * 0.5, compact ? 21 : 25) + 2
        : pointSize * 0.5 + 2,
      priority: presentation.priority + fixture.scene.prominence[nodeIndex]! * 1_000 +
        (nodeId === selectedPersonId ? 1_000_000 : 0),
      provider: false,
    };
  };
  const providerSeeds = fixture.atlas.labels
    .filter((label) => label.kind === "provider_cluster")
    .map(seedForAtlasLabel);
  const seeds: GalaxyLabLabelSeed[] = projection && detail !== "overview"
    ? [...providerSeeds]
    : fixture.atlas.labels.map(seedForAtlasLabel);

  if (projection && detail !== "overview") {
    const candidateCapacity = Math.max(1, (cap - providerSeeds.length) * 4);
    const ranked: Array<{ nodeIndex: number; rank: number }> = [];
    const screen = new Float32Array(2);
    for (let nodeIndex = 0; nodeIndex < fixture.scene.nodeIds.length; nodeIndex += 1) {
      if (!fixture.scene.personIds[nodeIndex]) continue;
      const offset = nodeIndex * 3;
      if (!projectGalaxyLabWorldPoint(
        screen,
        projection,
        fixture.scene.positions[offset]!,
        fixture.scene.positions[offset + 1]!,
        fixture.scene.positions[offset + 2]!,
        160,
      )) continue;
      const rank = fixture.scene.prominence[nodeIndex]! +
        (fixture.scene.nodeIds[nodeIndex] === selectedPersonId ? 10 : 0);
      const last = ranked[ranked.length - 1];
      if (
        ranked.length >= candidateCapacity && last &&
        (rank < last.rank || (rank === last.rank && nodeIndex > last.nodeIndex))
      ) continue;
      let insertionIndex = ranked.length;
      while (insertionIndex > 0) {
        const previous = ranked[insertionIndex - 1]!;
        if (previous.rank > rank || (previous.rank === rank && previous.nodeIndex < nodeIndex)) break;
        insertionIndex -= 1;
      }
      ranked.splice(insertionIndex, 0, { nodeIndex, rank });
      if (ranked.length > candidateCapacity) ranked.pop();
    }
    for (const candidate of ranked) seeds.push(seedForPersonNode(candidate.nodeIndex));
  }

  if (selectedPersonId && !seeds.some((label) => label.nodeId === selectedPersonId)) {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      fixture.scene,
      fixture.interactionIndex,
      selectedPersonId,
    );
    if (nodeIndex !== null) seeds.push(seedForPersonNode(nodeIndex));
  }
  const projectionScratch = new Float32Array(2);
  const labelIsVisible = (label: GalaxyLabLabelSeed): boolean => !projection ||
    projectGalaxyLabWorldPoint(
      projectionScratch,
      projection,
      label.anchorX,
      label.anchorY,
      label.anchorZ,
      160,
    );
  const providers = seeds.filter((label) => label.provider && labelIsVisible(label));
  const semantic = seeds
    .filter((label) => !label.provider && labelIsVisible(label))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const semanticCap = Math.max(0, cap - providers.length);
  const minimumDistance = (detail === "overview" ? 760 : detail === "middle" ? 280 : 90) *
    (compact ? 1.3 : 1);
  const minimumScreenDistance = (detail === "overview" ? 96 : detail === "middle" ? 92 : 82) *
    (compact ? 1.08 : 1);
  const selectedSemantic: GalaxyLabLabelSeed[] = [];
  const selectedScreenPositions = new Float32Array(semanticCap * 2);
  for (const candidate of semantic) {
    let separated = true;
    if (projection) {
      projectGalaxyLabWorldPoint(
        projectionScratch,
        projection,
        candidate.anchorX,
        candidate.anchorY,
        candidate.anchorZ,
        160,
      );
      for (let index = 0; index < selectedSemantic.length; index += 1) {
        if (Math.hypot(
          projectionScratch[0]! - selectedScreenPositions[index * 2]!,
          projectionScratch[1]! - selectedScreenPositions[index * 2 + 1]!,
        ) < minimumScreenDistance) {
          separated = false;
          break;
        }
      }
    } else {
      separated = selectedSemantic.every((selected) => Math.hypot(
        candidate.anchorX - selected.anchorX,
        candidate.anchorY - selected.anchorY,
      ) >= minimumDistance);
    }
    if (!separated) continue;
    if (projection) {
      selectedScreenPositions[selectedSemantic.length * 2] = projectionScratch[0]!;
      selectedScreenPositions[selectedSemantic.length * 2 + 1] = projectionScratch[1]!;
    }
    selectedSemantic.push(candidate);
    if (selectedSemantic.length >= semanticCap) break;
  }
  return [...providers, ...selectedSemantic];
}

export function createGalaxyLabLabelAtlas(
  fixture: GalaxyLabFixture,
  palette: GalaxyLabPalette,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  selectedNodeId: string | null = null,
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: GalaxyLabViewportProjection,
): GalaxyLabLabelAtlas {
  const avatars = selectGalaxyLabAvatars(
    fixture,
    palette,
    selectedNodeId,
    compact,
    detail,
    projection,
  );
  const seeds = placeGalaxyLabLabelsAroundAvatars(
    selectGalaxyLabLabels(fixture, compact, detail, selectedNodeId, projection),
    avatars,
  );
  const measuringCanvas = document.createElement("canvas");
  const measuringContext = measuringCanvas.getContext("2d");
  if (!measuringContext) throw new Error("Canvas 2D is unavailable for the billboard label atlas.");
  const measurements = seeds.map((label) => {
    measuringContext.font = `650 ${String(label.fontSize * LABEL_PIXEL_SCALE)}px ${fontFamily}`;
    const width = Math.ceil(measuringContext.measureText(label.text).width) + LABEL_PADDING_X * 2 * LABEL_PIXEL_SCALE;
    const height = Math.ceil(label.fontSize * 1.42 * LABEL_PIXEL_SCALE) + LABEL_PADDING_Y * 2 * LABEL_PIXEL_SCALE;
    return { width, height };
  });
  const placements: Array<{ left: number; top: number; width: number; height: number }> = [];
  let left = LABEL_PADDING_X * LABEL_PIXEL_SCALE;
  let top = LABEL_PADDING_Y * LABEL_PIXEL_SCALE;
  let rowHeight = 0;
  for (const measurement of measurements) {
    if (left + measurement.width > LABEL_TEXTURE_WIDTH) {
      left = LABEL_PADDING_X * LABEL_PIXEL_SCALE;
      top += rowHeight;
      rowHeight = 0;
    }
    placements.push({ left, top, ...measurement });
    left += measurement.width;
    rowHeight = Math.max(rowHeight, measurement.height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_TEXTURE_WIDTH;
  canvas.height = nextPowerOfTwo(top + rowHeight + LABEL_PADDING_Y * LABEL_PIXEL_SCALE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the billboard label atlas.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = palette.background;
  context.fillStyle = palette.text;
  context.lineWidth = LABEL_OUTLINE_WIDTH * LABEL_PIXEL_SCALE;
  const labels = seeds.map((label, index): GalaxyLabBillboardLabel => {
    const placement = placements[index]!;
    context.font = `650 ${String(label.fontSize * LABEL_PIXEL_SCALE)}px ${fontFamily}`;
    const textX = placement.left + placement.width / 2;
    const textY = placement.top + placement.height / 2;
    context.strokeText(label.text, textX, textY);
    context.fillText(label.text, textX, textY);
    return {
      ...label,
      width: placement.width / LABEL_PIXEL_SCALE,
      height: placement.height / LABEL_PIXEL_SCALE,
      uv: [
        placement.left / canvas.width,
        placement.top / canvas.height,
        (placement.left + placement.width) / canvas.width,
        (placement.top + placement.height) / canvas.height,
      ],
    };
  });
  const instanceData = new Float32Array(labels.length * LABEL_INSTANCE_FLOATS);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index]!;
    const offset = index * LABEL_INSTANCE_FLOATS;
    instanceData[offset] = label.anchorX;
    instanceData[offset + 1] = label.anchorY;
    instanceData[offset + 2] = label.anchorZ;
    instanceData[offset + 3] = 0;
    instanceData[offset + 4] = label.gapY + label.height * 0.5;
    instanceData[offset + 5] = label.width;
    instanceData[offset + 6] = label.height;
    instanceData.set(label.uv, offset + 7);
  }
  return { canvas, labels, itemCount: labels.length, instanceData };
}

export const GALAXY_LAB_BILLBOARD_INSTANCE_STRIDE = LABEL_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
