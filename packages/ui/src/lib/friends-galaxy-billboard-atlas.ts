const LABEL_INSTANCE_FLOATS = 11;
const LABEL_PIXEL_SCALE = 2;
const LABEL_TEXTURE_WIDTH = 2_048;
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 5;
const LABEL_OUTLINE_WIDTH = 3;
const AVATAR_LABEL_GAP = 8;
const AVATAR_EXCLUSION_RADIUS_SCALE = 1.5;

export const FRIENDS_GALAXY_BILLBOARD_INSTANCE_STRIDE =
  LABEL_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface FriendsGalaxyLabelSeed {
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

export interface FriendsGalaxyBillboardLabel extends FriendsGalaxyLabelSeed {
  width: number;
  height: number;
  uv: readonly [number, number, number, number];
}

export interface FriendsGalaxyBillboardAtlas {
  canvas: HTMLCanvasElement;
  itemCount: number;
  instanceData: Float32Array;
}

export interface FriendsGalaxyLabelAtlas extends FriendsGalaxyBillboardAtlas {
  labels: readonly FriendsGalaxyBillboardLabel[];
}

export interface FriendsGalaxyLabelPalette {
  background: string;
  text: string;
}

export interface FriendsGalaxyAvatarExclusion {
  nodeId: string;
  anchorX: number;
  anchorY: number;
  size: number;
}

export function placeFriendsGalaxyLabelsAroundAvatars(
  seeds: readonly FriendsGalaxyLabelSeed[],
  avatars: readonly FriendsGalaxyAvatarExclusion[],
): readonly FriendsGalaxyLabelSeed[] {
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

export function createFriendsGalaxyLabelAtlas(
  seeds: readonly FriendsGalaxyLabelSeed[],
  palette: FriendsGalaxyLabelPalette,
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
): FriendsGalaxyLabelAtlas {
  const measuringCanvas = document.createElement("canvas");
  const measuringContext = measuringCanvas.getContext("2d");
  if (!measuringContext) {
    throw new Error("Canvas 2D is unavailable for the billboard label atlas.");
  }
  const measurements = seeds.map((label) => {
    measuringContext.font = `650 ${String(label.fontSize * LABEL_PIXEL_SCALE)}px ${fontFamily}`;
    const width = Math.ceil(measuringContext.measureText(label.text).width) +
      LABEL_PADDING_X * 2 * LABEL_PIXEL_SCALE;
    const height = Math.ceil(label.fontSize * 1.42 * LABEL_PIXEL_SCALE) +
      LABEL_PADDING_Y * 2 * LABEL_PIXEL_SCALE;
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
  const labels = seeds.map((label, index): FriendsGalaxyBillboardLabel => {
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
