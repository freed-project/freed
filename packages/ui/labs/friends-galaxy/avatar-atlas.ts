import type { GalaxyLabViewDetail } from "./backend.js";
import type { GalaxyLabBillboardAtlas } from "./billboard-labels.js";
import {
  galaxyLabNodePresentation,
  galaxyLabSemanticColor,
  type GalaxyLabFixture,
  type GalaxyLabPalette,
} from "./scene-fixture.js";
import { findGalaxyLabSceneNodeIndex } from "./scene-interaction-index.js";
import {
  projectGalaxyLabWorldPoint,
  type GalaxyLabViewportProjection,
} from "./viewport-projection.js";

const AVATAR_INSTANCE_FLOATS = 11;
const AVATAR_PIXEL_SCALE = 2;
const AVATAR_TEXTURE_WIDTH = 1_024;
const AVATAR_PADDING = 4;
const AVATAR_BORDER_WIDTH = 3;

export interface GalaxyLabAvatarSeed {
  nodeId: string;
  initials: string;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  size: number;
  priority: number;
  selected: boolean;
  color: string;
}

export interface GalaxyLabAvatarAtlas extends GalaxyLabBillboardAtlas {
  avatars: readonly GalaxyLabAvatarSeed[];
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function galaxyLabSelectedPersonNodeId(
  fixture: GalaxyLabFixture,
  selectedNodeId: string | null,
): string | null {
  if (!selectedNodeId) return null;
  const selectedIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    selectedNodeId,
  );
  if (selectedIndex === null) return null;
  const personId = fixture.scene.personIds[selectedIndex] ?? fixture.scene.linkedPersonIds[selectedIndex];
  return personId ? `person:${personId}` : null;
}

export function selectGalaxyLabAvatars(
  fixture: GalaxyLabFixture,
  palette: GalaxyLabPalette,
  selectedNodeId: string | null,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  projection?: GalaxyLabViewportProjection,
): readonly GalaxyLabAvatarSeed[] {
  if (detail !== "close") return [];
  const selectedPersonId = galaxyLabSelectedPersonNodeId(fixture, selectedNodeId);
  const cap = compact ? 6 : 12;
  const selectedIndex = findGalaxyLabSceneNodeIndex(
    fixture.scene,
    fixture.interactionIndex,
    selectedPersonId,
  );
  const screen = new Float32Array(2);
  const visible = (nodeIndex: number): boolean => {
    if (!projection) return true;
    const offset = nodeIndex * 3;
    return projectGalaxyLabWorldPoint(
      screen,
      projection,
      fixture.scene.positions[offset]!,
      fixture.scene.positions[offset + 1]!,
      fixture.scene.positions[offset + 2]!,
      64,
    );
  };
  const selectedVisible = selectedIndex !== null && visible(selectedIndex);
  const candidateCap = Math.max(0, cap - (selectedVisible ? 1 : 0));
  const ranked: Array<{ nodeIndex: number; rank: number }> = [];
  const insertCandidate = (nodeIndex: number, rank: number): void => {
    if (candidateCap === 0) return;
    const last = ranked[ranked.length - 1];
    if (
      ranked.length >= candidateCap && last &&
      (rank < last.rank || (rank === last.rank && nodeIndex > last.nodeIndex))
    ) return;
    let insertionIndex = ranked.length;
    while (insertionIndex > 0) {
      const previous = ranked[insertionIndex - 1]!;
      if (previous.rank > rank || (previous.rank === rank && previous.nodeIndex < nodeIndex)) break;
      insertionIndex -= 1;
    }
    ranked.splice(insertionIndex, 0, { nodeIndex, rank });
    if (ranked.length > candidateCap) ranked.pop();
  };

  for (let nodeIndex = 0; nodeIndex < fixture.scene.nodeIds.length; nodeIndex += 1) {
    if (!fixture.scene.personIds[nodeIndex] || nodeIndex === selectedIndex || !visible(nodeIndex)) continue;
    insertCandidate(nodeIndex, fixture.scene.prominence[nodeIndex]!);
  }

  const createSeed = (nodeIndex: number, selected: boolean): GalaxyLabAvatarSeed => {
    const presentation = galaxyLabNodePresentation(fixture, nodeIndex);
    const offset = nodeIndex * 3;
    return {
      nodeId: fixture.scene.nodeIds[nodeIndex]!,
      initials: presentation.initials,
      anchorX: fixture.scene.positions[offset]!,
      anchorY: fixture.scene.positions[offset + 1]!,
      anchorZ: fixture.scene.positions[offset + 2]! + 7,
      size: selected ? compact ? 42 : 48 : compact ? 34 : 40,
      priority: presentation.priority + fixture.scene.prominence[nodeIndex]! * 1_000,
      selected,
      color: galaxyLabSemanticColor(fixture, palette, nodeIndex),
    };
  };
  const accepted = ranked.map(({ nodeIndex }) => createSeed(nodeIndex, false));
  if (selectedVisible && selectedIndex !== null) accepted.push(createSeed(selectedIndex, true));
  return accepted;
}

