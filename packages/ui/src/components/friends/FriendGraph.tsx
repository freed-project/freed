/// <reference path="../../types/troika-three-text.d.ts" />

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Text as TroikaText } from "troika-three-text";
import type {
  Account,
  FeedItem,
  FriendCandidateConfidence,
  MapMode,
  Person,
  RssFeed,
} from "@freed/shared";
import type { ThemeId } from "@freed/shared/themes";
import {
  buildIdentityGraphActivitySummaries,
  type IdentityGraphActivitySummaries,
} from "../../lib/identity-graph-activity-summary.js";
import {
  buildIdentityGraphAtlas,
  fitTransformToAtlasBounds,
  type BuildIdentityGraphAtlasInput,
  type IdentityGraphAtlas,
  type IdentityGraphAtlasBounds,
  type IdentityGraphAtlasNode,
  type IdentityGraphAtlasQuality,
} from "../../lib/identity-graph-atlas.js";
import {
  FRIEND_GRAPH_DEFAULT_TRANSFORM,
  type ViewTransform,
} from "../../lib/identity-graph-layout.js";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusNode: (id: string) => void;
}

interface FriendGraphProps {
  persons: Person[];
  accounts: Record<string, Account>;
  feeds: Record<string, RssFeed>;
  feedItems?: Record<string, FeedItem>;
  activitySummaries?: IdentityGraphActivitySummaries;
  mode: MapMode;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  onSelectPerson: (person: Person) => void;
  onSelectAccount: (account: Account) => void;
  onClearSelection?: () => void;
  onLinkAccountToPerson?: (accountId: string, personId: string) => Promise<void> | void;
  onPinPersonPosition?: (personId: string, x: number, y: number) => Promise<void> | void;
  onPinAccountPosition?: (accountId: string, x: number, y: number) => Promise<void> | void;
  onDropNodeToRelationshipTier?: (drop: {
    personId?: string;
    accountId?: string;
    level: 1 | 3 | 5;
  }) => Promise<void> | void;
  friendSuggestionStrengthByPerson?: Map<string, FriendCandidateConfidence>;
  friendSuggestionStrengthByAccount?: Map<string, FriendCandidateConfidence>;
  themeId?: ThemeId;
}

type DragState =
  {
    kind: "pan";
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  };

type TouchPoint = {
  x: number;
  y: number;
};

type PinchState = {
  pointerIds: [number, number];
  initialDistance: number;
  initialScale: number;
  initialMidpoint: TouchPoint;
  initialWorldPoint: TouchPoint;
  moved: boolean;
};

type StarfieldVariation = "nebula-rings" | "nebula" | "rings";

type GraphContextMenuState = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  node: IdentityGraphAtlasNode;
};

interface GraphDebugNode {
  id: string;
  personId?: string;
  accountId?: string;
  feedUrl?: string;
  linkedPersonId?: string | null;
  kind: string;
  x: number;
  y: number;
  radius: number;
}

type GraphViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

interface GraphPerfSnapshot {
  modelBuildMs: number;
  layoutMs: number;
  sceneSyncMs: number;
  labelPassMs: number;
  sceneSyncCount: number;
  contentSyncCount: number;
  transformOnlySyncCount: number;
  edgeRebuildCount: number;
  nodeRestyleCount: number;
  labelLayoutCount: number;
  avatarDisplayCount: number;
  visibleLabelCount: number;
  visibleNodeLabelCount: number;
  visibleProviderLabelCount: number;
  denseRenderMode: "dense" | "containers";
  denseInteractionEligible: boolean;
  denseInteractionNodeCount: number;
  denseInteractionCulled: boolean;
  denseInteractionRebuildCount: number;
  qualityMode: "interactive" | "settled";
  sourceNodeCount: number;
  visibleNodeCount: number;
  renderedPrimitiveCount: number;
  firstVisibleMs: number;
  frameP95Ms: number;
  longTaskCount: number;
  memoryEstimateBytes: number;
  rendererType: "three-starfield" | "canvas-starfield-fallback";
  touchInputMode: "pointer-events";
  lod: string;
  capped: boolean;
}

interface GraphSurfacePerfSnapshot extends GraphPerfSnapshot {
  nodeCount: number;
  linkCount: number;
  personCount: number;
  channelCount: number;
  transformScale: number;
}

interface AtlasResponse {
  requestId: number;
  atlas: IdentityGraphAtlas;
  durationMs: number;
}

interface GraphPalette {
  surface: string;
  text: string;
  mutedText: string;
  edge: string;
  friendFill: string;
  friendStroke: string;
  connectionFill: string;
  connectionStroke: string;
  accountFill: string;
  feedFill: string;
  providerFill: string;
  selection: string;
  highlight: string;
  labelFill: string;
  labelStroke: string;
  providerColors: Record<string, string>;
}

const MIN_SCALE = 0.18;
const MAX_SCALE = 3.2;
const FIT_PADDING = 96;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.0035;
const WHEEL_ZOOM_SPEED = 0.0014;
const INTERACTION_SETTLE_DELAY_MS = 180;
const DENSE_INTERACTION_SETTLE_DELAY_MS = 420;
const GRAPH_LAYOUT_WORKER_TIMEOUT_MS = 2_400;
const CONTROL_BASE = "theme-graph-control rounded-xl px-3 py-1.5 text-xs";
const EMPTY_GRAPH_VIEWPORT_INSETS: GraphViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function distanceBetween(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpointBetween(first: TouchPoint, second: TouchPoint): TouchPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function sameGraphViewportInsets(left: GraphViewportInsets, right: GraphViewportInsets): boolean {
  return left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left;
}

function fitTransformToVisibleAtlasBounds(
  bounds: IdentityGraphAtlasBounds,
  width: number,
  height: number,
  padding: number,
  viewportInsets: GraphViewportInsets,
): ViewTransform {
  const visibleWidth = Math.max(1, width - viewportInsets.left - viewportInsets.right);
  const visibleHeight = Math.max(1, height - viewportInsets.top - viewportInsets.bottom);
  const transform = fitTransformToAtlasBounds(bounds, visibleWidth, visibleHeight, padding);
  return {
    x: transform.x + viewportInsets.left,
    y: transform.y + viewportInsets.top,
    scale: transform.scale,
  };
}

function visibleViewportCenter(width: number, height: number, viewportInsets: GraphViewportInsets): TouchPoint {
  return {
    x: viewportInsets.left + Math.max(1, width - viewportInsets.left - viewportInsets.right) / 2,
    y: viewportInsets.top + Math.max(1, height - viewportInsets.top - viewportInsets.bottom) / 2,
  };
}

function cssRgbVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = style.getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).map((part) => Number(part)).filter(Number.isFinite);
  if (parts.length < 3) return fallback;
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

function rgb(rgbParts: string, alpha = 1): string {
  return `rgb(${rgbParts} / ${alpha})`;
}

