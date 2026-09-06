import type { FriendsGalaxyBillboardAtlas } from "./friends-galaxy-billboard-atlas.js";
import { createFriendAvatarPalette } from "./friend-avatar-style.js";

const AVATAR_INSTANCE_FLOATS = 11;
const AVATAR_PIXEL_SCALE = 2;
const AVATAR_TEXTURE_WIDTH = 1_024;
const AVATAR_PADDING = 10;
const AVATAR_BORDER_WIDTH = 3;

export interface FriendsGalaxyAvatarSeed {
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

export interface FriendsGalaxyAvatarAtlas extends FriendsGalaxyBillboardAtlas {
  avatars: readonly FriendsGalaxyAvatarSeed[];
}

export interface FriendsGalaxyAvatarPalette {
  background: string;
  selection: string;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function createFriendsGalaxyAvatarAtlas(
  avatars: readonly FriendsGalaxyAvatarSeed[],
  palette: FriendsGalaxyAvatarPalette,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
): FriendsGalaxyAvatarAtlas {
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
  const avatarStyle = createFriendAvatarPalette();
  for (let index = 0; index < avatars.length; index += 1) {
    const avatar = avatars[index]!;
    const placement = placements[index]!;
    const padding = AVATAR_PADDING * AVATAR_PIXEL_SCALE;
    const diameter = avatar.size * AVATAR_PIXEL_SCALE;
    const centerX = placement.left + padding + diameter / 2;
    const centerY = placement.top + padding + diameter / 2;
    const radius = diameter / 2;
    // Paint the halo before clipping the photo, and include it in the UVs.
    // Otherwise the renderer silently crops off the same glow used on maps.
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius - 1, 0, Math.PI * 2);
    context.fillStyle = avatarStyle.gradientMid;
    context.shadowColor = avatarStyle.glow;
    context.shadowBlur = padding * 0.7;
    context.fill();
    context.restore();
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
    context.strokeStyle = avatar.selected ? palette.selection : avatarStyle.borderStrong;
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
    const contentLeft = placement.left;
    const contentTop = placement.top;
    instanceData[offset] = avatar.anchorX;
    instanceData[offset + 1] = avatar.anchorY;
    instanceData[offset + 2] = avatar.anchorZ;
    instanceData[offset + 3] = 0;
    instanceData[offset + 4] = 0;
    instanceData[offset + 5] = avatar.size + AVATAR_PADDING * 2;
    instanceData[offset + 6] = avatar.size + AVATAR_PADDING * 2;
    instanceData[offset + 7] = contentLeft / canvas.width;
    instanceData[offset + 8] = contentTop / canvas.height;
    instanceData[offset + 9] = (contentLeft + diameter + padding * 2) / canvas.width;
    instanceData[offset + 10] = (contentTop + diameter + padding * 2) / canvas.height;
  }
  return { canvas, avatars, itemCount: avatars.length, instanceData };
}
