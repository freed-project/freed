import type { GalaxyLabViewDetail } from "./backend.js";
import type { GalaxyLabBillboardAtlas } from "./billboard-labels.js";
import {
  galaxyLabNodePresentation,
  galaxyLabSemanticColor,
  type GalaxyLabFixture,
  type GalaxyLabPalette,
} from "./scene-fixture.js";
import { findGalaxyLabSceneNodeIndex } from "./scene-interaction-index.js";

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
): readonly GalaxyLabAvatarSeed[] {
  if (detail !== "close") return [];
  const selectedPersonId = galaxyLabSelectedPersonNodeId(fixture, selectedNodeId);
  const cap = compact ? 6 : 12;
  const candidates = fixture.atlas.nodes
    .filter((node) => Boolean(node.personId))
    .map((node): GalaxyLabAvatarSeed | null => {
      const nodeIndex = findGalaxyLabSceneNodeIndex(
        fixture.scene,
        fixture.interactionIndex,
        node.id,
      );
      if (nodeIndex === null) return null;
      const selected = node.id === selectedPersonId;
      return {
        nodeId: node.id,
        initials: node.initials || node.label.slice(0, 2).toUpperCase(),
        anchorX: fixture.scene.positions[nodeIndex * 3]!,
        anchorY: fixture.scene.positions[nodeIndex * 3 + 1]!,
        anchorZ: fixture.scene.positions[nodeIndex * 3 + 2]! + 7,
        size: selected ? compact ? 42 : 48 : compact ? 34 : 40,
        priority: node.priority + fixture.scene.prominence[nodeIndex]! * 1_000,
        selected,
        color: galaxyLabSemanticColor(fixture, palette, nodeIndex),
      };
    })
    .filter((avatar): avatar is GalaxyLabAvatarSeed => avatar !== null)
    .sort((left, right) => right.priority - left.priority || left.nodeId.localeCompare(right.nodeId));
  if (selectedPersonId && !candidates.some((avatar) => avatar.nodeId === selectedPersonId)) {
    const nodeIndex = findGalaxyLabSceneNodeIndex(
      fixture.scene,
      fixture.interactionIndex,
      selectedPersonId,
    );
    if (nodeIndex !== null) {
      const presentation = galaxyLabNodePresentation(fixture, nodeIndex);
      candidates.push({
        nodeId: selectedPersonId,
        initials: presentation.initials,
        anchorX: fixture.scene.positions[nodeIndex * 3]!,
        anchorY: fixture.scene.positions[nodeIndex * 3 + 1]!,
        anchorZ: fixture.scene.positions[nodeIndex * 3 + 2]! + 7,
        size: compact ? 42 : 48,
        priority: presentation.priority + fixture.scene.prominence[nodeIndex]! * 1_000,
        selected: true,
        color: galaxyLabSemanticColor(fixture, palette, nodeIndex),
      });
    }
  }
  const selected = candidates.find((avatar) => avatar.selected) ?? null;
  const accepted = candidates.filter((avatar) => !avatar.selected).slice(0, cap - (selected ? 1 : 0));
  if (selected) accepted.push(selected);
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
): GalaxyLabAvatarAtlas {
  const avatars = selectGalaxyLabAvatars(
    fixture,
    palette,
    selectedNodeId,
    compact,
    detail,
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
