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
import type {
  Account,
  FeedItem,
  FriendCandidateConfidence,
  MapMode,
  Person,
  RssFeed,
} from "@freed/shared";
import type { ThemeId } from "@freed/shared/themes";
import { CopyIcon } from "../icons.js";
import {
  buildIdentityGraphActivitySummaries,
  type IdentityGraphActivitySummaries,
} from "../../lib/identity-graph-activity-summary.js";
import {
  buildIdentityGraphAtlasModel,
  fitTransformToAtlasBounds,
  sliceIdentityGraphAtlas,
  type BuildIdentityGraphAtlasModelInput,
  type IdentityGraphAtlas,
  type IdentityGraphAtlasBounds,
  type IdentityGraphAtlasNode,
  type IdentityGraphAtlasQuality,
} from "../../lib/identity-graph-atlas.js";
import {
  compileIdentityGalaxyScene,
  IdentityGalaxyNodeKindCode,
  type IdentityGalaxyScene,
  updateIdentityGalaxySceneInteraction,
} from "../../lib/identity-galaxy-scene.js";
import {
  IdentityGalaxyEngine,
  type IdentityGalaxyVariation,
} from "../../lib/identity-galaxy-engine.js";
import { viewportPointToIdentityGalaxyPlane } from "../../lib/identity-galaxy-camera.js";
import type {
  IdentityGalaxyWorkerResponse,
  IdentityGalaxyWorkerViewportInput,
} from "../../lib/identity-galaxy-worker-protocol.js";
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

type SafariGestureState = {
  initialScale: number;
  localPoint: TouchPoint;
  worldPoint: TouchPoint;
};

interface SafariGestureEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

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
  rendererLabelCount: number;
  readyRendererLabelCount: number;
  rendererEdgeCount: number;
  denseRenderMode: "dense" | "containers";
  denseInteractionEligible: boolean;
  denseInteractionNodeCount: number;
  denseInteractionCulled: boolean;
  denseInteractionRebuildCount: number;
  qualityMode: "interactive" | "settled";
  sourceNodeCount: number;
  residentNodeCount: number;
  visibleNodeCount: number;
  renderedPrimitiveCount: number;
  firstVisibleMs: number;
  frameP95Ms: number;
  longTaskCount: number;
  memoryEstimateBytes: number;
  rendererType: "three-starfield" | "canvas-starfield-fallback";
  touchInputMode: "native-touch-events";
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

type ApplyIdentityGraphAtlas = (
  requestId: number,
  atlas: IdentityGraphAtlas,
  galaxyScene: IdentityGalaxyScene | undefined,
  edgeIndices: Uint32Array | undefined,
  durationMs: number,
) => void;

const MIN_SCALE = 0.18;
const MAX_SCALE = 3.2;
const FIT_PADDING = 96;
const DESKTOP_INITIAL_SCALE = 0.34;
const MOBILE_INITIAL_SCALE = 0.42;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.0035;
const WHEEL_ZOOM_SPEED = 0.0014;
const INTERACTION_SETTLE_DELAY_MS = 180;
const DENSE_INTERACTION_SETTLE_DELAY_MS = 420;
const GRAPH_LAYOUT_WORKER_TIMEOUT_MS = 2_400;
const CONTROL_BASE = "btn-secondary rounded-lg px-3 py-1.5 text-xs shadow-sm";
const EMPTY_GRAPH_VIEWPORT_INSETS: GraphViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function fitPaddingForViewport(width: number): number {
  return width <= 700 ? 28 : FIT_PADDING;
}

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

function initialGalaxyBounds(
  atlasBounds: IdentityGraphAtlasBounds,
  scene: IdentityGalaxyScene,
  viewportWidth: number,
): IdentityGraphAtlasBounds {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < scene.nodeIds.length; index += 1) {
    const kind = scene.kinds[index];
    if (kind !== IdentityGalaxyNodeKindCode.FriendPerson &&
      kind !== IdentityGalaxyNodeKindCode.ConnectionPerson) {
      continue;
    }
    const x = scene.positions[index * 3]!;
    const y = -scene.positions[index * 3 + 1]!;
    const radius = scene.radii[index]!;
    left = Math.min(left, x - radius);
    right = Math.max(right, x + radius);
    top = Math.min(top, y - radius);
    bottom = Math.max(bottom, y + radius);
  }
  if (!Number.isFinite(left)) return atlasBounds;
  const padding = viewportWidth <= 700 ? 72 : 150;
  return {
    left: left - padding,
    right: right + padding,
    top: top - padding,
    bottom: bottom + padding,
  };
}

