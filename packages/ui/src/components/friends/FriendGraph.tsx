import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
  | {
      kind: "account-drag";
      pointerId: number;
      nodeId: string;
      accountId: string;
      startX: number;
      startY: number;
      moved: boolean;
      currentWorldX: number;
      currentWorldY: number;
      dropTargetPersonId: string | null;
    }
  | {
      kind: "person-drag";
      pointerId: number;
      nodeId: string;
      personId: string;
      startX: number;
      startY: number;
      moved: boolean;
      currentWorldX: number;
      currentWorldY: number;
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
  rendererType: "canvas-atlas";
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
const RELATIONSHIP_TIER_DROP_SELECTOR = "[data-friend-tier-drop-value]";

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

function relationshipTierDropLevelAt(clientX: number, clientY: number): 1 | 3 | 5 | null {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest<HTMLElement>(RELATIONSHIP_TIER_DROP_SELECTOR);
  const value = target?.dataset.friendTierDropValue;
  if (value === "1" || value === "3" || value === "5") {
    return Number(value) as 1 | 3 | 5;
  }
  return null;
}

function emitRelationshipTierDragOver(level: 1 | 3 | 5 | null): void {
  window.dispatchEvent(new CustomEvent("freed-friend-tier-dragover", { detail: { level } }));
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

function screenPointForPosition(position: { x: number; y: number }, transform: ViewTransform): TouchPoint {
  return {
    x: position.x * transform.scale + transform.x,
    y: position.y * transform.scale + transform.y,
  };
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

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, height / 2, width / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawAtlas(
  canvas: HTMLCanvasElement,
  atlas: IdentityGraphAtlas,
  transform: ViewTransform,
  palette: GraphPalette,
  hoveredNodeId: string | null,
  selectedPersonId: string | null | undefined,
  selectedAccountId: string | null | undefined,
  drag: DragState | null,
): number {
  const context = canvas.getContext("2d");
  if (!context) return 0;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.surface;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.scale, transform.scale);

  for (const region of atlas.regions) {
    context.beginPath();
    context.ellipse(region.x, region.y, region.radiusX, region.radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.12)");
    context.strokeStyle = providerColor(region.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.36)");
    context.lineWidth = 1.2 / transform.scale;
    context.fill();
    context.stroke();
  }

  const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));
  const draggedNodeId = drag?.kind === "account-drag" || drag?.kind === "person-drag" ? drag.nodeId : null;
  const nodePosition = (node: IdentityGraphAtlasNode): { x: number; y: number } => {
    if (draggedNodeId === node.id && drag && drag.kind !== "pan") {
      return {
        x: drag.currentWorldX,
        y: drag.currentWorldY,
      };
    }
    return node;
  };

  context.lineCap = "round";
  for (const edge of atlas.edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    const sourcePoint = nodePosition(source);
    const targetPoint = nodePosition(target);
    context.beginPath();
    context.moveTo(sourcePoint.x, sourcePoint.y);
    context.lineTo(targetPoint.x, targetPoint.y);
    context.strokeStyle = palette.edge;
    context.lineWidth = 1.4 / transform.scale;
    context.stroke();
  }

  for (const node of atlas.nodes) {
    const position = nodePosition(node);
    const selected =
      (!!node.personId && node.personId === selectedPersonId) ||
      (!!node.accountId && node.accountId === selectedAccountId);
    const linkedToSelected = !!selectedPersonId && node.linkedPersonId === selectedPersonId;
    const hovered = node.id === hoveredNodeId;
    let fill = palette.accountFill;
    let stroke = providerColor(node.provider, palette);
    if (node.kind === "friend_person") {
      fill = palette.friendFill;
      stroke = palette.friendStroke;
    } else if (node.kind === "connection_person") {
      fill = palette.connectionFill;
      stroke = palette.connectionStroke;
    } else if (node.kind === "feed") {
      fill = palette.feedFill;
    } else if (node.kind === "provider_cluster") {
      fill = providerColor(node.provider, palette).replace(/\/ 0\.\d+\)/, "/ 0.28)");
    }

    context.beginPath();
    context.arc(position.x, position.y, node.radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.strokeStyle = selected ? palette.selection : stroke;
    context.lineWidth = (selected ? 3 : hovered || linkedToSelected ? 2.2 : 1.3) / transform.scale;
    context.globalAlpha = selectedPersonId || selectedAccountId
      ? selected || linkedToSelected || hovered ? 1 : 0.34
      : 1;
    context.fill();
    context.stroke();
    context.globalAlpha = 1;

    if (node.friendSuggestionConfidence) {
      context.beginPath();
      context.arc(position.x, position.y, node.radius + 5, 0, Math.PI * 2);
      context.strokeStyle = palette.highlight;
      context.lineWidth = (node.friendSuggestionConfidence === "high" ? 2 : 1.35) / transform.scale;
      context.globalAlpha = node.friendSuggestionConfidence === "high" ? 0.48 : 0.32;
      context.stroke();
      context.globalAlpha = 1;
    }

    if (node.kind !== "provider_cluster" && node.initials && transform.scale >= 0.72) {
      context.fillStyle = palette.text;
      context.font = `${Math.max(9, Math.min(16, node.radius * 0.48)) / transform.scale}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.globalAlpha = 0.86;
      context.fillText(node.initials, position.x, position.y + 0.5 / transform.scale);
      context.globalAlpha = 1;
    }
  }

  if (drag?.kind === "account-drag" && drag.dropTargetPersonId) {
    const target = nodeById.get(`person:${drag.dropTargetPersonId}`);
    if (target) {
      context.beginPath();
      context.arc(target.x, target.y, target.radius + 8, 0, Math.PI * 2);
      context.strokeStyle = palette.selection;
      context.lineWidth = 4 / transform.scale;
      context.stroke();
    }
  }

  context.restore();

  context.textBaseline = "top";
  context.textAlign = "center";
  for (const label of atlas.labels) {
    const point = screenPointForPosition({ x: label.x, y: label.y }, transform);
    if (point.x < -160 || point.x > width + 160 || point.y < -80 || point.y > height + 80) {
      continue;
    }
    const fontSize = label.kind === "friend_person" ? 12 : 11;
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    const textWidth = Math.ceil(context.measureText(label.text).width);
    const labelWidth = Math.max(44, textWidth + 18);
    const labelHeight = fontSize + 9;
    drawRoundedRect(context, point.x - labelWidth / 2, point.y, labelWidth, labelHeight, 9);
    context.fillStyle = palette.labelFill;
    context.strokeStyle = palette.labelStroke;
    context.lineWidth = 1;
    context.fill();
    context.stroke();
    context.fillStyle = palette.text;
    context.fillText(label.text, point.x, point.y + 4);
  }

  return nowMs();
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
  const workerRef = useRef<Worker | null>(null);
  const atlasRef = useRef<IdentityGraphAtlas | null>(null);
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
  const settleTimerRef = useRef<number | null>(null);
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
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 640 });
  const [atlasReady, setAtlasReady] = useState(false);

  const activitySummaries = useMemo(
    () => activitySummariesProp ?? buildIdentityGraphActivitySummaries(feedItems ?? {}),
    [activitySummariesProp, feedItems],
  );
  const personsById = useMemo(
    () => Object.fromEntries(persons.map((person) => [person.id, person])),
    [persons],
  );
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
      rendererType: "canvas-atlas",
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
      container.dataset.graphRenderer = "canvas-atlas";
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
      drawAtlas(
        canvas,
        atlas,
        transformRef.current,
        getPalette(),
        hoveredNodeIdRef.current,
        selectedPersonId,
        selectedAccountId,
        dragStateRef.current,
      );
      if (!firstVisibleMsRef.current && atlas.nodes.length > 0) {
        firstVisibleMsRef.current = nowMs() - mountedAtRef.current;
      }
      exposeDiagnostics(atlas, nowMs() - startedAt);
    } catch (error) {
      (window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string }).__FREED_GRAPH_DRAW_ERROR__ =
        error instanceof Error ? error.message : String(error);
      console.warn("[friends-graph] canvas atlas draw failed", error);
    }
  }, [exposeDiagnostics, getPalette, selectedAccountId, selectedPersonId]);

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
    if (!hasFittedInitialAtlasRef.current && !hasUserAdjustedTransformRef.current) {
      transformRef.current = fitTransformToAtlasBounds(atlas.bounds, canvasSize.width, canvasSize.height, FIT_PADDING);
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
    latestQualityRef.current = "interactive";
    scheduleDraw();
    scheduleAtlas("interactive");
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

  const fitAll = useCallback(() => {
    const atlas = atlasRef.current;
    if (!atlas) return;
    transformRef.current = fitTransformToAtlasBounds(atlas.bounds, canvasSize.width, canvasSize.height, FIT_PADDING);
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
    transformRef.current = {
      x: canvasSize.width / 2 - hit.x * scale,
      y: canvasSize.height / 2 - hit.y * scale,
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      setCanvasSize({
        width: Math.max(320, container.clientWidth),
        height: Math.max(320, container.clientHeight || 640),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    requestAtlas("settled");
  }, [requestAtlas]);

  useEffect(() => {
    if (!atlasReady) return;
    scheduleDraw();
  }, [atlasReady, canvasSize.height, canvasSize.width, scheduleDraw]);

  useEffect(() => {
    paletteKeyRef.current = "";
    scheduleDraw();
  }, [scheduleDraw, themeId]);

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

    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouchPointsRef.current.size >= 2) {
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

    const hit = hitNodeAt(event.clientX, event.clientY);
    if (hit?.accountId) {
      const point = viewportToWorld(event.clientX, event.clientY);
      dragStateRef.current = {
        kind: "account-drag",
        pointerId: event.pointerId,
        nodeId: hit.id,
        accountId: hit.accountId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        currentWorldX: point.x,
        currentWorldY: point.y,
        dropTargetPersonId: null,
      };
    } else if (hit?.personId) {
      const point = viewportToWorld(event.clientX, event.clientY);
      dragStateRef.current = {
        kind: "person-drag",
        pointerId: event.pointerId,
        nodeId: hit.id,
        personId: hit.personId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        currentWorldX: point.x,
        currentWorldY: point.y,
      };
    } else {
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
  }, [hitNodeAt, markInteractive, viewportToWorld]);

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
          scheduleDraw();
        }
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    if (drag.kind === "pan") {
      transformRef.current = {
        ...transformRef.current,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      };
      hasUserAdjustedTransformRef.current = true;
      markInteractive();
      if (event.pointerType === "touch") event.preventDefault();
      return;
    }

    const point = viewportToWorld(event.clientX, event.clientY);
    drag.currentWorldX = point.x;
    drag.currentWorldY = point.y;
    if (drag.moved && onDropNodeToRelationshipTier) {
      emitRelationshipTierDragOver(relationshipTierDropLevelAt(event.clientX, event.clientY));
    }
    if (drag.kind === "account-drag") {
      const hit = hitNodeAt(event.clientX, event.clientY);
      drag.dropTargetPersonId = hit?.personId ?? null;
    }
    markInteractive();
    event.preventDefault();
  }, [hitNodeAt, markInteractive, onDropNodeToRelationshipTier, scheduleDraw, viewportToWorld]);

  const handlePointerUp = useCallback(async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }
    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      emitRelationshipTierDragOver(null);
      overlayRef.current?.classList.toggle("cursor-grabbing", activeTouchPointsRef.current.size > 0);
      requestAtlas("settled");
      return;
    }

    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");
    emitRelationshipTierDragOver(null);

    if (
      drag.moved &&
      (drag.kind === "account-drag" || drag.kind === "person-drag") &&
      onDropNodeToRelationshipTier
    ) {
      const level = relationshipTierDropLevelAt(event.clientX, event.clientY);
      if (level) {
        await onDropNodeToRelationshipTier({
          personId: drag.kind === "person-drag" ? drag.personId : undefined,
          accountId: drag.kind === "account-drag" ? drag.accountId : undefined,
          level,
        });
        requestAtlas("settled");
        return;
      }
    }

    if (drag.kind === "account-drag") {
      if (drag.moved && drag.dropTargetPersonId && onLinkAccountToPerson) {
        await onLinkAccountToPerson(drag.accountId, drag.dropTargetPersonId);
      } else if (drag.moved) {
        await onPinAccountPosition?.(drag.accountId, drag.currentWorldX, drag.currentWorldY);
      } else {
        const account = accounts[drag.accountId];
        if (account) onSelectAccount(account);
      }
      requestAtlas("settled");
      return;
    }

    if (drag.kind === "person-drag") {
      if (drag.moved) {
        await onPinPersonPosition?.(drag.personId, drag.currentWorldX, drag.currentWorldY);
      } else {
        const person = personsById[drag.personId];
        if (person) onSelectPerson(person);
      }
      requestAtlas("settled");
      return;
    }

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
    onDropNodeToRelationshipTier,
    onLinkAccountToPerson,
    onPinAccountPosition,
    onPinPersonPosition,
    onSelectAccount,
    onSelectPerson,
    personsById,
    requestAtlas,
    scheduleDraw,
  ]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      scheduleDraw();
    }
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }
    if (onDropNodeToRelationshipTier && dragStateRef.current?.kind !== "pan") {
      return;
    }
    dragStateRef.current = null;
    pinchStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");
    emitRelationshipTierDragOver(null);
  }, [onDropNodeToRelationshipTier, scheduleDraw]);

  const handleCopyDiagnostics = useCallback(async () => {
    const debug = {
      perf: (window as typeof window & { __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot }).__FREED_GRAPH_PERF__ ?? null,
      debug: shouldExposeGraphDebug()
        ? (window as typeof window & { __FREED_GRAPH_DEBUG__?: unknown }).__FREED_GRAPH_DEBUG__ ?? null
        : null,
    };
    await navigator.clipboard?.writeText(JSON.stringify(debug, null, 2));
  }, []);

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