export function createGalaxyLabAvatarAtlas(
  fixture: GalaxyLabFixture,
  palette: GalaxyLabPalette,
  selectedNodeId: string | null,
  compact: boolean,
  detail: GalaxyLabViewDetail,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
  projection?: GalaxyLabViewportProjection,
): GalaxyLabAvatarAtlas {
  const avatars = selectGalaxyLabAvatars(
    fixture,
    palette,
    selectedNodeId,
    compact,
    detail,
    projection,
  );
  if (avatars.length === 0) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, avatars, itemCount: 0, instanceData: new Float32Array(0) };
  }
  const placements: Array<{ left: number; top: number; size: number }> = [];
  let left = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
  let top = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
  let rowHeight = 0;
  for (const avatar of avatars) {
    const size = (avatar.size + AVATAR_PADDING * 2) * AVATAR_PIXEL_SCALE;
    if (left + size > AVATAR_TEXTURE_WIDTH) {
      left = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
      top += rowHeight;
      rowHeight = 0;
    }
    placements.push({ left, top, size });
    left += size;
    rowHeight = Math.max(rowHeight, size);
  }
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_TEXTURE_WIDTH;
  canvas.height = nextPowerOfTwo(top + rowHeight + AVATAR_PADDING * AVATAR_PIXEL_SCALE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the billboard avatar atlas.");
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < avatars.length; index += 1) {
    const avatar = avatars[index]!;
    const placement = placements[index]!;
    const padding = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
    const diameter = avatar.size * AVATAR_PIXEL_SCALE;
    const centerX = placement.left + padding + diameter / 2;
    const centerY = placement.top + padding + diameter / 2;
    const radius = diameter / 2;
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.clip();
    const image = images.get(avatar.nodeId);
    if (image) {
      context.drawImage(image, centerX - radius, centerY - radius, diameter, diameter);
    } else {
      context.fillStyle = avatar.color;
      context.fillRect(centerX - radius, centerY - radius, diameter, diameter);
      context.fillStyle = palette.background;
      context.font = `750 ${String(Math.round(diameter * 0.34))}px ${fontFamily}`;
      context.fillText(avatar.initials.slice(0, 2), centerX, centerY + diameter * 0.02);
    }
    context.restore();
    context.beginPath();
    context.arc(
      centerX,
      centerY,
      radius - AVATAR_BORDER_WIDTH * AVATAR_PIXEL_SCALE * 0.5,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = avatar.selected ? palette.selection : palette.background;
    context.lineWidth = AVATAR_BORDER_WIDTH * AVATAR_PIXEL_SCALE;
    context.stroke();
  }
  const instanceData = new Float32Array(avatars.length * AVATAR_INSTANCE_FLOATS);
  for (let index = 0; index < avatars.length; index += 1) {
    const avatar = avatars[index]!;
    const placement = placements[index]!;
    const offset = index * AVATAR_INSTANCE_FLOATS;
    const padding = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
    const diameter = avatar.size * AVATAR_PIXEL_SCALE;
    const contentLeft = placement.left + padding;
    const contentTop = placement.top + padding;
    instanceData[offset] = avatar.anchorX;
    instanceData[offset + 1] = avatar.anchorY;
    instanceData[offset + 2] = avatar.anchorZ;
    instanceData[offset + 3] = 0;
    instanceData[offset + 4] = 0;
    instanceData[offset + 5] = avatar.size;
    instanceData[offset + 6] = avatar.size;
    instanceData[offset + 7] = contentLeft / canvas.width;
    instanceData[offset + 8] = contentTop / canvas.height;
    instanceData[offset + 9] = (contentLeft + diameter) / canvas.width;
    instanceData[offset + 10] = (contentTop + diameter) / canvas.height;
  }
  return { canvas, avatars, itemCount: avatars.length, instanceData };
}