function ensureInitialGalaxyScale(
  transform: ViewTransform,
  bounds: IdentityGraphAtlasBounds,
  width: number,
  height: number,
  viewportInsets: GraphViewportInsets,
): ViewTransform {
  const minimumScale = width <= 700 ? MOBILE_INITIAL_SCALE : DESKTOP_INITIAL_SCALE;
  if (transform.scale >= minimumScale) return transform;
  const center = visibleViewportCenter(width, height, viewportInsets);
  const worldCenterX = (bounds.left + bounds.right) / 2;
  const worldCenterY = (bounds.top + bounds.bottom) / 2;
  return {
    x: center.x - worldCenterX * minimumScale,
    y: center.y - worldCenterY * minimumScale,
    scale: minimumScale,
  };
}

function initialGalaxyTransform(
  atlasBounds: IdentityGraphAtlasBounds,
  scene: IdentityGalaxyScene,
  width: number,
  height: number,
  viewportInsets: GraphViewportInsets,
): ViewTransform {
  const bounds = initialGalaxyBounds(atlasBounds, scene, width);
  return ensureInitialGalaxyScale(
    fitTransformToVisibleAtlasBounds(
      bounds,
      width,
      height,
      fitPaddingForViewport(width),
      viewportInsets,
    ),
    bounds,
    width,
    height,
    viewportInsets,
  );
}

function visibleViewportCenter(width: number, height: number, viewportInsets: GraphViewportInsets): TouchPoint {
  return {
    x: viewportInsets.left + Math.max(1, width - viewportInsets.left - viewportInsets.right) / 2,
    y: viewportInsets.top + Math.max(1, height - viewportInsets.top - viewportInsets.bottom) / 2,
  };
}

function shouldExposeGraphDebug(): boolean {
  return typeof window !== "undefined" &&
    (window as typeof window & { __FREED_GRAPH_DEBUG_ENABLED__?: boolean })
      .__FREED_GRAPH_DEBUG_ENABLED__ === true;
}

function isGraphGestureUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'button, input, select, textarea, [role="menu"], [data-graph-gesture-ignore="true"]',
  ));
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
  const engineRef = useRef<IdentityGalaxyEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const applyAtlasRef = useRef<ApplyIdentityGraphAtlas | null>(null);
  const atlasRef = useRef<IdentityGraphAtlas | null>(null);
  const galaxySceneRef = useRef<IdentityGalaxyScene | null>(null);
  const hitBucketsRef = useRef<Map<string, string[]>>(new Map());
  const atlasNodeByIdRef = useRef<Map<string, IdentityGraphAtlasNode>>(new Map());
  const visibleNodeIdsRef = useRef<string[]>([]);
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const safariGestureStateRef = useRef<SafariGestureState | null>(null);
  const lastPointerPointRef = useRef<TouchPoint | null>(null);
  const activeTouchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const ignoredTouchIdsRef = useRef<Set<number>>(new Set());
  const hoveredNodeIdRef = useRef<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const latestResolvedRequestIdRef = useRef(0);
  const nextSourceRevisionRef = useRef(0);
  const postedSourceRevisionRef = useRef(-1);
  const pendingWorkerTimeoutsRef = useRef<Map<number, number>>(new Map());
  const drawRafRef = useRef(0);
  const sceneDirtyRef = useRef(true);
  const interactionDirtyRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const hasFittedInitialAtlasRef = useRef(false);
  const hasUserAdjustedTransformRef = useRef(false);
  const mountedAtRef = useRef(nowMs());
  const firstVisibleMsRef = useRef(0);
  const frameSamplesRef = useRef<number[]>([]);
  const lastFrameAtRef = useRef<number | null>(null);
  const longTaskCountRef = useRef(0);
  const sceneSyncCountRef = useRef(0);
  const transformOnlySyncCountRef = useRef(0);
  const edgeRebuildCountRef = useRef(0);
  const latestQualityRef = useRef<IdentityGraphAtlasQuality>("settled");
  const viewportInsetsRef = useRef<GraphViewportInsets>(EMPTY_GRAPH_VIEWPORT_INSETS);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 640 });
  const [viewportInsets, setViewportInsets] = useState<GraphViewportInsets>(EMPTY_GRAPH_VIEWPORT_INSETS);
  const [atlasReady, setAtlasReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
  const [linkPickerAccountId, setLinkPickerAccountId] = useState<string | null>(null);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [starfieldVariation, setStarfieldVariation] = useState<IdentityGalaxyVariation>("nebula");

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
  const galaxySource = useMemo(() => ({
    revision: nextSourceRevisionRef.current + 1,
    input: {
      persons,
      accounts,
      feeds,
      activitySummaries,
      mode,
      width: canvasSize.width,
      height: canvasSize.height,
      friendSuggestionStrengthByPerson: friendSuggestionStrengthByPersonRecord,
      friendSuggestionStrengthByAccount: friendSuggestionStrengthByAccountRecord,
    } satisfies BuildIdentityGraphAtlasModelInput,
  }), [
    accounts,
    activitySummaries,
    canvasSize.height,
    canvasSize.width,
    feeds,
    friendSuggestionStrengthByAccountRecord,
    friendSuggestionStrengthByPersonRecord,
    mode,
    persons,
  ]);
  nextSourceRevisionRef.current = galaxySource.revision;

  const exposeDiagnostics = useCallback((atlas: IdentityGraphAtlas, sceneSyncMs: number) => {
    const sourceNodeCount = canonicalNodeCount;
    const residentNodeCount = galaxySceneRef.current?.nodeIds.length ?? atlas.metrics.visibleNodeCount;
    const visibleNodeCount = atlas.metrics.visibleNodeCount;
    const p95Samples = [...frameSamplesRef.current].sort((left, right) => left - right);
    const frameP95Ms = p95Samples[Math.floor(p95Samples.length * 0.95)] ?? 0;
    const perf: GraphSurfacePerfSnapshot = {
      modelBuildMs: activitySummaries.buildMs,
      layoutMs: atlas.metrics.buildMs,
      sceneSyncMs,
      labelPassMs: 0,
      sceneSyncCount: sceneSyncCountRef.current,
      contentSyncCount: 1,
      transformOnlySyncCount: transformOnlySyncCountRef.current,
      edgeRebuildCount: edgeRebuildCountRef.current,
      nodeRestyleCount: residentNodeCount,
      labelLayoutCount: atlas.labels.length > 0 ? 1 : 0,
      avatarDisplayCount: 0,
      visibleLabelCount: atlas.labels.length,
      visibleNodeLabelCount: atlas.labels.filter((label) => label.kind !== "provider_cluster").length,
      visibleProviderLabelCount: atlas.labels.filter((label) => label.kind === "provider_cluster").length,
      rendererLabelCount: engineRef.current?.labelCount ?? 0,
      readyRendererLabelCount: engineRef.current?.readyLabelCount ?? 0,
      rendererEdgeCount: engineRef.current?.edgeCount ?? 0,
      denseRenderMode: sourceNodeCount >= 1_200 ? "dense" : "containers",
      denseInteractionEligible: sourceNodeCount >= 1_200,
      denseInteractionNodeCount: latestQualityRef.current === "interactive" ? visibleNodeCount : 0,
      denseInteractionCulled: atlas.metrics.capped,
      denseInteractionRebuildCount: atlas.metrics.capped ? 1 : 0,
      qualityMode: latestQualityRef.current,
      sourceNodeCount,
      residentNodeCount,
      visibleNodeCount,
      renderedPrimitiveCount: residentNodeCount + atlas.edges.length + atlas.regions.length + atlas.labels.length,
      firstVisibleMs: firstVisibleMsRef.current,
      frameP95Ms,
      longTaskCount: longTaskCountRef.current,
      memoryEstimateBytes: estimateMemoryBytes(atlas),
      rendererType: engineRef.current?.rendererType ?? "three-starfield",
      touchInputMode: "native-touch-events",
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
      container.dataset.rendererLabelCount = String(engineRef.current?.labelCount ?? 0);
      container.dataset.readyRendererLabelCount = String(engineRef.current?.readyLabelCount ?? 0);
      container.dataset.rendererEdgeCount = String(engineRef.current?.edgeCount ?? 0);
      container.dataset.graphQualityMode = latestQualityRef.current;
      container.dataset.graphVisibleNodeCount = String(visibleNodeCount);
      container.dataset.graphResidentNodeCount = String(residentNodeCount);
      container.dataset.graphRenderer = engineRef.current?.rendererType ?? "three-starfield";
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

  const updateTransformDiagnostics = useCallback(() => {
    transformOnlySyncCountRef.current += 1;
    const graphWindow = window as typeof window & {
      __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot;
      __FREED_GRAPH_DEBUG__?: {
        nodes: GraphDebugNode[];
        regions: IdentityGraphAtlas["regions"];
        transform: ViewTransform;
        qualityMode: "interactive" | "settled";
        metrics: GraphPerfSnapshot;
      };
    };
    const perf = graphWindow.__FREED_GRAPH_PERF__;
    if (perf) {
      perf.sceneSyncMs = 0;
      perf.transformOnlySyncCount = transformOnlySyncCountRef.current;
      perf.qualityMode = latestQualityRef.current;
      perf.transformScale = transformRef.current.scale;
      perf.rendererLabelCount = engineRef.current?.labelCount ?? perf.rendererLabelCount;
      perf.readyRendererLabelCount = engineRef.current?.readyLabelCount ?? perf.readyRendererLabelCount;
      perf.rendererEdgeCount = engineRef.current?.edgeCount ?? perf.rendererEdgeCount;
    }
    const debug = graphWindow.__FREED_GRAPH_DEBUG__;
    if (debug) {
      debug.transform = { ...transformRef.current };
      debug.qualityMode = latestQualityRef.current;
      if (perf) debug.metrics = perf;
    }
    const container = containerRef.current;
    if (container && container.dataset.graphQualityMode !== latestQualityRef.current) {
      container.dataset.graphQualityMode = latestQualityRef.current;
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const atlas = atlasRef.current;
    if (!canvas || !atlas) return;
    const galaxyScene = galaxySceneRef.current;
    try {
      if (!galaxyScene) {
        throw new Error("Friends galaxy scene is unavailable");
      }
      const shouldSyncScene = sceneDirtyRef.current;
      const shouldSyncInteraction = shouldSyncScene || interactionDirtyRef.current;
      if (shouldSyncInteraction) {
        updateIdentityGalaxySceneInteraction(galaxyScene, {
          quality: latestQualityRef.current,
          selectedPersonId,
          selectedAccountId,
          hoveredNodeId: hoveredNodeIdRef.current,
        });
      }
      let engine = engineRef.current;
      let engineCreated = false;
      if (!engine) {
        engine = new IdentityGalaxyEngine(canvas, containerRef.current);
        engineRef.current = engine;
        engineCreated = true;
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
      engine.resize(canvasSize.width, canvasSize.height);
      let sceneSyncMs = 0;
      if (shouldSyncScene || engineCreated) {
        const syncStartedAt = nowMs();
        engine.syncScene(
          atlas,
          galaxyScene,
          {
            selectedPersonId,
            selectedAccountId,
            variation: starfieldVariation,
            quality: latestQualityRef.current,
          },
        );
        sceneSyncMs = nowMs() - syncStartedAt;
        sceneSyncCountRef.current += 1;
        if (atlas.edges.length > 0) edgeRebuildCountRef.current += 1;
      } else if (shouldSyncInteraction) {
        engine.updateInteraction(galaxyScene);
        const perf = (window as typeof window & {
          __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot;
        }).__FREED_GRAPH_PERF__;
        if (perf) perf.rendererEdgeCount = engine.edgeCount;
        if (containerRef.current) {
          containerRef.current.dataset.rendererEdgeCount = String(engine.edgeCount);
        }
      }
      engine.render(transformRef.current);
      sceneDirtyRef.current = false;
      interactionDirtyRef.current = false;
      if (!firstVisibleMsRef.current && atlas.nodes.length > 0) {
        firstVisibleMsRef.current = nowMs() - mountedAtRef.current;
      }
      if (shouldSyncScene || engineCreated) {
        exposeDiagnostics(atlas, sceneSyncMs);
      } else if (!shouldSyncInteraction) {
        updateTransformDiagnostics();
      }
    } catch (error) {
      (window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string }).__FREED_GRAPH_DRAW_ERROR__ =
        error instanceof Error ? error.message : String(error);
      console.warn("[friends-graph] starfield draw failed", error);
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    exposeDiagnostics,
    selectedAccountId,
    selectedPersonId,
    starfieldVariation,
    updateTransformDiagnostics,
  ]);

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current !== 0) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      draw();
    });
  }, [draw]);

  const applyAtlas = useCallback((
    requestId: number,
    atlas: IdentityGraphAtlas,
    galaxyScene: IdentityGalaxyScene | undefined,
    edgeIndices: Uint32Array | undefined,
    durationMs: number,
  ) => {
    if (requestId < latestResolvedRequestIdRef.current) return;
    const timeout = pendingWorkerTimeoutsRef.current.get(requestId);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      pendingWorkerTimeoutsRef.current.delete(requestId);
    }
    latestResolvedRequestIdRef.current = requestId;
    atlas.metrics.buildMs = durationMs;
    atlasRef.current = atlas;
    if (galaxyScene) {
      galaxySceneRef.current = galaxyScene;
    } else if (edgeIndices && galaxySceneRef.current) {
      galaxySceneRef.current.edgeIndices = edgeIndices;
    }
    if (!galaxySceneRef.current) {
      throw new Error("Friends galaxy atlas arrived without a semantic scene");
    }
    hitBucketsRef.current = buildHitBucketMap(atlas);
    atlasNodeByIdRef.current = new Map(atlas.nodes.map((node) => [node.id, node]));
    visibleNodeIdsRef.current = atlas.nodes.map((node) => node.id);
    sceneDirtyRef.current = true;
    if (!hasFittedInitialAtlasRef.current && !hasUserAdjustedTransformRef.current) {
      transformRef.current = initialGalaxyTransform(
        atlas.bounds,
        galaxySceneRef.current,
        canvasSize.width,
        canvasSize.height,
        viewportInsetsRef.current,
      );
      hasFittedInitialAtlasRef.current = true;
    }
    setAtlasReady(true);
    draw();
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, draw, scheduleDraw]);
  applyAtlasRef.current = applyAtlas;

  const runAtlasOnMainThread = useCallback((
    requestId: number,
    source: BuildIdentityGraphAtlasModelInput,
    viewport: IdentityGalaxyWorkerViewportInput,
  ) => {
    window.setTimeout(() => {
      const startedAt = nowMs();
      const model = buildIdentityGraphAtlasModel(source);
      const atlas = sliceIdentityGraphAtlas({ model, ...viewport });
      const galaxyScene = compileIdentityGalaxyScene({
        nodes: model.nodes,
        edges: model.edges,
      }, {
        quality: viewport.quality,
        selectedPersonId: viewport.selectedPersonId,
        selectedAccountId: viewport.selectedAccountId,
      });
      applyAtlas(requestId, atlas, galaxyScene, undefined, nowMs() - startedAt);
    }, 0);
  }, [applyAtlas]);

  const requestAtlas = useCallback((quality: IdentityGraphAtlasQuality) => {
    latestQualityRef.current = quality;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const viewport: IdentityGalaxyWorkerViewportInput = {
      transform: transformRef.current,
      width: canvasSize.width,
      height: canvasSize.height,
      quality,
      selectedPersonId,
      selectedAccountId,
    };
    const worker = workerRef.current;
    if (!worker) {
      runAtlasOnMainThread(requestId, galaxySource.input, viewport);
      return;
    }
    const timeout = window.setTimeout(() => {
      pendingWorkerTimeoutsRef.current.delete(requestId);
      if (requestId < latestResolvedRequestIdRef.current) return;
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
        postedSourceRevisionRef.current = -1;
      }
      runAtlasOnMainThread(requestId, galaxySource.input, viewport);
    }, GRAPH_LAYOUT_WORKER_TIMEOUT_MS);
    pendingWorkerTimeoutsRef.current.set(requestId, timeout);
    if (postedSourceRevisionRef.current !== galaxySource.revision) {
      postedSourceRevisionRef.current = galaxySource.revision;
      worker.postMessage({
        kind: "build",
        requestId,
        sourceRevision: galaxySource.revision,
        source: galaxySource.input,
        viewport,
      });
    } else {
      worker.postMessage({
        kind: "viewport",
        requestId,
        sourceRevision: galaxySource.revision,
        viewport,
      });
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    galaxySource,
    runAtlasOnMainThread,
    selectedAccountId,
    selectedPersonId,
  ]);

  const markInteractive = useCallback(() => {
    latestQualityRef.current = "interactive";
    scheduleDraw();
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    const sourceCount = atlasRef.current?.metrics.sourceNodeCount ?? 0;
    const delay = sourceCount >= 1_200 ? DENSE_INTERACTION_SETTLE_DELAY_MS : INTERACTION_SETTLE_DELAY_MS;
    const settleWhenIdle = () => {
      if (
        dragStateRef.current ||
        pinchStateRef.current ||
        safariGestureStateRef.current ||
        activeTouchPointsRef.current.size > 0
      ) {
        settleTimerRef.current = window.setTimeout(settleWhenIdle, delay);
        return;
      }
      latestQualityRef.current = "settled";
      settleTimerRef.current = null;
      requestAtlas("settled");
    };
    settleTimerRef.current = window.setTimeout(settleWhenIdle, delay);
  }, [requestAtlas, scheduleDraw]);

  const viewportToWorld = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return viewportPointToIdentityGalaxyPlane(
      clientX - rect.left,
      clientY - rect.top,
      transformRef.current,
    );
  }, []);

  const hitNodeAt = useCallback((clientX: number, clientY: number) => {
    const atlas = atlasRef.current;
    if (!atlas) return null;
    const container = containerRef.current;
    const scene = galaxySceneRef.current;
    const engine = engineRef.current;
    if (container && scene && engine) {
      const rect = container.getBoundingClientRect();
      const nodeId = engine.pickNode(
        clientX - rect.left,
        clientY - rect.top,
        visibleNodeIdsRef.current,
      );
      if (nodeId) return atlasNodeByIdRef.current.get(nodeId) ?? null;
    }
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
      fitPaddingForViewport(canvasSize.width),
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
    postedSourceRevisionRef.current = -1;
    worker.onmessage = (event: MessageEvent<IdentityGalaxyWorkerResponse>) => {
      applyAtlasRef.current?.(
        event.data.requestId,
        event.data.atlas,
        event.data.scene,
        event.data.edgeIndices,
        event.data.durationMs,
      );
    };
    worker.onerror = () => {
      if (workerRef.current === worker) {
        workerRef.current = null;
        postedSourceRevisionRef.current = -1;
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
        postedSourceRevisionRef.current = -1;
      }
    };
  }, []);

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
    engineRef.current?.resize(canvasSize.width, canvasSize.height);
    scheduleDraw();
  }, [atlasReady, canvasSize.height, canvasSize.width, scheduleDraw]);

  useEffect(() => {
    if (!atlasReady) return;
    const atlas = atlasRef.current;
    const scene = galaxySceneRef.current;
    if (atlas && scene && !hasUserAdjustedTransformRef.current) {
      transformRef.current = initialGalaxyTransform(
        atlas.bounds,
        scene,
        canvasSize.width,
        canvasSize.height,
        viewportInsets,
      );
    }
    requestAtlas("settled");
    scheduleDraw();
  }, [atlasReady, canvasSize.height, canvasSize.width, requestAtlas, scheduleDraw, viewportInsets]);

  useEffect(() => {
    sceneDirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, themeId]);

  useEffect(() => {
    sceneDirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, selectedAccountId, selectedPersonId, starfieldVariation]);

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
      window.cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = 0;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      engineRef.current?.dispose();
      engineRef.current = null;
      galaxySceneRef.current = null;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const gesturePoint = (event: SafariGestureEvent) => {
      const rect = container.getBoundingClientRect();
      const eventX = typeof event.clientX === "number" ? event.clientX : Number.NaN;
      const eventY = typeof event.clientY === "number" ? event.clientY : Number.NaN;
      if (
        Number.isFinite(eventX) &&
        Number.isFinite(eventY) &&
        eventX >= rect.left &&
        eventX <= rect.right &&
        eventY >= rect.top &&
        eventY <= rect.bottom
      ) {
        return { clientX: eventX, clientY: eventY };
      }
      const pointer = lastPointerPointRef.current;
      if (pointer) return { clientX: pointer.x, clientY: pointer.y };
      const center = visibleViewportCenter(
        canvasSize.width,
        canvasSize.height,
        viewportInsetsRef.current,
      );
      return { clientX: rect.left + center.x, clientY: rect.top + center.y };
    };

    const beginGesture = (event: SafariGestureEvent) => {
      if (isGraphGestureUiTarget(event.target)) return;
      event.preventDefault();
      const point = gesturePoint(event);
      const rect = container.getBoundingClientRect();
      safariGestureStateRef.current = {
        initialScale: transformRef.current.scale,
        localPoint: {
          x: point.clientX - rect.left,
          y: point.clientY - rect.top,
        },
        worldPoint: viewportToWorld(point.clientX, point.clientY),
      };
      setContextMenu(null);
      setLinkPickerAccountId(null);
      markInteractive();
    };

    const updateGesture = (event: SafariGestureEvent) => {
      if (isGraphGestureUiTarget(event.target)) return;
      event.preventDefault();
      if (!safariGestureStateRef.current) beginGesture(event);
      const gesture = safariGestureStateRef.current;
      if (!gesture) return;
      const scale = clampScale(gesture.initialScale * Math.max(0.05, event.scale ?? 1));
      transformRef.current = {
        scale,
        x: gesture.localPoint.x - gesture.worldPoint.x * scale,
        y: gesture.localPoint.y - gesture.worldPoint.y * scale,
      };
      hasUserAdjustedTransformRef.current = true;
      markInteractive();
    };

    const endGesture = (event: SafariGestureEvent) => {
      if (!safariGestureStateRef.current) return;
      event.preventDefault();
      safariGestureStateRef.current = null;
    };

    container.addEventListener("gesturestart", beginGesture as EventListener, { passive: false });
    container.addEventListener("gesturechange", updateGesture as EventListener, { passive: false });
    container.addEventListener("gestureend", endGesture as EventListener, { passive: false });
    return () => {
      container.removeEventListener("gesturestart", beginGesture as EventListener);
      container.removeEventListener("gesturechange", updateGesture as EventListener);
      container.removeEventListener("gestureend", endGesture as EventListener);
    };
  }, [canvasSize.height, canvasSize.width, markInteractive, viewportToWorld]);

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

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const beginNativePinch = useCallback(() => {
    const [firstEntry, secondEntry] = [...activeTouchPointsRef.current.entries()];
    if (!firstEntry || !secondEntry) return false;
    const initialDistance = distanceBetween(firstEntry[1], secondEntry[1]);
    if (initialDistance <= 0) return false;
    const initialMidpoint = midpointBetween(firstEntry[1], secondEntry[1]);
    clearLongPress();
    pinchStateRef.current = {
      pointerIds: [firstEntry[0], secondEntry[0]],
      initialDistance,
      initialScale: transformRef.current.scale,
      initialMidpoint,
      initialWorldPoint: viewportToWorld(initialMidpoint.x, initialMidpoint.y),
      moved: false,
    };
    dragStateRef.current = null;
    return true;
  }, [clearLongPress, viewportToWorld]);

  const beginNativePan = useCallback((touchId: number, point: TouchPoint, moved = false) => {
    clearLongPress();
    dragStateRef.current = {
      kind: "pan",
      pointerId: touchId,
      startX: point.x,
      startY: point.y,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      moved,
    };
    if (moved) return;
    longPressTimerRef.current = window.setTimeout(() => {
      const currentPoint = activeTouchPointsRef.current.get(touchId);
      const drag = dragStateRef.current;
      if (!currentPoint || !drag || drag.pointerId !== touchId || drag.moved || pinchStateRef.current) return;
      dragStateRef.current = null;
      openNodeContextMenu(currentPoint.x, currentPoint.y);
      scheduleDraw();
    }, 520);
  }, [clearLongPress, openNodeContextMenu, scheduleDraw]);

  const updateNativePinch = useCallback(() => {
    const pinch = pinchStateRef.current;
    if (!pinch) return false;
    const first = activeTouchPointsRef.current.get(pinch.pointerIds[0]);
    const second = activeTouchPointsRef.current.get(pinch.pointerIds[1]);
    if (!first || !second || pinch.initialDistance <= 0) return false;
    const container = containerRef.current;
    if (!container) return false;
    const currentDistance = distanceBetween(first, second);
    const midpoint = midpointBetween(first, second);
    pinch.moved = pinch.moved ||
      Math.abs(currentDistance - pinch.initialDistance) > 4 ||
      distanceBetween(midpoint, pinch.initialMidpoint) > 4;
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
    return true;
  }, [markInteractive]);

  const updateNativePan = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return false;
    const point = activeTouchPointsRef.current.get(drag.pointerId);
    if (!point) return false;
    const moved = Math.abs(point.x - drag.startX) > 3 || Math.abs(point.y - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    if (drag.moved) clearLongPress();
    transformRef.current = {
      ...transformRef.current,
      x: drag.originX + point.x - drag.startX,
      y: drag.originY + point.y - drag.startY,
    };
    hasUserAdjustedTransformRef.current = true;
    markInteractive();
    return true;
  }, [clearLongPress, markInteractive]);

  const selectNodeAt = useCallback((clientX: number, clientY: number) => {
    const hit = hitNodeAt(clientX, clientY);
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
    scheduleDraw,
  ]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || isGraphGestureUiTarget(event.target)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
    const container = containerRef.current;
    if (!container) return;
    container.setPointerCapture(event.pointerId);
    setContextMenu(null);
    setLinkPickerAccountId(null);
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
  }, [markInteractive]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
    const drag = dragStateRef.current;
    if (!drag) {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        const hit = hitNodeAt(event.clientX, event.clientY);
        const nextHovered = hit?.id ?? null;
        if (hoveredNodeIdRef.current !== nextHovered) {
          hoveredNodeIdRef.current = nextHovered;
          interactionDirtyRef.current = true;
          scheduleDraw();
        }
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    transformRef.current = {
      ...transformRef.current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    hasUserAdjustedTransformRef.current = true;
    markInteractive();
  }, [hitNodeAt, markInteractive, scheduleDraw]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");
    if (drag.moved) {
      requestAtlas("settled");
      return;
    }
    selectNodeAt(event.clientX, event.clientY);
  }, [requestAtlas, selectNodeAt]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      interactionDirtyRef.current = true;
      scheduleDraw();
    }
    dragStateRef.current = null;
    overlayRef.current?.classList.remove("cursor-grabbing");
  }, [scheduleDraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncActiveTouches = (touches: TouchList) => {
      const activePoints = activeTouchPointsRef.current;
      activePoints.clear();
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (!touch || ignoredTouchIdsRef.current.has(touch.identifier)) continue;
        activePoints.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
    };

    const touchPointFromList = (touches: TouchList, touchId: number): TouchPoint | null => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === touchId) return { x: touch.clientX, y: touch.clientY };
      }
      return null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (isGraphGestureUiTarget(event.target)) {
        for (let index = 0; index < event.changedTouches.length; index += 1) {
          const touch = event.changedTouches.item(index);
          if (touch) ignoredTouchIdsRef.current.add(touch.identifier);
        }
        return;
      }
      syncActiveTouches(event.touches);
      if (activeTouchPointsRef.current.size === 0) return;
      event.preventDefault();
      setContextMenu(null);
      setLinkPickerAccountId(null);
      if (activeTouchPointsRef.current.size >= 2) {
        beginNativePinch();
      } else {
        const firstEntry = activeTouchPointsRef.current.entries().next().value as
          | [number, TouchPoint]
          | undefined;
        if (firstEntry) beginNativePan(firstEntry[0], firstEntry[1]);
      }
      overlayRef.current?.classList.add("cursor-grabbing");
      markInteractive();
    };

    const handleTouchMove = (event: TouchEvent) => {
      syncActiveTouches(event.touches);
      if (activeTouchPointsRef.current.size === 0) return;
      event.preventDefault();
      if (activeTouchPointsRef.current.size >= 2) {
        const pinch = pinchStateRef.current;
        if (!pinch ||
          !activeTouchPointsRef.current.has(pinch.pointerIds[0]) ||
          !activeTouchPointsRef.current.has(pinch.pointerIds[1])) {
          beginNativePinch();
        }
        updateNativePinch();
        return;
      }
      updateNativePan();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const hadActiveGesture = activeTouchPointsRef.current.size > 0;
      for (let index = 0; index < event.changedTouches.length; index += 1) {
        const touch = event.changedTouches.item(index);
        if (touch) ignoredTouchIdsRef.current.delete(touch.identifier);
      }
      syncActiveTouches(event.touches);
      if (!hadActiveGesture && activeTouchPointsRef.current.size === 0) return;
      event.preventDefault();
      clearLongPress();

      const pinch = pinchStateRef.current;
      if (pinch) {
        if (activeTouchPointsRef.current.size >= 2) {
          beginNativePinch();
          markInteractive();
          return;
        }
        pinchStateRef.current = null;
        const remainingTouch = activeTouchPointsRef.current.entries().next().value as
          | [number, TouchPoint]
          | undefined;
        if (remainingTouch) {
          beginNativePan(remainingTouch[0], remainingTouch[1], true);
          overlayRef.current?.classList.add("cursor-grabbing");
          markInteractive();
          return;
        }
        dragStateRef.current = null;
        overlayRef.current?.classList.remove("cursor-grabbing");
        requestAtlas("settled");
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) {
        if (activeTouchPointsRef.current.size === 0) {
          overlayRef.current?.classList.remove("cursor-grabbing");
          requestAtlas("settled");
        }
        return;
      }
      if (activeTouchPointsRef.current.has(drag.pointerId)) return;
      dragStateRef.current = null;
      overlayRef.current?.classList.remove("cursor-grabbing");
      if (drag.moved) {
        requestAtlas("settled");
        return;
      }
      const releasePoint = touchPointFromList(event.changedTouches, drag.pointerId) ?? {
        x: drag.startX,
        y: drag.startY,
      };
      selectNodeAt(releasePoint.x, releasePoint.y);
    };

    const handleTouchCancel = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      clearLongPress();
      activeTouchPointsRef.current.clear();
      ignoredTouchIdsRef.current.clear();
      pinchStateRef.current = null;
      dragStateRef.current = null;
      overlayRef.current?.classList.remove("cursor-grabbing");
      requestAtlas("settled");
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: false });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    beginNativePan,
    beginNativePinch,
    clearLongPress,
    markInteractive,
    requestAtlas,
    selectNodeAt,
    updateNativePan,
    updateNativePinch,
  ]);

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
      {import.meta.env.DEV || import.meta.env.VITE_FREED_FEATURE_PREVIEW === "1" ? (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-[color:rgb(var(--theme-border-rgb)/0.22)] bg-[color:rgb(var(--theme-surface-rgb)/0.78)] px-2 py-2 text-xs text-[color:var(--theme-text-secondary)] shadow-lg backdrop-blur-md sm:left-4 sm:top-4 sm:px-3">
          <span className="hidden font-semibold text-[color:var(--theme-text-primary)] sm:inline">Starfield</span>
          <select
            className="max-w-[8.5rem] rounded-lg border border-[color:rgb(var(--theme-border-rgb)/0.24)] bg-[color:var(--theme-bg-card)] px-2 py-1 text-xs text-[color:var(--theme-text-primary)] sm:max-w-none"
            value={starfieldVariation}
            onChange={(event) => setStarfieldVariation(event.target.value as IdentityGalaxyVariation)}
            aria-label="Starfield variation"
          >
            <option value="nebula-rings">Cosmic blend</option>
            <option value="nebula">Nebula</option>
            <option value="rings">Star streams</option>
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
      <div
        data-testid="friend-graph-controls"
        className="absolute right-3 top-3 z-10 flex items-center gap-2 sm:right-4 sm:top-4"
      >
        <button type="button" className={CONTROL_BASE} onClick={fitAll}>
          Fit all
        </button>
        <button
          type="button"
          className={`${CONTROL_BASE} inline-flex items-center px-2 sm:px-3`}
          onClick={handleCopyDiagnostics}
          aria-label="Copy diagnostics"
          title="Copy diagnostics"
        >
          <CopyIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Copy diagnostics</span>
        </button>
      </div>
    </div>
  );
});