function readGraphPalette(element: HTMLElement | null): GraphPalette {
  const style = element ? getComputedStyle(element) : getComputedStyle(document.documentElement);
  const primary = cssRgbVar(style, "--theme-accent-primary-rgb", "59 130 246");
  const secondary = cssRgbVar(style, "--theme-accent-secondary-rgb", "139 92 246");
  const tertiary = cssRgbVar(style, "--theme-accent-tertiary-rgb", "6 182 212");
  const shell = cssRgbVar(style, "--theme-shell-rgb", "6 7 13");
  return {
    surface: rgb(shell, 0.2),
    text: style.getPropertyValue("--theme-text") || rgb("255 255 255", 0.9),
    mutedText: style.getPropertyValue("--theme-text-muted") || rgb("255 255 255", 0.62),
    edge: rgb(primary, 0.32),
    friendFill: rgb(primary, 0.42),
    friendStroke: rgb(primary, 0.82),
    connectionFill: rgb(secondary, 0.34),
    connectionStroke: rgb(secondary, 0.72),
    accountFill: rgb(tertiary, 0.46),
    feedFill: rgb("245 158 11", 0.42),
    providerFill: rgb(secondary, 0.24),
    selection: rgb(tertiary, 0.92),
    highlight: rgb(secondary, 0.9),
    labelFill: rgb(shell, 0.86),
    labelStroke: rgb(primary, 0.34),
    providerColors: {
      instagram: rgb("236 72 153", 0.78),
      facebook: rgb("59 130 246", 0.78),
      linkedin: rgb("14 165 233", 0.78),
      x: rgb("226 232 240", 0.78),
      rss: rgb("245 158 11", 0.8),
      substack: rgb("249 115 22", 0.78),
      medium: rgb("34 197 94", 0.72),
      other: rgb(tertiary, 0.72),
    },
  };
}

function providerColor(provider: string | undefined, palette: GraphPalette): string {
  return palette.providerColors[provider ?? "other"] ?? palette.providerColors.other;
}

function shouldExposeGraphDebug(): boolean {
  return typeof window !== "undefined" &&
    (window as typeof window & { __FREED_GRAPH_DEBUG_ENABLED__?: boolean })
      .__FREED_GRAPH_DEBUG_ENABLED__ === true;
}

function buildGraphDebugNodes(nodes: IdentityGraphAtlasNode[]): GraphDebugNode[] {
  return nodes.map((node) => ({
    id: node.id,
    personId: node.personId,
    accountId: node.accountId,
    feedUrl: node.feedUrl,
    linkedPersonId: node.linkedPersonId,
    kind: node.kind,
    x: node.x,
    y: node.y,
    radius: node.radius,
  }));
}

function buildSuggestionRecord(
  map: Map<string, FriendCandidateConfidence> | undefined,
): Record<string, FriendCandidateConfidence> {
  if (!map) return {};
  return Object.fromEntries(map.entries());
}

function estimateMemoryBytes(atlas: IdentityGraphAtlas): number {
  return atlas.nodes.length * 160 +
    atlas.edges.length * 64 +
    atlas.labels.length * 96 +
    atlas.regions.length * 112 +
    atlas.hitBuckets.reduce((sum, bucket) => sum + bucket.nodeIds.length * 24, 0);
}

function buildHitBucketMap(atlas: IdentityGraphAtlas): Map<string, string[]> {
  return new Map(atlas.hitBuckets.map((bucket) => [bucket.key, bucket.nodeIds]));
}

