import type { GalaxyLabFixture, GalaxyLabPalette } from "./scene-fixture.js";
import type { GalaxyLabViewDetail } from "./backend.js";

const LABEL_INSTANCE_FLOATS = 11;
const LABEL_PIXEL_SCALE = 2;
const LABEL_TEXTURE_WIDTH = 2_048;
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 5;
const LABEL_OUTLINE_WIDTH = 3;

interface GalaxyLabLabelSeed {
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

export interface GalaxyLabLabelAtlas {
  canvas: HTMLCanvasElement;
  labels: readonly GalaxyLabBillboardLabel[];
  instanceData: Float32Array;
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
): readonly GalaxyLabLabelSeed[] {
  const nodeIndexById = new Map(fixture.scene.nodeIds.map((id, index) => [id, index]));
  const cap = detail === "overview"
    ? compact ? 8 : 13
    : detail === "middle"
      ? compact ? 20 : 36
      : compact ? 32 : 64;
  const seeds = fixture.atlas.labels.map((label): GalaxyLabLabelSeed => {
    const nodeIndex = nodeIndexById.get(label.nodeId);
    const provider = label.kind === "provider_cluster";
    const fontSize = provider ? compact ? 15 : 18 : compact ? 12 : 14;
    const pointSize = nodeIndex === undefined ? 8 : Math.max(3.5, fixture.scene.pointSizes[nodeIndex]! * 0.34);
    return {
      id: label.id,
      nodeId: label.nodeId,
      text: truncateLabel(label.text),
      anchorX: nodeIndex === undefined ? label.x : fixture.scene.positions[nodeIndex * 3]!,
      anchorY: nodeIndex === undefined ? -label.y : fixture.scene.positions[nodeIndex * 3 + 1]!,
      anchorZ: nodeIndex === undefined ? -72 : fixture.scene.positions[nodeIndex * 3 + 2]! + 5,
      fontSize,
      gapY: pointSize * 0.5 + 2,
      priority: label.priority + (provider ? 100_000 : fixture.scene.prominence[nodeIndex ?? 0]! * 1_000),
      provider,
    };
  });
  const providers = seeds.filter((label) => label.provider);
  const semantic = seeds
    .filter((label) => !label.provider)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const semanticCap = Math.max(0, cap - providers.length);
  const minimumDistance = (detail === "overview" ? 760 : detail === "middle" ? 280 : 90) *
    (compact ? 1.3 : 1);
  const selectedSemantic: GalaxyLabLabelSeed[] = [];
  for (const candidate of semantic) {
    const separated = selectedSemantic.every((selected) => Math.hypot(
      candidate.anchorX - selected.anchorX,
      candidate.anchorY - selected.anchorY,
    ) >= minimumDistance);
    if (!separated) continue;
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
  fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif",
): GalaxyLabLabelAtlas {
  const seeds = selectGalaxyLabLabels(fixture, compact, detail);
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
  return { canvas, labels, instanceData };
}

export const GALAXY_LAB_LABEL_INSTANCE_STRIDE = LABEL_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