function findHitNode(
  atlas: IdentityGraphAtlas,
  hitBuckets: Map<string, string[]>,
  x: number,
  y: number,
): IdentityGraphAtlasNode | null {
  const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));
  const cellX = Math.floor(x / 96);
  const cellY = Math.floor(y / 96);
  let best: IdentityGraphAtlasNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      const bucket = hitBuckets.get(`${cellX + xOffset}:${cellY + yOffset}`);
      if (!bucket) continue;
      for (const nodeId of bucket) {
        const node = nodeById.get(nodeId);
        if (!node) continue;
        const dx = node.x - x;
        const dy = node.y - y;
        const distance = dx * dx + dy * dy;
        if (distance > node.radius * node.radius) continue;
        if (distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function seededUnit(value: string): number {
  return (hashValue(value) % 10_000) / 10_000;
}

function colorFromCss(value: string, fallback = "#7dd3fc"): THREE.Color {
  const match = value.match(/rgb\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  if (!match) return new THREE.Color(fallback);
  return new THREE.Color(Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255);
}

function nodeDepth(node: IdentityGraphAtlasNode): number {
  if (node.kind === "friend_person") {
    const tierBoost = node.priority >= 980 ? 90 : node.priority >= 880 ? 64 : 36;
    return tierBoost + Math.min(46, Math.sqrt(node.activityCount + 1) * 2.8);
  }
  if (node.kind === "connection_person") return 16 + Math.min(22, Math.sqrt(node.activityCount + 1) * 1.3);
  if (node.kind === "account") return -30 - seededUnit(node.id) * 46;
  if (node.kind === "feed") return -48 - seededUnit(node.id) * 52;
  return -128;
}

function nodePointSize(
  node: IdentityGraphAtlasNode,
  selected: boolean,
  hovered: boolean,
  quality: IdentityGraphAtlasQuality,
): number {
  const roleSize = node.kind === "friend_person"
    ? 34
    : node.kind === "connection_person"
      ? 28
      : node.kind === "provider_cluster"
        ? 40
        : node.kind === "feed"
          ? 20
          : 22;
  const size = roleSize + node.radius * 1.05 + (selected ? 22 : hovered ? 12 : 0);
  return Math.max(8, size * (quality === "interactive" ? 0.78 : 1));
}

function graphNodeColor(
  node: IdentityGraphAtlasNode,
  palette: GraphPalette,
  selected: boolean,
  linkedToSelected: boolean,
  hovered: boolean,
): THREE.Color {
  if (selected) return colorFromCss(palette.selection, "#67e8f9");
  if (hovered || linkedToSelected) return colorFromCss(palette.highlight, "#f0abfc");
  if (node.kind === "friend_person") return colorFromCss(palette.friendStroke, "#60a5fa");
  if (node.kind === "connection_person") return colorFromCss(palette.connectionStroke, "#c084fc");
  if (node.kind === "feed") return new THREE.Color("#f59e0b");
  return colorFromCss(providerColor(node.provider, palette), "#38bdf8");
}

function makePointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      pixelRatio: { value: Math.min(1.5, window.devicePixelRatio || 1) },
    },
    vertexShader: `
      attribute float pointSize;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float depthScale = clamp(940.0 / max(280.0, -mvPosition.z), 0.68, 2.35);
        gl_PointSize = pointSize * depthScale;
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = clamp(pointSize / 48.0, 0.36, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(center);
        float core = smoothstep(0.34, 0.02, distanceFromCenter);
        float halo = smoothstep(0.5, 0.08, distanceFromCenter) * 0.52;
        float alpha = max(core, halo) * vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    vertexColors: true,
  });
}

function makeStarGeometry(count: number, width: number, height: number, palette: GraphPalette): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const themeColors = [
    colorFromCss(palette.text, "#f8fafc"),
    colorFromCss(palette.friendStroke, "#93c5fd"),
    colorFromCss(palette.connectionStroke, "#c4b5fd"),
    colorFromCss(palette.accountFill, "#67e8f9"),
    colorFromCss(palette.feedFill, "#fbbf24"),
  ];
  const span = Math.max(width, height, 1) * 8.5;
  for (let index = 0; index < count; index += 1) {
    const seed = `star:${index}`;
    const angle = seededUnit(`${seed}:angle`) * Math.PI * 2;
    const radius = Math.sqrt(seededUnit(`${seed}:radius`)) * span;
    const arm = Math.sin(angle * 3 + seededUnit(`${seed}:arm`) * 4) * span * 0.055;
    positions[index * 3] = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * arm;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.64 + Math.sin(angle + Math.PI / 2) * arm;
    positions[index * 3 + 2] = -360 - seededUnit(`${seed}:depth`) * 2_600;
    const color = themeColors[Math.floor(seededUnit(`${seed}:color`) * themeColors.length)] ?? themeColors[0]!;
    const brightness = 0.2 + seededUnit(`${seed}:brightness`) * 0.68;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
    sizes[index] = 1.2 + seededUnit(`${seed}:size`) * 4.4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

function drawFallbackStarfield(
  canvas: HTMLCanvasElement,
  atlas: IdentityGraphAtlas,
  transform: ViewTransform,
  palette: GraphPalette,
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.85);
  gradient.addColorStop(0, palette.surface);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 2_800; index += 1) {
    const x = seededUnit(`fallback-star-x:${index}`) * width;
    const y = seededUnit(`fallback-star-y:${index}`) * height;
    const depth = seededUnit(`fallback-star-z:${index}`);
    context.globalAlpha = 0.08 + depth * 0.34;
    context.fillStyle = index % 7 === 0 ? palette.friendStroke : palette.mutedText;
    context.fillRect(x, y, 1 + depth * 1.8, 1 + depth * 1.8);
  }
  context.globalAlpha = 1;

  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.scale, transform.scale);
  for (const region of atlas.regions) {
    context.beginPath();
    context.ellipse(region.x, region.y, region.radiusX, region.radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.12)");
    context.strokeStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.38)");
    context.lineWidth = 1.2 / transform.scale;
    context.fill();
    context.stroke();
  }
  for (const node of atlas.nodes) {
    const selected =
      (!!node.personId && node.personId === selectedPersonId) ||
      (!!node.accountId && node.accountId === selectedAccountId);
    const depth = nodeDepth(node);
    const parallax = 1 + Math.max(-0.24, Math.min(0.42, depth / 260));
    const radius = Math.max(5, node.radius * 0.82 * parallax + (selected ? 7 : 0));
    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = node.kind === "friend_person"
      ? palette.friendStroke
      : node.kind === "connection_person"
        ? palette.connectionStroke
        : providerColor(node.provider, palette);
    context.shadowBlur = selected ? 20 / transform.scale : 8 / transform.scale;
    context.shadowColor = context.fillStyle;
    context.fill();
    context.shadowBlur = 0;
  }
  context.restore();
}

class StarfieldGraphRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 8_000);
  private readonly graphGroup = new THREE.Group();
  private readonly regionGroup = new THREE.Group();
  private readonly labelGroup = new THREE.Group();
  private readonly nodeGeometry = new THREE.BufferGeometry();
  private readonly nodeMaterial = makePointMaterial();
  private readonly nodePoints: THREE.Points;
  private readonly edgeGeometry = new THREE.BufferGeometry();
  private readonly edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly edgeLines: THREE.LineSegments;
  private readonly starMaterial = makePointMaterial();
  private starPoints: THREE.Points | null = null;
  private labels: TroikaText[] = [];
  private width = 1;
  private height = 1;
  private starCount = 0;
  private paletteKey = "";
  private pixelRatio = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    }) as WebGL2RenderingContext | null;
    if (!context) {
      throw new Error("WebGL unavailable");
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = false;
    this.scene.add(this.graphGroup);
    this.scene.add(this.labelGroup);
    this.graphGroup.add(this.regionGroup);
    this.edgeLines = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.graphGroup.add(this.edgeLines);
    this.nodePoints = new THREE.Points(this.nodeGeometry, this.nodeMaterial);
    this.nodePoints.frustumCulled = false;
    this.graphGroup.add(this.nodePoints);
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
    if (this.width === nextWidth && this.height === nextHeight && this.pixelRatio === pixelRatio) {
      return;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.position.set(0, 0, this.height / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.nodeMaterial.uniforms.pixelRatio.value = pixelRatio;
    this.starMaterial.uniforms.pixelRatio.value = pixelRatio;
  }

  syncScene(
    atlas: IdentityGraphAtlas,
    palette: GraphPalette,
    selectedPersonId: string | null | undefined,
    selectedAccountId: string | null | undefined,
    hoveredNodeId: string | null,
    variation: StarfieldVariation,
    quality: IdentityGraphAtlasQuality,
  ): void {
    if (this.disposed) return;
    const nextPaletteKey = [
      palette.surface,
      palette.text,
      palette.friendStroke,
      palette.connectionStroke,
      palette.accountFill,
      palette.feedFill,
    ].join("|");
    const smallViewport = this.width <= 720 || this.height <= 620;
    const starBudget = smallViewport
      ? { min: 3_000, max: 7_000, perSource: 2 }
      : { min: 5_000, max: 12_000, perSource: 3 };
    const nextStarCount = Math.max(
      starBudget.min,
      Math.min(starBudget.max, atlas.metrics.sourceNodeCount * starBudget.perSource),
    );
    if (nextStarCount !== this.starCount || nextPaletteKey !== this.paletteKey || !this.starPoints) {
      if (this.starPoints) {
        this.scene.remove(this.starPoints);
        this.starPoints.geometry.dispose();
      }
      this.starPoints = new THREE.Points(makeStarGeometry(nextStarCount, this.width, this.height, palette), this.starMaterial);
      this.starPoints.frustumCulled = false;
      this.scene.add(this.starPoints);
      this.starCount = nextStarCount;
      this.paletteKey = nextPaletteKey;
    }
    this.syncRegions(atlas, palette, variation);
    this.edgeMaterial.color.copy(colorFromCss(palette.edge, "#7dd3fc"));
    this.edgeMaterial.opacity = quality === "interactive" ? 0.26 : 0.58;
    this.syncEdges(atlas);
    this.syncNodes(atlas, palette, selectedPersonId, selectedAccountId, hoveredNodeId, quality);
    this.syncLabels(atlas, palette, quality);
  }

  render(transform: ViewTransform, quality: IdentityGraphAtlasQuality): void {
    if (this.disposed) return;
    this.applyTransform(transform);
    if (this.starPoints) {
      this.starPoints.visible = quality !== "interactive";
      this.starPoints.position.set(
        (transform.x - this.width / 2) * 0.055,
        (this.height / 2 - transform.y) * 0.055,
        0,
      );
      this.starPoints.scale.setScalar(1.01 + transform.scale * 0.018);
    }
    this.regionGroup.visible = quality !== "interactive";
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.clearRegions();
    this.clearLabels();
    this.nodeGeometry.dispose();
    this.nodeMaterial.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();
    if (this.starPoints) {
      this.starPoints.geometry.dispose();
    }
    this.starMaterial.dispose();
    this.renderer.dispose();
  }

  private applyTransform(transform: ViewTransform): void {
    this.graphGroup.position.set(transform.x - this.width / 2, this.height / 2 - transform.y, 0);
    this.graphGroup.scale.set(transform.scale, transform.scale, transform.scale);
    this.labelGroup.position.copy(this.graphGroup.position);
    this.labelGroup.scale.copy(this.graphGroup.scale);
    for (const label of this.labels) {
      label.quaternion.copy(this.camera.quaternion);
    }
  }

  private nodePosition(node: IdentityGraphAtlasNode): THREE.Vector3 {
    return new THREE.Vector3(node.x, -node.y, nodeDepth(node));
  }

  private clearRegions(): void {
    for (const child of this.regionGroup.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      }
    }
    this.regionGroup.clear();
  }

  private syncRegions(atlas: IdentityGraphAtlas, palette: GraphPalette, variation: StarfieldVariation): void {
    this.clearRegions();
    for (const region of atlas.regions) {
      const color = colorFromCss(providerColor(region.provider, palette), "#38bdf8");
      if (variation === "nebula-rings" || variation === "nebula") {
        const haze = new THREE.Mesh(
          new THREE.CircleGeometry(1, 128),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.105,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        haze.position.set(region.x, -region.y, -170);
        haze.scale.set(region.radiusX, region.radiusY, 1);
        this.regionGroup.add(haze);
      }
      if (variation === "nebula-rings" || variation === "rings") {
        const points = Array.from({ length: 97 }, (_, index) => {
          const angle = (index / 96) * Math.PI * 2;
          return new THREE.Vector3(
            region.x + Math.cos(angle) * region.radiusX,
            -region.y + Math.sin(angle) * region.radiusY,
            -92,
          );
        });
        const ring = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        this.regionGroup.add(ring);
      }
    }
  }

  private syncEdges(atlas: IdentityGraphAtlas): void {
    const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));
    const positions = new Float32Array(atlas.edges.length * 6);
    let offset = 0;
    for (const edge of atlas.edges) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target) continue;
      const sourcePoint = this.nodePosition(source);
      const targetPoint = this.nodePosition(target);
      positions[offset] = sourcePoint.x;
      positions[offset + 1] = sourcePoint.y;
      positions[offset + 2] = sourcePoint.z - 8;
      positions[offset + 3] = targetPoint.x;
      positions[offset + 4] = targetPoint.y;
      positions[offset + 5] = targetPoint.z - 8;
      offset += 6;
    }
    this.edgeGeometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, offset), 3));
    this.edgeGeometry.computeBoundingSphere();
  }

  private syncNodes(
    atlas: IdentityGraphAtlas,
    palette: GraphPalette,
    selectedPersonId: string | null | undefined,
    selectedAccountId: string | null | undefined,
    hoveredNodeId: string | null,
    quality: IdentityGraphAtlasQuality,
  ): void {
    const positions = new Float32Array(atlas.nodes.length * 3);
    const colors = new Float32Array(atlas.nodes.length * 3);
    const sizes = new Float32Array(atlas.nodes.length);
    for (let index = 0; index < atlas.nodes.length; index += 1) {
      const node = atlas.nodes[index]!;
      const selected =
        (!!node.personId && node.personId === selectedPersonId) ||
        (!!node.accountId && node.accountId === selectedAccountId);
      const linkedToSelected = !!selectedPersonId && node.linkedPersonId === selectedPersonId;
      const hovered = node.id === hoveredNodeId;
      const point = this.nodePosition(node);
      const color = graphNodeColor(node, palette, selected, linkedToSelected, hovered);
      const muted = selectedPersonId || selectedAccountId
        ? selected || linkedToSelected || hovered ? 1 : 0.34
        : 1;
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      colors[index * 3] = color.r * muted;
      colors[index * 3 + 1] = color.g * muted;
      colors[index * 3 + 2] = color.b * muted;
      sizes[index] = nodePointSize(node, selected, hovered, quality);
    }
    this.nodeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.nodeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.nodeGeometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
    this.nodeGeometry.computeBoundingSphere();
  }

  private clearLabels(): void {
    for (const label of this.labels) {
      this.labelGroup.remove(label);
      label.dispose();
    }
    this.labels = [];
  }

  private syncLabels(atlas: IdentityGraphAtlas, palette: GraphPalette, quality: IdentityGraphAtlasQuality): void {
    this.clearLabels();
    if (quality === "interactive") return;
    const cap = window.innerWidth < 720 ? 44 : 110;
    for (const label of atlas.labels.slice(0, cap)) {
      const text = new TroikaText();
      text.text = label.text;
      text.fontSize = label.kind === "provider_cluster"
        ? 26
        : label.kind === "friend_person"
          ? 19
          : label.kind === "connection_person"
            ? 17
            : 15;
      text.anchorX = "center";
      text.anchorY = "middle";
      text.color = colorFromCss(palette.text, "#f8fafc");
      text.outlineColor = colorFromCss(palette.labelFill, "#020617");
      text.outlineWidth = label.kind === "provider_cluster" ? "8%" : "10%";
      text.position.set(label.x, -label.y - 24 / Math.max(0.7, label.priority / 600), label.kind === "provider_cluster" ? -38 : 86);
      text.renderOrder = 10;
      text.sync();
      this.labels.push(text);
      this.labelGroup.add(text);
    }
  }
}

export const FriendGraph = forwardRef<FriendGraphHandle, FriendGraphProps>(function FriendGraph(
  {
    persons,
    accounts,
    feeds,
    feedItems,
    activitySummaries: activitySummariesProp,
    mode,
    selectedPersonId,
    selectedAccountId,
    onSelectPerson,
    onSelectAccount,
    onClearSelection,
    onLinkAccountToPerson,
    onPinPersonPosition,
    onPinAccountPosition,
    onDropNodeToRelationshipTier,
    friendSuggestionStrengthByPerson,
    friendSuggestionStrengthByAccount,
    themeId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StarfieldGraphRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const atlasRef = useRef<IdentityGraphAtlas | null>(null);
  const webglUnavailableRef = useRef(false);
  const hitBucketsRef = useRef<Map<string, string[]>>(new Map());
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const activeTouchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const hoveredNodeIdRef = useRef<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const latestResolvedRequestIdRef = useRef(0);
  const pendingWorkerTimeoutsRef = useRef<Map<number, number>>(new Map());
  const atlasRafRef = useRef(0);
  const drawRafRef = useRef(0);
  const drawPendingRef = useRef(false);
  const sceneDirtyRef = useRef(true);
  const settleTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const hasFittedInitialAtlasRef = useRef(false);
  const hasUserAdjustedTransformRef = useRef(false);
  const mountedAtRef = useRef(nowMs());
  const firstVisibleMsRef = useRef(0);
  const frameSamplesRef = useRef<number[]>([]);
  const lastFrameAtRef = useRef<number | null>(null);
  const longTaskCountRef = useRef(0);
  const latestQualityRef = useRef<IdentityGraphAtlasQuality>("settled");
  const paletteKeyRef = useRef("");
  const paletteRef = useRef<GraphPalette | null>(null);
  const viewportInsetsRef = useRef<GraphViewportInsets>(EMPTY_GRAPH_VIEWPORT_INSETS);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 640 });
  const [viewportInsets, setViewportInsets] = useState<GraphViewportInsets>(EMPTY_GRAPH_VIEWPORT_INSETS);
  const [atlasReady, setAtlasReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
  const [linkPickerAccountId, setLinkPickerAccountId] = useState<string | null>(null);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [starfieldVariation, setStarfieldVariation] = useState<StarfieldVariation>("nebula-rings");

  const activitySummaries = useMemo(
    () => activitySummariesProp ?? buildIdentityGraphActivitySummaries(feedItems ?? {}),
    [activitySummariesProp, feedItems],
  );
  const personsById = useMemo(
    () => Object.fromEntries(persons.map((person) => [person.id, person])),
    [persons],
  );
  const personPickerOptions = useMemo(() => {
    const query = linkPickerQuery.trim().toLowerCase();
    return persons
      .filter((person) => {
        if (!query) return true;
        return person.name.toLowerCase().includes(query) ||
          person.notes?.toLowerCase().includes(query);
      })
      .sort((left, right) => {
        const leftFriend = left.relationshipStatus === "friend" ? 0 : 1;
        const rightFriend = right.relationshipStatus === "friend" ? 0 : 1;
        if (leftFriend !== rightFriend) return leftFriend - rightFriend;
        return left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }, [linkPickerQuery, persons]);
  const personCount = persons.length;
  const channelCount = Object.values(accounts).filter((account) => account.kind === "social").length +
    Object.values(feeds).filter((feed) => feed.enabled !== false).length;
  const canonicalNodeCount = personCount + channelCount;
  const visiblePersonIds = useMemo(
    () => new Set(persons.filter((person) => mode === "all_content" || person.relationshipStatus === "friend").map((person) => person.id)),
    [mode, persons],
  );
  const canonicalLinkCount = useMemo(
    () =>
      Object.values(accounts).filter((account) =>
        account.kind === "social" &&
        !!account.personId &&
        visiblePersonIds.has(account.personId),
      ).length,
    [accounts, visiblePersonIds],
  );
  const friendSuggestionStrengthByPersonRecord = useMemo(
    () => buildSuggestionRecord(friendSuggestionStrengthByPerson),
    [friendSuggestionStrengthByPerson],
  );
  const friendSuggestionStrengthByAccountRecord = useMemo(
    () => buildSuggestionRecord(friendSuggestionStrengthByAccount),
    [friendSuggestionStrengthByAccount],
  );

  const getPalette = useCallback(() => {
    const key = themeId ?? "default";
    if (!paletteRef.current || paletteKeyRef.current !== key) {
      paletteKeyRef.current = key;
      paletteRef.current = readGraphPalette(containerRef.current);
    }
    return paletteRef.current;
  }, [themeId]);

  const exposeDiagnostics = useCallback((atlas: IdentityGraphAtlas, sceneSyncMs: number) => {
    const sourceNodeCount = canonicalNodeCount;
    const visibleNodeCount = atlas.metrics.visibleNodeCount;
    const p95Samples = [...frameSamplesRef.current].sort((left, right) => left - right);
    const frameP95Ms = p95Samples[Math.floor(p95Samples.length * 0.95)] ?? 0;
    const perf: GraphSurfacePerfSnapshot = {
      modelBuildMs: activitySummaries.buildMs,
      layoutMs: atlas.metrics.buildMs,
      sceneSyncMs,
      labelPassMs: 0,
      sceneSyncCount: ((window as typeof window & { __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot }).__FREED_GRAPH_PERF__?.sceneSyncCount ?? 0) + 1,
      contentSyncCount: 1,
      transformOnlySyncCount: latestQualityRef.current === "interactive" ? 1 : 0,
      edgeRebuildCount: atlas.edges.length > 0 ? 1 : 0,
      nodeRestyleCount: visibleNodeCount,
      labelLayoutCount: atlas.labels.length > 0 ? 1 : 0,
      avatarDisplayCount: 0,
      visibleLabelCount: atlas.labels.length,
      visibleNodeLabelCount: atlas.labels.filter((label) => label.kind !== "provider_cluster").length,
      visibleProviderLabelCount: atlas.labels.filter((label) => label.kind === "provider_cluster").length,
      denseRenderMode: sourceNodeCount >= 1_200 ? "dense" : "containers",
      denseInteractionEligible: sourceNodeCount >= 1_200,
      denseInteractionNodeCount: latestQualityRef.current === "interactive" ? visibleNodeCount : 0,
      denseInteractionCulled: atlas.metrics.capped,
      denseInteractionRebuildCount: atlas.metrics.capped ? 1 : 0,
      qualityMode: latestQualityRef.current,
      sourceNodeCount,
      visibleNodeCount,
      renderedPrimitiveCount: atlas.metrics.renderedPrimitiveCount,
      firstVisibleMs: firstVisibleMsRef.current,
      frameP95Ms,
      longTaskCount: longTaskCountRef.current,
      memoryEstimateBytes: estimateMemoryBytes(atlas),
      rendererType: webglUnavailableRef.current ? "canvas-starfield-fallback" : "three-starfield",
      touchInputMode: "pointer-events",
      lod: atlas.metrics.lod,
      capped: atlas.metrics.capped,
      nodeCount: sourceNodeCount,
      linkCount: canonicalLinkCount,
      personCount,
      channelCount,
      transformScale: transformRef.current.scale,
    };
    const container = containerRef.current;
    if (container) {
      container.dataset.graphNodeCount = String(sourceNodeCount);
      container.dataset.graphLinkCount = String(canonicalLinkCount);
      container.dataset.graphPersonCount = String(personCount);
      container.dataset.graphChannelCount = String(channelCount);
      container.dataset.visibleLabelCount = String(atlas.labels.length);
      container.dataset.graphQualityMode = latestQualityRef.current;
      container.dataset.graphVisibleNodeCount = String(visibleNodeCount);
      container.dataset.graphRenderer = webglUnavailableRef.current ? "canvas-starfield-fallback" : "three-starfield";
    }
    (window as typeof window & { __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot }).__FREED_GRAPH_PERF__ = perf;
    if (shouldExposeGraphDebug()) {
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: {
          nodes: GraphDebugNode[];
          regions: IdentityGraphAtlas["regions"];
          transform: ViewTransform;
          qualityMode: "interactive" | "settled";
          metrics: GraphPerfSnapshot;
        };
      }).__FREED_GRAPH_DEBUG__ = {
        nodes: buildGraphDebugNodes(atlas.nodes),
        regions: atlas.regions,
        transform: transformRef.current,
        qualityMode: latestQualityRef.current,
        metrics: perf,
      };
    }
  }, [activitySummaries.buildMs, canonicalLinkCount, canonicalNodeCount, channelCount, personCount]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const atlas = atlasRef.current;
    if (!canvas || !atlas) return;
    try {
      let renderer = rendererRef.current;
      if (!renderer && !webglUnavailableRef.current) {
        renderer = new StarfieldGraphRenderer(canvas);
        rendererRef.current = renderer;
      }
      const frameAt = nowMs();
      if (lastFrameAtRef.current !== null) {
        const delta = frameAt - lastFrameAtRef.current;
        frameSamplesRef.current.push(delta);
        if (frameSamplesRef.current.length > 160) {
          frameSamplesRef.current.shift();
        }
      }
      lastFrameAtRef.current = frameAt;
      const startedAt = nowMs();
      if (renderer) {
        renderer.resize(canvasSize.width, canvasSize.height);
        if (sceneDirtyRef.current) {
          renderer.syncScene(
            atlas,
            getPalette(),
            selectedPersonId,
            selectedAccountId,
            hoveredNodeIdRef.current,
            starfieldVariation,
            latestQualityRef.current,
          );
          sceneDirtyRef.current = false;
        }
        renderer.render(transformRef.current, latestQualityRef.current);
      } else {
        drawFallbackStarfield(
          canvas,
          atlas,
          transformRef.current,
          getPalette(),
          selectedPersonId,
          selectedAccountId,
        );
      }
      if (!firstVisibleMsRef.current && atlas.nodes.length > 0) {
        firstVisibleMsRef.current = nowMs() - mountedAtRef.current;
      }
      exposeDiagnostics(atlas, nowMs() - startedAt);
    } catch (error) {
      if (error instanceof Error && error.message === "WebGL unavailable") {
        webglUnavailableRef.current = true;
        drawFallbackStarfield(
          canvas,
          atlas,
          transformRef.current,
          getPalette(),
          selectedPersonId,
          selectedAccountId,
        );
        if (!firstVisibleMsRef.current && atlas.nodes.length > 0) {
          firstVisibleMsRef.current = nowMs() - mountedAtRef.current;
        }
        exposeDiagnostics(atlas, 0);
        return;
      }
      (window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string }).__FREED_GRAPH_DRAW_ERROR__ =
        error instanceof Error ? error.message : String(error);
      console.warn("[friends-graph] starfield draw failed", error);
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    exposeDiagnostics,
    getPalette,
    selectedAccountId,
    selectedPersonId,
    starfieldVariation,
  ]);

  const scheduleDraw = useCallback(() => {
    if (drawPendingRef.current) return;
    drawPendingRef.current = true;
    drawRafRef.current = requestAnimationFrame(() => {
      drawPendingRef.current = false;
      draw();
    });
  }, [draw]);

  const applyAtlas = useCallback((requestId: number, atlas: IdentityGraphAtlas, durationMs: number) => {
    if (requestId < latestResolvedRequestIdRef.current) return;
    const timeout = pendingWorkerTimeoutsRef.current.get(requestId);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      pendingWorkerTimeoutsRef.current.delete(requestId);
    }
    latestResolvedRequestIdRef.current = requestId;
    atlas.metrics.buildMs = durationMs;
    atlasRef.current = atlas;
    hitBucketsRef.current = buildHitBucketMap(atlas);
    sceneDirtyRef.current = true;
    if (!hasFittedInitialAtlasRef.current && !hasUserAdjustedTransformRef.current) {
      transformRef.current = fitTransformToVisibleAtlasBounds(
        atlas.bounds,
        canvasSize.width,
        canvasSize.height,
        FIT_PADDING,
        viewportInsetsRef.current,
      );
      hasFittedInitialAtlasRef.current = true;
    }
    setAtlasReady(true);
    draw();
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, draw, scheduleDraw]);

  const runAtlasOnMainThread = useCallback((requestId: number, input: BuildIdentityGraphAtlasInput) => {
    window.setTimeout(() => {
      const startedAt = nowMs();
      const atlas = buildIdentityGraphAtlas(input);
      applyAtlas(requestId, atlas, nowMs() - startedAt);
    }, 0);
  }, [applyAtlas]);

  const requestAtlas = useCallback((quality: IdentityGraphAtlasQuality) => {
    latestQualityRef.current = quality;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const input: BuildIdentityGraphAtlasInput = {
      persons,
      accounts,
      feeds,
      activitySummaries,
      mode,
      transform: transformRef.current,
      width: canvasSize.width,
      height: canvasSize.height,
      quality,
      selectedPersonId,
      selectedAccountId,
      friendSuggestionStrengthByPerson: friendSuggestionStrengthByPersonRecord,
      friendSuggestionStrengthByAccount: friendSuggestionStrengthByAccountRecord,
    };
    const worker = workerRef.current;
    if (!worker) {
      runAtlasOnMainThread(requestId, input);
      return;
    }
    const timeout = window.setTimeout(() => {
      pendingWorkerTimeoutsRef.current.delete(requestId);
      if (requestId < latestResolvedRequestIdRef.current) return;
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
      }
      runAtlasOnMainThread(requestId, input);
    }, GRAPH_LAYOUT_WORKER_TIMEOUT_MS);
    pendingWorkerTimeoutsRef.current.set(requestId, timeout);
    worker.postMessage({ requestId, ...input });
  }, [
    accounts,
    activitySummaries,
    canvasSize.height,
    canvasSize.width,
    feeds,
    friendSuggestionStrengthByAccountRecord,
    friendSuggestionStrengthByPersonRecord,
    mode,
    persons,
    runAtlasOnMainThread,
    selectedAccountId,
    selectedPersonId,
  ]);

  const scheduleAtlas = useCallback((quality: IdentityGraphAtlasQuality) => {
    window.cancelAnimationFrame(atlasRafRef.current);
    atlasRafRef.current = window.requestAnimationFrame(() => requestAtlas(quality));
  }, [requestAtlas]);

  const markInteractive = useCallback(() => {
    const wasInteractive = latestQualityRef.current === "interactive";
    latestQualityRef.current = "interactive";
    scheduleDraw();
    if (!wasInteractive) {
      sceneDirtyRef.current = true;
      scheduleAtlas("interactive");
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    const sourceCount = atlasRef.current?.metrics.sourceNodeCount ?? 0;
    const delay = sourceCount >= 1_200 ? DENSE_INTERACTION_SETTLE_DELAY_MS : INTERACTION_SETTLE_DELAY_MS;
    const settleWhenIdle = () => {
      if (dragStateRef.current || pinchStateRef.current || activeTouchPointsRef.current.size > 0) {
        settleTimerRef.current = window.setTimeout(settleWhenIdle, delay);
        return;
      }
      latestQualityRef.current = "settled";
      settleTimerRef.current = null;
      requestAtlas("settled");
    };
    settleTimerRef.current = window.setTimeout(settleWhenIdle, delay);
  }, [requestAtlas, scheduleAtlas, scheduleDraw]);

  const viewportToWorld = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - transformRef.current.x) / transformRef.current.scale,
      y: (clientY - rect.top - transformRef.current.y) / transformRef.current.scale,
    };
  }, []);

  const hitNodeAt = useCallback((clientX: number, clientY: number) => {
    const atlas = atlasRef.current;
    if (!atlas) return null;
    const point = viewportToWorld(clientX, clientY);
    return findHitNode(atlas, hitBucketsRef.current, point.x, point.y);
  }, [viewportToWorld]);

  const openNodeContextMenu = useCallback((clientX: number, clientY: number) => {
    const node = hitNodeAt(clientX, clientY);
    if (!node || node.kind === "provider_cluster") {
      setContextMenu(null);
      return false;
    }
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const point = viewportToWorld(clientX, clientY);
    setContextMenu({
      x: rect ? clientX - rect.left : clientX,
      y: rect ? clientY - rect.top : clientY,
      worldX: point.x,
      worldY: point.y,
      node,
    });
    setLinkPickerAccountId(null);
    setLinkPickerQuery("");
    return true;
  }, [hitNodeAt, viewportToWorld]);

  const fitAll = useCallback(() => {
    const atlas = atlasRef.current;
    if (!atlas) return;
    transformRef.current = fitTransformToVisibleAtlasBounds(
      atlas.bounds,
      canvasSize.width,
      canvasSize.height,
      FIT_PADDING,
      viewportInsetsRef.current,
    );
    hasUserAdjustedTransformRef.current = true;
    requestAtlas("settled");
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, requestAtlas, scheduleDraw]);

  const focusNode = useCallback((id: string) => {
    const atlas = atlasRef.current;
    if (!atlas) return;
    const hit = atlas.nodes.find((node) => node.id === id || node.personId === id || node.accountId === id);
    if (!hit) return;
    const scale = Math.max(transformRef.current.scale, 0.92);
    const center = visibleViewportCenter(canvasSize.width, canvasSize.height, viewportInsetsRef.current);
    transformRef.current = {
      x: center.x - hit.x * scale,
      y: center.y - hit.y * scale,
      scale,
    };
    hasUserAdjustedTransformRef.current = true;
    requestAtlas("settled");
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, requestAtlas, scheduleDraw]);

  useImperativeHandle(ref, () => ({ fitAll, focusNode }), [fitAll, focusNode]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../lib/identity-graph-atlas.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<AtlasResponse>) => {
      applyAtlas(event.data.requestId, event.data.atlas, event.data.durationMs);
    };
    worker.onerror = () => {
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    return () => {
      for (const timeout of pendingWorkerTimeoutsRef.current.values()) {
        window.clearTimeout(timeout);
      }
      pendingWorkerTimeoutsRef.current.clear();
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, [applyAtlas]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const containerRect = container.getBoundingClientRect();
      const mainRect = container.closest("main")?.getBoundingClientRect();
      const nextInsets = mainRect
        ? {
            top: Math.max(0, Math.round(mainRect.top - containerRect.top)),
            right: Math.max(0, Math.round(containerRect.right - mainRect.right)),
            bottom: Math.max(0, Math.round(containerRect.bottom - mainRect.bottom)),
            left: Math.max(0, Math.round(mainRect.left - containerRect.left)),
          }
        : EMPTY_GRAPH_VIEWPORT_INSETS;
      viewportInsetsRef.current = nextInsets;
      setViewportInsets((current) =>
        sameGraphViewportInsets(current, nextInsets) ? current : nextInsets,
      );
      setCanvasSize({
        width: Math.max(320, container.clientWidth),
        height: Math.max(320, container.clientHeight || 640),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    const main = container.closest("main");
    if (main) observer.observe(main);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    requestAtlas("settled");
  }, [requestAtlas]);

  useEffect(() => {
    if (!atlasReady) return;
    rendererRef.current?.resize(canvasSize.width, canvasSize.height);
    scheduleDraw();
  }, [atlasReady, canvasSize.height, canvasSize.width, scheduleDraw]);

  useEffect(() => {
    if (!atlasReady) return;
    const atlas = atlasRef.current;
    if (atlas && !hasUserAdjustedTransformRef.current) {
      transformRef.current = fitTransformToVisibleAtlasBounds(
        atlas.bounds,
        canvasSize.width,
        canvasSize.height,
        FIT_PADDING,
        viewportInsets,
      );
    }
    requestAtlas("settled");
    scheduleDraw();
  }, [atlasReady, canvasSize.height, canvasSize.width, requestAtlas, scheduleDraw, viewportInsets]);

  useEffect(() => {
    paletteKeyRef.current = "";
    sceneDirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, themeId]);

  useEffect(() => {
    sceneDirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, selectedAccountId, selectedPersonId, starfieldVariation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preventGestureDefault = (event: Event) => event.preventDefault();
    container.addEventListener("gesturestart", preventGestureDefault, { passive: false });
    container.addEventListener("gesturechange", preventGestureDefault, { passive: false });
    container.addEventListener("gestureend", preventGestureDefault, { passive: false });
    return () => {
      container.removeEventListener("gesturestart", preventGestureDefault);
      container.removeEventListener("gesturechange", preventGestureDefault);
      container.removeEventListener("gestureend", preventGestureDefault);
    };
  }, []);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        longTaskCountRef.current += list.getEntries().length;
      });
      observer.observe({ type: "longtask", buffered: false });
      return () => observer.disconnect();
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      window.cancelAnimationFrame(atlasRafRef.current);
      window.cancelAnimationFrame(drawRafRef.current);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const current = transformRef.current;
    const scale = clampScale(nextScale);
    const worldX = (localX - current.x) / current.scale;
    const worldY = (localY - current.y) / current.scale;
    transformRef.current = {
      scale,
      x: localX - worldX * scale,
      y: localY - worldY * scale,
    };
    hasUserAdjustedTransformRef.current = true;
    markInteractive();
  }, [markInteractive]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.exp(-event.deltaY * TRACKPAD_PINCH_ZOOM_SPEED);
      zoomAtPoint(event.clientX, event.clientY, transformRef.current.scale * delta);
      return;
    }
    if (event.shiftKey) {
      const delta = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
      zoomAtPoint(event.clientX, event.clientY, transformRef.current.scale * delta);
      return;
    }
    transformRef.current = {
      ...transformRef.current,
      x: transformRef.current.x - event.deltaX,
      y: transformRef.current.y - event.deltaY,
    };
    hasUserAdjustedTransformRef.current = true;
    markInteractive();
  }, [markInteractive, zoomAtPoint]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    container.setPointerCapture(event.pointerId);
    setContextMenu(null);
    setLinkPickerAccountId(null);

    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (activeTouchPointsRef.current.size >= 2) {
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        const [firstEntry, secondEntry] = [...activeTouchPointsRef.current.entries()];
        if (firstEntry && secondEntry) {
          const initialDistance = distanceBetween(firstEntry[1], secondEntry[1]);
          const initialMidpoint = midpointBetween(firstEntry[1], secondEntry[1]);
          pinchStateRef.current = {
            pointerIds: [firstEntry[0], secondEntry[0]],
            initialDistance,
            initialScale: transformRef.current.scale,
            initialMidpoint,
            initialWorldPoint: viewportToWorld(initialMidpoint.x, initialMidpoint.y),
            moved: false,
          };
          dragStateRef.current = null;
        }
      } else {
        longPressTimerRef.current = window.setTimeout(() => {
          if (activeTouchPointsRef.current.has(event.pointerId)) {
            dragStateRef.current = null;
            openNodeContextMenu(event.clientX, event.clientY);
            scheduleDraw();
          }
        }, 520);
        dragStateRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: transformRef.current.x,
          originY: transformRef.current.y,
          moved: false,
        };
      }
      overlayRef.current?.classList.add("cursor-grabbing");
      markInteractive();
      event.preventDefault();
      return;
    }

    dragStateRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      moved: false,
    };
    overlayRef.current?.classList.add("cursor-grabbing");
    markInteractive();
  }, [markInteractive, openNodeContextMenu, scheduleDraw, viewportToWorld]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      const first = activeTouchPointsRef.current.get(pinch.pointerIds[0]);
      const second = activeTouchPointsRef.current.get(pinch.pointerIds[1]);
      if (!first || !second || pinch.initialDistance <= 0) return;
      const currentDistance = distanceBetween(first, second);
      const midpoint = midpointBetween(first, second);
      pinch.moved = pinch.moved ||
        Math.abs(currentDistance - pinch.initialDistance) > 4 ||
        distanceBetween(midpoint, pinch.initialMidpoint) > 4;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scale = clampScale(pinch.initialScale * (currentDistance / pinch.initialDistance));
      const localX = midpoint.x - rect.left;
      const localY = midpoint.y - rect.top;
      transformRef.current = {
        scale,
        x: localX - pinch.initialWorldPoint.x * scale,
        y: localY - pinch.initialWorldPoint.y * scale,
      };
      hasUserAdjustedTransformRef.current = true;
      markInteractive();
      event.preventDefault();
      return;
    }

    const drag = dragStateRef.current;
    if (!drag) {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        const hit = hitNodeAt(event.clientX, event.clientY);
        const nextHovered = hit?.id ?? null;
        if (hoveredNodeIdRef.current !== nextHovered) {
          hoveredNodeIdRef.current = nextHovered;
          sceneDirtyRef.current = true;
          scheduleDraw();
        }
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    if (drag.moved && longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    transformRef.current = {
      ...transformRef.current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    hasUserAdjustedTransformRef.current = true;
    markInteractive();
    if (event.pointerType === "touch") event.preventDefault();
  }, [hitNodeAt, markInteractive, scheduleDraw]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      overlayRef.current?.classList.toggle("cursor-grabbing", activeTouchPointsRef.current.size > 0);
      requestAtlas("settled");
      return;
    }

    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");

    if (drag.moved) {
      requestAtlas("settled");
      return;
    }

    const hit = hitNodeAt(event.clientX, event.clientY);
    if (!hit) {
      onClearSelection?.();
      scheduleDraw();
      return;
    }
    if (hit.personId) {
      const person = personsById[hit.personId];
      if (person) onSelectPerson(person);
    } else if (hit.accountId) {
      const account = accounts[hit.accountId];
      if (account) onSelectAccount(account);
    }
    scheduleDraw();
  }, [
    accounts,
    hitNodeAt,
    onClearSelection,
    onSelectAccount,
    onSelectPerson,
    personsById,
    requestAtlas,
    scheduleDraw,
  ]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      sceneDirtyRef.current = true;
      scheduleDraw();
    }
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    dragStateRef.current = null;
    pinchStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");
  }, [scheduleDraw]);

  const handleCopyDiagnostics = useCallback(async () => {
    const debug = {
      perf: (window as typeof window & { __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot }).__FREED_GRAPH_PERF__ ?? null,
      debug: shouldExposeGraphDebug()
        ? (window as typeof window & { __FREED_GRAPH_DEBUG__?: unknown }).__FREED_GRAPH_DEBUG__ ?? null
        : null,
    };
    await navigator.clipboard?.writeText(JSON.stringify(debug, null, 2));
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openNodeContextMenu(event.clientX, event.clientY);
  }, [openNodeContextMenu]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setLinkPickerAccountId(null);
    setLinkPickerQuery("");
  }, []);

  const handleOpenContextDetails = useCallback(() => {
    const node = contextMenu?.node;
    if (!node) return;
    if (node.personId) {
      const person = personsById[node.personId];
      if (person) onSelectPerson(person);
    } else if (node.accountId) {
      const account = accounts[node.accountId];
      if (account) onSelectAccount(account);
    }
    closeContextMenu();
  }, [accounts, closeContextMenu, contextMenu, onSelectAccount, onSelectPerson, personsById]);

  const handlePinContextNode = useCallback(async () => {
    const menu = contextMenu;
    if (!menu) return;
    if (menu.node.personId) {
      await onPinPersonPosition?.(menu.node.personId, menu.worldX, menu.worldY);
    } else if (menu.node.accountId) {
      await onPinAccountPosition?.(menu.node.accountId, menu.worldX, menu.worldY);
    }
    closeContextMenu();
    requestAtlas("settled");
  }, [closeContextMenu, contextMenu, onPinAccountPosition, onPinPersonPosition, requestAtlas]);

  const handlePromoteContextNode = useCallback(async (level: 1 | 3 | 5) => {
    const node = contextMenu?.node;
    if (!node || !onDropNodeToRelationshipTier) return;
    await onDropNodeToRelationshipTier({
      personId: node.personId,
      accountId: node.accountId,
      level,
    });
    closeContextMenu();
    requestAtlas("settled");
  }, [closeContextMenu, contextMenu, onDropNodeToRelationshipTier, requestAtlas]);

  const handleStartLinkPicker = useCallback(() => {
    if (!contextMenu?.node.accountId) return;
    setLinkPickerAccountId(contextMenu.node.accountId);
    setLinkPickerQuery("");
  }, [contextMenu]);

  const handleLinkAccountToPickerPerson = useCallback(async (personId: string) => {
    if (!linkPickerAccountId || !onLinkAccountToPerson) return;
    await onLinkAccountToPerson(linkPickerAccountId, personId);
    closeContextMenu();
    requestAtlas("settled");
  }, [closeContextMenu, linkPickerAccountId, onLinkAccountToPerson, requestAtlas]);

  return (
    <div
      ref={containerRef}
      data-testid="friend-graph-viewport"
      className="theme-soft-viewport relative h-full w-full touch-none overscroll-contain"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
      onDoubleClick={(event) => event.preventDefault()}
      aria-label="Friends identity graph"
    >
      <div className="theme-soft-viewport-content">
        <canvas
          ref={canvasRef}
          data-testid="friend-graph-canvas"
          className="absolute inset-0 h-full w-full"
        />
        {!atlasReady ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-full border border-[color:rgb(var(--theme-border-rgb)/0.25)] bg-[color:rgb(var(--theme-surface-rgb)/0.8)] px-4 py-2 text-xs text-[color:var(--theme-text-muted)] backdrop-blur-sm">
              Building graph...
            </div>
          </div>
        ) : null}
        <div
          ref={overlayRef}
          data-testid="friend-graph-canvas-overlay"
          className="absolute inset-0 cursor-grab"
        />
      </div>
      {import.meta.env.DEV ? (
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-[color:rgb(var(--theme-border-rgb)/0.22)] bg-[color:rgb(var(--theme-surface-rgb)/0.78)] px-3 py-2 text-xs text-[color:var(--theme-text-secondary)] shadow-lg backdrop-blur-md">
          <span className="font-semibold text-[color:var(--theme-text-primary)]">Starfield</span>
          <select
            className="rounded-lg border border-[color:rgb(var(--theme-border-rgb)/0.24)] bg-[color:var(--theme-bg-card)] px-2 py-1 text-xs text-[color:var(--theme-text-primary)]"
            value={starfieldVariation}
            onChange={(event) => setStarfieldVariation(event.target.value as StarfieldVariation)}
            aria-label="Starfield variation"
          >
            <option value="nebula-rings">Nebula and rings</option>
            <option value="nebula">Nebula</option>
            <option value="rings">Rings</option>
          </select>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="theme-menu-shell absolute z-30 w-64 rounded-xl border border-[color:rgb(var(--theme-border-rgb)/0.24)] bg-[color:rgb(var(--theme-surface-rgb)/0.94)] p-2 text-sm text-[color:var(--theme-text-primary)] shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(contextMenu.x, Math.max(12, canvasSize.width - 272)),
            top: Math.min(contextMenu.y, Math.max(12, canvasSize.height - 360)),
          }}
          role="menu"
          data-testid="friend-graph-context-menu"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-2 pb-2">
            <p className="truncate text-sm font-semibold">{contextMenu.node.label}</p>
            <p className="text-xs text-[color:var(--theme-text-muted)]">
              {contextMenu.node.kind === "friend_person" ? "Person" : contextMenu.node.kind === "connection_person" ? "Connection" : contextMenu.node.provider ?? "Account"}
            </p>
          </div>
          {linkPickerAccountId ? (
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-[color:rgb(var(--theme-border-rgb)/0.24)] bg-[color:var(--theme-bg-card)] px-3 py-2 text-sm text-[color:var(--theme-text-primary)] outline-none"
                value={linkPickerQuery}
                onChange={(event) => setLinkPickerQuery(event.target.value)}
                placeholder="Search people"
                autoFocus
              />
              <div className="max-h-64 space-y-1 overflow-auto">
                {personPickerOptions.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[color:var(--theme-bg-card-hover)]"
                    onClick={() => void handleLinkAccountToPickerPerson(person.id)}
                  >
                    <span className="block truncate font-medium">{person.name}</span>
                    <span className="block text-xs text-[color:var(--theme-text-muted)]">
                      {person.relationshipStatus === "friend" ? "Friend" : "Connection"}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" className={`${CONTROL_BASE} w-full`} onClick={() => setLinkPickerAccountId(null)}>
                Back
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={handleOpenContextDetails}>
                Open details
              </button>
              {(contextMenu.node.personId || contextMenu.node.accountId) && (onPinPersonPosition || onPinAccountPosition) ? (
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={() => void handlePinContextNode()}>
                  Pin here
                </button>
              ) : null}
              {contextMenu.node.accountId && onLinkAccountToPerson ? (
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={handleStartLinkPicker}>
                  Link to person
                </button>
              ) : null}
              {onDropNodeToRelationshipTier ? (
                <>
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={() => void handlePromoteContextNode(1)}>
                    Mark followed
                  </button>
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={() => void handlePromoteContextNode(3)}>
                    Promote to Friend
                  </button>
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]" onClick={() => void handlePromoteContextNode(5)}>
                    Promote to Fam
                  </button>
                </>
              ) : null}
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[color:var(--theme-text-muted)] hover:bg-[color:var(--theme-bg-card-hover)]" onClick={closeContextMenu}>
                Close
              </button>
            </div>
          )}
        </div>
      ) : null}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <button type="button" className={CONTROL_BASE} onClick={fitAll}>
          Fit all
        </button>
        <button type="button" className={CONTROL_BASE} onClick={handleCopyDiagnostics}>
          Copy diagnostics
        </button>
      </div>
    </div>
  );
});
