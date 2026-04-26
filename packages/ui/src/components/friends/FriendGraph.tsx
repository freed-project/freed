import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Account, FeedItem, MapMode, Person, RssFeed } from "@freed/shared";
import type { ThemeId } from "@freed/shared/themes";
import {
  buildSpatialIndex,
  findHitNode,
  fitTransformToNodes,
  FRIEND_GRAPH_DEFAULT_TRANSFORM,
  type GraphLayoutQuality,
  type IdentityGraphLayout,
  type IdentityGraphLayoutNode,
  type SpatialIndex,
  type ViewTransform,
} from "../../lib/identity-graph-layout.js";
import {
  buildIdentityGraphModel,
  createIdentityGraphModelSignature,
  type IdentityGraphModel,
  type IdentityGraphMode,
} from "../../lib/identity-graph-model.js";
import {
  graphLabelSortValue,
  isSelectedGraphNode,
  shouldShowGraphLabel,
  type GraphQualityMode,
} from "../../lib/identity-graph-render.js";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusNode: (id: string) => void;
}

interface FriendGraphProps {
  persons: Person[];
  accounts: Record<string, Account>;
  feeds: Record<string, RssFeed>;
  feedItems: Record<string, FeedItem>;
  mode: MapMode;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  onSelectPerson: (person: Person) => void;
  onSelectAccount: (account: Account) => void;
  onClearSelection?: () => void;
  onLinkAccountToPerson?: (accountId: string, personId: string) => Promise<void> | void;
  onPinPersonPosition?: (personId: string, x: number, y: number) => Promise<void> | void;
  onPinAccountPosition?: (accountId: string, x: number, y: number) => Promise<void> | void;
  themeId?: ThemeId;
}

type PanState = {
  kind: "pan";
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type AccountDragState = {
  kind: "account-drag";
  pointerId: number;
  nodeId: string;
  accountId: string;
  startX: number;
  startY: number;
  moved: boolean;
  dropTargetPersonId: string | null;
  currentWorldX: number;
  currentWorldY: number;
};

type PersonDragState = {
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

type DragState = PanState | AccountDragState | PersonDragState;

type TouchPoint = {
  x: number;
  y: number;
};

type PinchState = {
  pointerIds: [number, number];
  initialDistance: number;
  initialScale: number;
  moved: boolean;
};

interface PixiScene {
  app: Application;
  world: Container;
  regionLayer: Graphics;
  regionLabelLayer: Container;
  edgeLayer: Graphics;
  edgeHighlightLayer: Graphics;
  nodeLayer: Container;
  hoverLayer: Graphics;
  labelLayer: Container;
  nodeDisplays: Map<string, NodeDisplay>;
  regionDisplays: Map<string, RegionDisplay>;
  labelDisplays: Map<string, LabelDisplay>;
}

interface NodeDisplay {
  container: Container;
  outer: Graphics;
  inner: Graphics | null;
  initials: Text | null;
  providerDot: Graphics | null;
  highlightRing: Graphics;
}

interface LabelDisplay {
  container: Container;
  background: Graphics;
  text: Text;
}

interface RegionDisplay {
  container: Container;
  background: Graphics;
  text: Text;
}

const DEFAULT_HEIGHT = 560;
const FIT_PADDING = 84;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.8;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.005;
const GRAPH_INTERACTION_SETTLE_DELAY_MS = 140;
const INTERACTIVE_LABEL_LIMIT = 16;
const SETTLED_LABEL_LIMIT = 32;
const CONTROL_BASE = "btn-secondary rounded-xl px-3 py-1.5 text-xs";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface GraphThemePalette {
  friendFill: number;
  friendStroke: number;
  friendText: number;
  connectionFill: number;
  connectionStroke: number;
  connectionText: number;
  channelStroke: number;
  labelFill: number;
  labelStroke: number;
  labelText: number;
  labelSelectedText: number;
  edge: number;
  selection: number;
  highlight: number;
  reconnect: number;
  providerColors: Record<string, number>;
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
  visibleLabelCount: number;
  visibleNodeLabelCount: number;
  visibleProviderLabelCount: number;
  qualityMode: GraphQualityMode;
}

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function estimateLabelWidth(label: string, fontSize: number): number {
  return Math.max(44, Math.round(label.length * fontSize * 0.57 + 20));
}

function graphNodeLabelFontSize(node: IdentityGraphLayoutNode, scale: number): number {
  if (node.kind === "friend_person") return scale >= 1.12 ? 13 : 12;
  if (node.kind === "connection_person") return scale >= 1.16 ? 12 : 11;
  return 10.5;
}

function providerLabelMetrics(scale: number): {
  fontSize: number;
  height: number;
  paddingX: number;
  alpha: number;
  gap: number;
} {
  if (scale < 0.55) {
    return { fontSize: 16, height: 30, paddingX: 14, alpha: 0.96, gap: 18 };
  }
  if (scale < 0.9) {
    return { fontSize: 14, height: 26, paddingX: 12, alpha: 0.9, gap: 16 };
  }
  return { fontSize: 12, height: 22, paddingX: 10, alpha: 0.76, gap: 14 };
}

function buildHighlightedNodeIds(
  layout: IdentityGraphLayout,
  selectedPersonId?: string | null,
  selectedAccountId?: string | null,
): Set<string> {
  if (!selectedPersonId && !selectedAccountId) {
    return new Set();
  }

  const next = new Set<string>();
  for (const node of layout.nodes) {
    if (selectedPersonId && node.personId === selectedPersonId) {
      next.add(node.id);
    }
    if (selectedAccountId && node.accountId === selectedAccountId) {
      next.add(node.id);
      if (node.linkedPersonId) {
        next.add(`person:${node.linkedPersonId}`);
      }
    }
  }

  for (const edge of layout.edges) {
    if (next.has(edge.sourceId) || next.has(edge.targetId)) {
      next.add(edge.sourceId);
      next.add(edge.targetId);
    }
  }

  return next;
}

function nodeAlpha(
  node: IdentityGraphLayoutNode,
  highlighted: Set<string>,
  dragTargetPersonId: string | null,
): number {
  if (dragTargetPersonId && node.personId === dragTargetPersonId) {
    return 1;
  }
  if (highlighted.size > 0) {
    return highlighted.has(node.id) ? 1 : node.kind === "feed" ? 0.08 : 0.14;
  }
  if (node.kind === "friend_person") return 0.98;
  if (node.kind === "connection_person") return 0.92;
  if (node.kind === "feed") return 0.7;
  return 0.88;
}

function screenPointForPosition(position: { x: number; y: number }, transform: ViewTransform) {
  return {
    x: position.x * transform.scale + transform.x,
    y: position.y * transform.scale + transform.y,
  };
}

function distanceBetween(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetween(first: TouchPoint, second: TouchPoint): TouchPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function rgbToNumber(color: RgbColor): number {
  return (color.r << 16) + (color.g << 8) + color.b;
}

function mixColor(left: RgbColor, right: RgbColor, rightWeight: number): RgbColor {
  const leftWeight = 1 - rightWeight;
  return {
    r: Math.round(left.r * leftWeight + right.r * rightWeight),
    g: Math.round(left.g * leftWeight + right.g * rightWeight),
    b: Math.round(left.b * leftWeight + right.b * rightWeight),
  };
}

function parseRgbVariable(style: CSSStyleDeclaration, name: string, fallback: RgbColor): RgbColor {
  const value = style.getPropertyValue(name).trim();
  const parts = value.split(/\s+/).map((part) => Number(part));
  if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
    return {
      r: Math.max(0, Math.min(255, Math.round(parts[0]!))),
      g: Math.max(0, Math.min(255, Math.round(parts[1]!))),
      b: Math.max(0, Math.min(255, Math.round(parts[2]!))),
    };
  }
  return fallback;
}

function readGraphThemePalette(element: HTMLElement | null): GraphThemePalette {
  const style = element ? getComputedStyle(element) : null;
  const primary = style
    ? parseRgbVariable(style, "--theme-accent-primary-rgb", { r: 59, g: 130, b: 246 })
    : { r: 59, g: 130, b: 246 };
  const secondary = style
    ? parseRgbVariable(style, "--theme-accent-secondary-rgb", { r: 139, g: 92, b: 246 })
    : { r: 139, g: 92, b: 246 };
  const tertiary = style
    ? parseRgbVariable(style, "--theme-accent-tertiary-rgb", { r: 6, g: 182, b: 212 })
    : { r: 6, g: 182, b: 212 };
  const shell = style
    ? parseRgbVariable(style, "--theme-shell-rgb", { r: 10, g: 12, b: 20 })
    : { r: 10, g: 12, b: 20 };
  const warning = style
    ? parseRgbVariable(style, "--theme-feedback-warning-rgb", { r: 245, g: 158, b: 11 })
    : { r: 245, g: 158, b: 11 };
  const surface = mixColor(shell, { r: 255, g: 255, b: 255 }, shell.r + shell.g + shell.b > 382 ? 0.08 : 0.82);
  const isLight = shell.r + shell.g + shell.b > 382;
  const text = isLight ? { r: 36, g: 24, b: 14 } : { r: 248, g: 250, b: 252 };
  const mutedText = mixColor(text, shell, isLight ? 0.32 : 0.18);

  return {
    friendFill: rgbToNumber(mixColor(primary, secondary, 0.28)),
    friendStroke: rgbToNumber(mixColor(text, primary, 0.18)),
    friendText: rgbToNumber(text),
    connectionFill: rgbToNumber(mixColor(secondary, surface, 0.34)),
    connectionStroke: rgbToNumber(mixColor(mutedText, secondary, 0.28)),
    connectionText: rgbToNumber(text),
    channelStroke: rgbToNumber(mixColor(text, shell, 0.28)),
    labelFill: rgbToNumber(mixColor(surface, text, isLight ? 0.04 : 0.1)),
    labelStroke: rgbToNumber(mixColor(secondary, text, 0.16)),
    labelText: rgbToNumber(text),
    labelSelectedText: rgbToNumber(isLight ? { r: 255, g: 252, b: 245 } : { r: 8, g: 12, b: 18 }),
    edge: rgbToNumber(mixColor(mutedText, secondary, 0.2)),
    selection: rgbToNumber(mixColor(text, primary, 0.2)),
    highlight: rgbToNumber(mixColor(primary, tertiary, 0.42)),
    reconnect: rgbToNumber(warning),
    providerColors: {
      instagram: rgbToNumber(mixColor(secondary, warning, 0.22)),
      facebook: rgbToNumber(mixColor(primary, tertiary, 0.18)),
      x: rgbToNumber(mixColor(mutedText, primary, 0.16)),
      linkedin: rgbToNumber(mixColor(primary, secondary, 0.16)),
      rss: rgbToNumber(mixColor(warning, secondary, 0.2)),
      other: rgbToNumber(mixColor(tertiary, mutedText, 0.28)),
    },
  };
}

function providerColor(provider: string | undefined, palette: GraphThemePalette): number {
  return palette.providerColors[provider ?? "other"] ?? palette.providerColors.other;
}

function kindColor(node: IdentityGraphLayoutNode, palette: GraphThemePalette) {
  if (node.kind === "friend_person") {
    return {
      fill: palette.friendFill,
      stroke: palette.friendStroke,
      text: palette.friendText,
    };
  }
  if (node.kind === "connection_person") {
    return {
      fill: palette.connectionFill,
      stroke: palette.connectionStroke,
      text: palette.connectionText,
    };
  }
  if (node.kind === "feed") {
    return {
      fill: providerColor("rss", palette),
      stroke: palette.channelStroke,
      text: palette.labelText,
    };
  }
  return {
    fill: providerColor(node.provider, palette),
    stroke: palette.channelStroke,
    text: palette.labelText,
  };
}

function nodePosition(
  node: IdentityGraphLayoutNode,
  drag: DragState | null,
): { x: number; y: number } {
  if (
    drag?.kind === "account-drag" &&
    node.accountId &&
    drag.accountId === node.accountId
  ) {
    return { x: drag.currentWorldX, y: drag.currentWorldY };
  }
  if (
    drag?.kind === "person-drag" &&
    node.personId &&
    drag.personId === node.personId
  ) {
    return { x: drag.currentWorldX, y: drag.currentWorldY };
  }
  return { x: node.x, y: node.y };
}

function createNodeDisplay(
  node: IdentityGraphLayoutNode,
  palette: GraphThemePalette,
  themeId?: ThemeId,
): NodeDisplay {
  const nodePalette = kindColor(node, palette);
  const container = new Container();
  const outer = new Graphics();
  container.addChild(outer);

  let inner: Graphics | null = null;
  let initials: Text | null = null;
  if (node.kind === "friend_person" || node.kind === "connection_person") {
    inner = new Graphics();
    container.addChild(inner);
    initials = new Text(
      node.initials ?? "",
      new TextStyle({
        fill: nodePalette.text,
        fontFamily: themeId === "scriptorium" ? "Georgia, serif" : "system-ui, sans-serif",
        fontSize: Math.max(12, node.radius * 0.48),
        fontWeight: "700",
        letterSpacing: 1,
      }),
    );
    initials.anchor.set(0.5);
    container.addChild(initials);
  }

  let providerDot: Graphics | null = null;
  if (node.kind === "account") {
    providerDot = new Graphics();
    container.addChild(providerDot);
  }

  const highlightRing = new Graphics();
  container.addChild(highlightRing);

  return {
    container,
    outer,
    inner,
    initials,
    providerDot,
    highlightRing,
  };
}

function createLabelDisplay(themeId?: ThemeId): LabelDisplay {
  const container = new Container();
  const background = new Graphics();
  const text = new Text(
    "",
    new TextStyle({
      fill: 0xffffff,
      fontFamily: themeId === "scriptorium" ? "Georgia, serif" : "system-ui, sans-serif",
      fontSize: 12,
      fontWeight: "600",
    }),
  );
  text.anchor.set(0.5, 0);
  text.position.set(0, 4);
  container.addChild(background);
  container.addChild(text);

  return {
    container,
    background,
    text,
  };
}

function createRegionDisplay(themeId?: ThemeId): RegionDisplay {
  const container = new Container();
  const background = new Graphics();
  const text = new Text(
    "",
    new TextStyle({
      fill: 0xffffff,
      fontFamily: themeId === "scriptorium" ? "Georgia, serif" : "system-ui, sans-serif",
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 1,
    }),
  );
  text.anchor.set(0.5);
  container.addChild(background);
  container.addChild(text);

  return {
    container,
    background,
    text,
  };
}

function edgeFadeAlpha(left: number, top: number, width: number, height: number, viewportWidth: number, viewportHeight: number): number {
  const fadeDistance = 28;
  const right = left + width;
  const bottom = top + height;
  const distances = [
    right,
    viewportWidth - left,
    bottom,
    viewportHeight - top,
  ];
  const nearest = Math.min(...distances);
  return Math.max(0, Math.min(1, nearest / fadeDistance));
}

function graphFitItems(layout: IdentityGraphLayout): Array<{ x: number; y: number; radius: number }> {
  return [
    ...layout.nodes,
    ...layout.regions.map((region) => ({
      x: region.x,
      y: region.y,
      radius: Math.max(region.radiusX, region.radiusY),
    })),
  ];
}

function countLinkedAccountChanges(
  previousModel: IdentityGraphModel | null,
  nextModel: IdentityGraphModel,
): number {
  if (!previousModel) return Number.MAX_SAFE_INTEGER;
  if (
    previousModel.nodes.length !== nextModel.nodes.length ||
    previousModel.edges.length !== nextModel.edges.length
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  const previousLinks = new Map<string, string | null>();
  for (const node of previousModel.nodes) {
    if (node.kind !== "account") continue;
    previousLinks.set(node.id, node.linkedPersonId ?? null);
  }

  let changed = 0;
  for (const node of nextModel.nodes) {
    if (node.kind !== "account") continue;
    if (!previousLinks.has(node.id)) {
      return Number.MAX_SAFE_INTEGER;
    }
    if ((previousLinks.get(node.id) ?? null) !== (node.linkedPersonId ?? null)) {
      changed += 1;
    }
  }

  return changed;
}

export const FriendGraph = forwardRef<FriendGraphHandle, FriendGraphProps>(function FriendGraph(
  {
    persons,
    accounts,
    feeds,
    feedItems,
    mode,
    selectedPersonId,
    selectedAccountId,
    onSelectPerson,
    onSelectAccount,
    onClearSelection,
    onLinkAccountToPerson,
    onPinPersonPosition,
    onPinAccountPosition,
    themeId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const layoutRef = useRef<IdentityGraphLayout>({ nodes: [], edges: [], regions: [] });
  const spatialIndexRef = useRef<SpatialIndex>({ cellSize: 96, buckets: new Map() });
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const activeTouchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const hoveredNodeIdRef = useRef<string | null>(null);
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const hasFittedInitialLayoutRef = useRef(false);
  const latestLayoutRequestIdRef = useRef(0);
  const latestResolvedLayoutRequestIdRef = useRef(0);
  const drawRafRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const lastStaticRenderKeyRef = useRef("");
  const lastSelectionStyleKeyRef = useRef("");
  const lastLabelLayoutKeyRef = useRef("");
  const visibleLabelIdsRef = useRef<string[]>([]);
  const textStyleCacheRef = useRef<Map<string, TextStyle>>(new Map());
  const previousRequestedModelRef = useRef<IdentityGraphModel | null>(null);
  const previousRequestSnapshotRef = useRef<{
    signature: string;
    width: number;
    height: number;
  } | null>(null);
  const lastLayoutMsRef = useRef(0);
  const graphQualityModeRef = useRef<GraphQualityMode>("settled");
  const layoutReadyRef = useRef(false);
  const perfSnapshotRef = useRef<GraphPerfSnapshot>({
    modelBuildMs: 0,
    layoutMs: 0,
    sceneSyncMs: 0,
    labelPassMs: 0,
    sceneSyncCount: 0,
    contentSyncCount: 0,
    transformOnlySyncCount: 0,
    edgeRebuildCount: 0,
    nodeRestyleCount: 0,
    labelLayoutCount: 0,
    visibleLabelCount: 0,
    visibleNodeLabelCount: 0,
    visibleProviderLabelCount: 0,
    qualityMode: "settled",
  });
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: DEFAULT_HEIGHT });
  const [isInteracting, setIsInteracting] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const personsById = useMemo(
    () => Object.fromEntries(persons.map((person) => [person.id, person])),
    [persons],
  );

  const model = useMemo(
    () =>
      buildIdentityGraphModel({
        persons,
        accounts,
        feeds,
        feedItems,
        mode: mode as IdentityGraphMode,
      }),
    [accounts, feedItems, feeds, mode, persons],
  );
  const modelSignature = useMemo(
    () => createIdentityGraphModelSignature(model),
    [model],
  );

  const getCachedTextStyle = useCallback(
    (cacheKey: string, options: ConstructorParameters<typeof TextStyle>[0]) => {
      const existing = textStyleCacheRef.current.get(cacheKey);
      if (existing) return existing;
      const style = new TextStyle(options);
      textStyleCacheRef.current.set(cacheKey, style);
      return style;
    },
    [],
  );

  const syncScene = useCallback(() => {
    const scene = pixiRef.current;
    if (!scene) return;

    const sceneStart = nowMs();
    const drag = dragStateRef.current;
    const transform = transformRef.current;
    const qualityMode = graphQualityModeRef.current;
    const graphPalette = readGraphThemePalette(containerRef.current);
    const hoveredNodeId = hoveredNodeIdRef.current;
    const highlighted = buildHighlightedNodeIds(
      layoutRef.current,
      selectedPersonId,
      selectedAccountId,
    );
    const accountDrag = drag?.kind === "account-drag" ? drag : null;
    const nodeById = new Map(layoutRef.current.nodes.map((node) => [node.id, node]));
    const staticRenderKey = [
      layoutVersion,
      themeId ?? "",
      accountDrag?.accountId ?? "",
      accountDrag?.dropTargetPersonId ?? "",
    ].join("|");
    let didStaticRender = false;
    let didLabelLayout = false;

    scene.world.position.set(transform.x, transform.y);
    scene.world.scale.set(transform.scale);

    if (lastStaticRenderKeyRef.current !== staticRenderKey || !!accountDrag) {
      didStaticRender = true;
      scene.regionLayer.clear();
      const staleRegionIds = new Set(scene.regionDisplays.keys());
      for (const region of layoutRef.current.regions) {
        staleRegionIds.delete(region.id);
        const fill = providerColor(region.provider, graphPalette);
        const alpha = region.unlinkedCount > 0 ? 0.12 : 0.075;
        scene.regionLayer.lineStyle(1.4, fill, highlighted.size > 0 ? 0.14 : 0.34);
        scene.regionLayer.beginFill(fill, highlighted.size > 0 ? alpha * 0.5 : alpha);
        scene.regionLayer.drawEllipse(region.x, region.y, region.radiusX, region.radiusY);
        scene.regionLayer.endFill();

        let display = scene.regionDisplays.get(region.id);
        if (!display) {
          display = createRegionDisplay(themeId);
          scene.regionDisplays.set(region.id, display);
          scene.regionLabelLayer.addChild(display.container);
        }
      }
      for (const staleRegionId of staleRegionIds) {
        const staleDisplay = scene.regionDisplays.get(staleRegionId);
        if (!staleDisplay) continue;
        scene.regionLabelLayer.removeChild(staleDisplay.container);
        staleDisplay.container.destroy({ children: true });
        scene.regionDisplays.delete(staleRegionId);
      }

      scene.edgeLayer.clear();
      scene.edgeLayer.alpha = 1;
      for (const edge of layoutRef.current.edges) {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) continue;
        const sourcePoint = nodePosition(source, drag);
        const targetPoint = nodePosition(target, drag);
        scene.edgeLayer.lineStyle(
          1.45,
          graphPalette.edge,
          0.52,
        );
        scene.edgeLayer.moveTo(sourcePoint.x, sourcePoint.y);
        scene.edgeLayer.lineTo(targetPoint.x, targetPoint.y);
      }
      perfSnapshotRef.current.edgeRebuildCount += 1;

      const staleNodeIds = new Set(scene.nodeDisplays.keys());
      for (const node of layoutRef.current.nodes) {
        staleNodeIds.delete(node.id);
        let display = scene.nodeDisplays.get(node.id);
        if (!display) {
          display = createNodeDisplay(node, graphPalette, themeId);
          scene.nodeDisplays.set(node.id, display);
          scene.nodeLayer.addChild(display.container);
        }

        const palette = kindColor(node, graphPalette);
        const alpha = nodeAlpha(
          node,
          highlighted,
          accountDrag?.dropTargetPersonId ?? null,
        );
        const position = nodePosition(node, drag);
        display.container.position.set(position.x, position.y);
        display.container.alpha = alpha;

        display.outer.clear();
        display.outer.lineStyle(
          1.4,
          palette.stroke,
          0.72,
        );
        display.outer.beginFill(
          palette.fill,
          node.kind === "feed" ? 0.72 : node.kind === "account" ? 0.9 : 0.96,
        );
        display.outer.drawCircle(0, 0, node.radius);
        display.outer.endFill();

        if (display.inner) {
          display.inner.clear();
          display.inner.beginFill(0xffffff, 0.08);
          display.inner.drawCircle(
            -node.radius * 0.22,
            -node.radius * 0.24,
            node.radius * 0.42,
          );
          display.inner.endFill();
        }

        if (display.initials) {
          display.initials.text = node.initials ?? "";
          display.initials.style = getCachedTextStyle(
            [
              "initials",
              themeId ?? "default",
              palette.text,
              Math.max(12, Math.round(node.radius * 0.48)),
            ].join(":"),
            {
              fill: palette.text,
              fontFamily:
                themeId === "scriptorium"
                  ? "Georgia, serif"
                  : "system-ui, sans-serif",
              fontSize: Math.max(12, node.radius * 0.48),
              fontWeight: "700",
              letterSpacing: 1,
            },
          );
        }

        if (display.providerDot) {
          display.providerDot.clear();
          display.providerDot.beginFill(graphPalette.selection, 0.72);
          display.providerDot.drawCircle(
            node.radius * 0.52,
            -node.radius * 0.52,
            Math.max(3, node.radius * 0.22),
          );
          display.providerDot.endFill();
        }

        display.highlightRing.clear();
        if (accountDrag?.dropTargetPersonId && node.personId === accountDrag.dropTargetPersonId) {
          display.highlightRing.lineStyle(4, graphPalette.highlight, 0.8);
          display.highlightRing.drawCircle(0, 0, node.radius + 6);
        }
      }

      for (const staleNodeId of staleNodeIds) {
        const staleDisplay = scene.nodeDisplays.get(staleNodeId);
        if (!staleDisplay) continue;
        scene.nodeLayer.removeChild(staleDisplay.container);
        staleDisplay.container.destroy({ children: true });
        scene.nodeDisplays.delete(staleNodeId);
      }

      perfSnapshotRef.current.nodeRestyleCount += layoutRef.current.nodes.length;
      if (!accountDrag) {
        lastStaticRenderKeyRef.current = staticRenderKey;
      }
      if (!layoutReadyRef.current && scene.nodeDisplays.size > 0) {
        layoutReadyRef.current = true;
        setLayoutReady(true);
      }
    }

    const selectionStyleKey = [
      layoutVersion,
      selectedPersonId ?? "",
      selectedAccountId ?? "",
      themeId ?? "",
      accountDrag?.dropTargetPersonId ?? "",
    ].join("|");

    if (lastSelectionStyleKeyRef.current !== selectionStyleKey || didStaticRender || !!accountDrag) {
      scene.edgeLayer.alpha = highlighted.size > 0 ? 0.42 : 1;
      scene.edgeHighlightLayer.clear();
      if (highlighted.size > 0) {
        for (const edge of layoutRef.current.edges) {
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          if (!source || !target) continue;
          if (!highlighted.has(source.id) || !highlighted.has(target.id)) continue;
          const sourcePoint = nodePosition(source, drag);
          const targetPoint = nodePosition(target, drag);
          scene.edgeHighlightLayer.lineStyle(2.4, graphPalette.highlight, 0.72);
          scene.edgeHighlightLayer.moveTo(sourcePoint.x, sourcePoint.y);
          scene.edgeHighlightLayer.lineTo(targetPoint.x, targetPoint.y);
        }
      }

      for (const node of layoutRef.current.nodes) {
        const display = scene.nodeDisplays.get(node.id);
        if (!display) continue;
        const palette = kindColor(node, graphPalette);
        const selected = isSelectedGraphNode(node, selectedPersonId, selectedAccountId);
        display.container.alpha = nodeAlpha(
          node,
          highlighted,
          accountDrag?.dropTargetPersonId ?? null,
        );
        display.outer.clear();
        display.outer.lineStyle(
          selected ? 3 : 1.4,
          selected ? graphPalette.selection : palette.stroke,
          selected ? 0.95 : 0.72,
        );
        display.outer.beginFill(
          palette.fill,
          node.kind === "feed" ? 0.72 : node.kind === "account" ? 0.9 : 0.96,
        );
        display.outer.drawCircle(0, 0, node.radius);
        display.outer.endFill();
      }
      lastSelectionStyleKeyRef.current = selectionStyleKey;
    }

    const providerMetrics = providerLabelMetrics(transform.scale);
    const providerLabelScale = 1 / transform.scale;
    let visibleProviderLabelCount = 0;
    for (const region of layoutRef.current.regions) {
      const display = scene.regionDisplays.get(region.id);
      if (!display) continue;
      const fill = providerColor(region.provider, graphPalette);
      const point = screenPointForPosition({ x: region.x, y: region.y }, transform);
      const onScreen =
        point.x >= -160 &&
        point.x <= canvasSize.width + 160 &&
        point.y >= -160 &&
        point.y <= canvasSize.height + 160;
      display.container.visible = onScreen;
      if (!onScreen) continue;

      visibleProviderLabelCount += 1;
      const label = `${region.label} ${region.count.toLocaleString()}`;
      const labelWidth = estimateLabelWidth(label, providerMetrics.fontSize) +
        providerMetrics.paddingX * 2;
      display.container.position.set(
        region.x,
        region.y - region.radiusY - providerMetrics.gap / transform.scale,
      );
      display.container.scale.set(providerLabelScale);
      display.container.alpha = highlighted.size > 0
        ? providerMetrics.alpha * 0.52
        : providerMetrics.alpha;
      display.background.clear();
      display.background.lineStyle(1.2, fill, 0.58);
      display.background.beginFill(graphPalette.labelFill, 0.88);
      display.background.drawRoundedRect(
        -labelWidth / 2,
        -providerMetrics.height / 2,
        labelWidth,
        providerMetrics.height,
        providerMetrics.height / 2,
      );
      display.background.endFill();
      display.text.text = label;
      display.text.style = getCachedTextStyle(
        [
          "region",
          themeId ?? "default",
          region.provider,
          providerMetrics.fontSize,
        ].join(":"),
        {
          fill,
          fontFamily: themeId === "scriptorium" ? "Georgia, serif" : "system-ui, sans-serif",
          fontSize: providerMetrics.fontSize,
          fontWeight: "700",
          letterSpacing: 1,
        },
      );
    }

    scene.hoverLayer.clear();
    if (hoveredNodeId) {
      const hoveredNode = nodeById.get(hoveredNodeId);
      if (hoveredNode && !isSelectedGraphNode(hoveredNode, selectedPersonId, selectedAccountId)) {
        const position = nodePosition(hoveredNode, drag);
        scene.hoverLayer.lineStyle(2, graphPalette.highlight, 0.44);
        scene.hoverLayer.drawCircle(position.x, position.y, hoveredNode.radius + 4);
      }
    }

    const transformBucketSize = qualityMode === "interactive" ? 220 : 64;
    const scaleBucketFactor = qualityMode === "interactive" ? 6 : 12;
    const labelLayoutKey = [
      layoutVersion,
      selectedPersonId ?? "",
      selectedAccountId ?? "",
      themeId ?? "",
      qualityMode,
      accountDrag?.dropTargetPersonId ?? "",
      qualityMode === "interactive" ? "stable" : Math.round(transform.scale * scaleBucketFactor),
      qualityMode === "interactive" ? "stable" : Math.round(transform.x / transformBucketSize),
      qualityMode === "interactive" ? "stable" : Math.round(transform.y / transformBucketSize),
    ].join("|");

    if (lastLabelLayoutKeyRef.current !== labelLayoutKey) {
      didLabelLayout = true;
      const labelStart = nowMs();
      const visibleLabels: Array<{
        node: IdentityGraphLayoutNode;
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
      }> = [];
      const viewportPadding = qualityMode === "interactive" ? 72 : 120;
      for (const node of layoutRef.current.nodes) {
        if (!shouldShowGraphLabel({
          node,
          scale: transform.scale,
          highlighted,
          selectedPersonId,
          selectedAccountId,
          qualityMode,
        })) {
          continue;
        }

        const point = screenPointForPosition(nodePosition(node, drag), transform);
        if (
          point.x < -viewportPadding ||
          point.x > canvasSize.width + viewportPadding ||
          point.y < -viewportPadding ||
          point.y > canvasSize.height + viewportPadding
        ) {
          continue;
        }

        const fontSize = graphNodeLabelFontSize(node, transform.scale);
        const width = estimateLabelWidth(node.label, fontSize);
        const height = fontSize + 10;
        visibleLabels.push({
          node,
          x: point.x,
          y: point.y + node.radius * transform.scale + 14,
          width,
          height,
          fontSize,
        });
      }

      visibleLabels.sort(
        (left, right) =>
          graphLabelSortValue(right.node, highlighted, selectedPersonId, selectedAccountId) -
            graphLabelSortValue(left.node, highlighted, selectedPersonId, selectedAccountId),
      );

      const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const nextVisibleLabelIds: string[] = [];
      const labelLimit =
        qualityMode === "interactive" ? INTERACTIVE_LABEL_LIMIT : SETTLED_LABEL_LIMIT;
      for (const label of visibleLabels) {
        if (nextVisibleLabelIds.length >= labelLimit) break;
        const bounds = {
          left: label.x - label.width / 2,
          right: label.x + label.width / 2,
          top: label.y,
          bottom: label.y + label.height,
        };
        const collides = occupied.some((rect) =>
          !(bounds.right < rect.left || bounds.left > rect.right || bounds.bottom < rect.top || bounds.top > rect.bottom),
        );
        if (collides) continue;
        occupied.push(bounds);
        nextVisibleLabelIds.push(label.node.id);
        const selected = isSelectedGraphNode(label.node, selectedPersonId, selectedAccountId);
        let display = scene.labelDisplays.get(label.node.id);
        if (!display) {
          display = createLabelDisplay(themeId);
          scene.labelDisplays.set(label.node.id, display);
          scene.labelLayer.addChild(display.container);
        }
        display.container.visible = true;
        display.container.position.set(label.x, label.y);
        display.background.clear();
        display.background.lineStyle(1.15, graphPalette.labelStroke, selected ? 0.78 : 0.46);
        display.background.beginFill(
          selected ? graphPalette.highlight : graphPalette.labelFill,
          selected ? 0.94 : 0.96,
        );
        display.background.drawRoundedRect(-label.width / 2, 0, label.width, label.height, 10);
        display.background.endFill();
        display.text.text = label.node.label;
        display.text.style = getCachedTextStyle(
          [
            "label",
            themeId ?? "default",
            selected ? "selected" : "default",
            label.node.kind,
            label.fontSize,
          ].join(":"),
          {
            fill: selected ? graphPalette.labelSelectedText : graphPalette.labelText,
            fontFamily: themeId === "scriptorium" ? "Georgia, serif" : "system-ui, sans-serif",
            fontSize: label.fontSize,
            fontWeight: selected || label.node.kind === "friend_person" ? "700" : "600",
          },
        );
      }

      visibleLabelIdsRef.current = nextVisibleLabelIds;
      lastLabelLayoutKeyRef.current = labelLayoutKey;
      perfSnapshotRef.current.labelLayoutCount += 1;
      perfSnapshotRef.current.labelPassMs = nowMs() - labelStart;
    }

    const currentVisibleLabelIds = new Set(visibleLabelIdsRef.current);
    for (const labelId of visibleLabelIdsRef.current) {
      const node = nodeById.get(labelId);
      const display = scene.labelDisplays.get(labelId);
      if (!node || !display) continue;
      const point = screenPointForPosition(nodePosition(node, drag), transform);
      const fontSize = graphNodeLabelFontSize(node, transform.scale);
      const labelWidth = estimateLabelWidth(node.label, fontSize);
      const labelHeight = fontSize + 10;
      const labelX = point.x;
      const labelY = point.y + node.radius * transform.scale + 14;
      const baseAlpha = nodeAlpha(
        node,
        highlighted,
        drag?.kind === "account-drag" ? drag.dropTargetPersonId : null,
      );
      display.container.visible = true;
      display.container.position.set(
        labelX,
        labelY,
      );
      display.container.alpha = baseAlpha * edgeFadeAlpha(
        labelX - labelWidth / 2,
        labelY,
        labelWidth,
        labelHeight,
        canvasSize.width,
        canvasSize.height,
      );
    }

    for (const [labelId, display] of scene.labelDisplays.entries()) {
      if (!currentVisibleLabelIds.has(labelId)) {
        display.container.visible = false;
      }
    }

    perfSnapshotRef.current.sceneSyncCount += 1;
    perfSnapshotRef.current.qualityMode = qualityMode;
    const visibleLabelCount = visibleLabelIdsRef.current.length + visibleProviderLabelCount;
    perfSnapshotRef.current.visibleLabelCount = visibleLabelCount;
    perfSnapshotRef.current.visibleNodeLabelCount = visibleLabelIdsRef.current.length;
    perfSnapshotRef.current.visibleProviderLabelCount = visibleProviderLabelCount;
    if (didStaticRender || didLabelLayout) {
      perfSnapshotRef.current.contentSyncCount += 1;
    } else {
      perfSnapshotRef.current.transformOnlySyncCount += 1;
    }
    perfSnapshotRef.current.modelBuildMs = model.buildMs;
    perfSnapshotRef.current.layoutMs = lastLayoutMsRef.current;
    perfSnapshotRef.current.sceneSyncMs = nowMs() - sceneStart;

    if (containerRef.current) {
      const personCount = layoutRef.current.nodes.filter((node) => !!node.personId).length;
      const channelCount = layoutRef.current.nodes.filter((node) => !!node.accountId || !!node.feedUrl).length;
      containerRef.current.dataset.graphNodeCount = String(layoutRef.current.nodes.length);
      containerRef.current.dataset.graphLinkCount = String(layoutRef.current.edges.length);
      containerRef.current.dataset.graphPersonCount = String(personCount);
      containerRef.current.dataset.graphChannelCount = String(channelCount);
      containerRef.current.dataset.visibleLabelCount = String(visibleLabelCount);
      containerRef.current.dataset.graphQualityMode = qualityMode;
    }
    if (typeof window !== "undefined") {
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: {
          nodes: Array<Pick<IdentityGraphLayoutNode, "id" | "personId" | "accountId" | "feedUrl" | "linkedPersonId" | "kind" | "x" | "y" | "radius">>;
          regions: IdentityGraphLayout["regions"];
          transform: ViewTransform;
          qualityMode: GraphQualityMode;
          metrics: GraphPerfSnapshot;
        };
      }).__FREED_GRAPH_DEBUG__ = {
        nodes: layoutRef.current.nodes.map((node) => ({
          id: node.id,
          personId: node.personId,
          accountId: node.accountId,
          feedUrl: node.feedUrl,
          linkedPersonId: node.linkedPersonId,
          kind: node.kind,
          x: nodePosition(node, drag).x,
          y: nodePosition(node, drag).y,
          radius: node.radius,
        })),
        regions: layoutRef.current.regions,
        transform: transformRef.current,
        qualityMode,
        metrics: { ...perfSnapshotRef.current },
      };
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    getCachedTextStyle,
    model.buildMs,
    selectedAccountId,
    selectedPersonId,
    themeId,
  ]);

  const scheduleSyncScene = useCallback(() => {
    cancelAnimationFrame(drawRafRef.current);
    drawRafRef.current = requestAnimationFrame(() => {
      syncScene();
    });
  }, [syncScene]);

  const markInteractive = useCallback(() => {
    if (graphQualityModeRef.current !== "interactive") {
      graphQualityModeRef.current = "interactive";
      scheduleSyncScene();
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    const settleWhenIdle = () => {
      if (
        dragStateRef.current ||
        pinchStateRef.current ||
        activeTouchPointsRef.current.size > 0
      ) {
        settleTimerRef.current = window.setTimeout(
          settleWhenIdle,
          GRAPH_INTERACTION_SETTLE_DELAY_MS,
        );
        return;
      }
      graphQualityModeRef.current = "settled";
      settleTimerRef.current = null;
      scheduleSyncScene();
    };
    settleTimerRef.current = window.setTimeout(
      settleWhenIdle,
      GRAPH_INTERACTION_SETTLE_DELAY_MS,
    );
  }, [scheduleSyncScene]);

  const fitAll = useCallback(() => {
    if (layoutRef.current.nodes.length === 0) return;
    transformRef.current = fitTransformToNodes(
      graphFitItems(layoutRef.current),
      canvasSize.width,
      canvasSize.height,
      FIT_PADDING,
    );
    scheduleSyncScene();
  }, [canvasSize.height, canvasSize.width, scheduleSyncScene]);

  const focusNode = useCallback((id: string) => {
    const hit = layoutRef.current.nodes.find(
      (node) => node.id === id || node.personId === id || node.accountId === id,
    );
    if (!hit) return;
    const scale = transformRef.current.scale;
    transformRef.current = {
      x: canvasSize.width / 2 - hit.x * scale,
      y: canvasSize.height / 2 - hit.y * scale,
      scale,
    };
    scheduleSyncScene();
  }, [canvasSize.height, canvasSize.width, scheduleSyncScene]);

  useImperativeHandle(
    ref,
    () => ({
      fitAll,
      focusNode,
    }),
    [fitAll, focusNode],
  );

  useEffect(() => {
    const container = containerRef.current;
    const canvasHost = canvasHostRef.current;
    if (!container || !canvasHost) return;

    let cancelled = false;
    const app = new Application();

    void (async () => {
      await app.init({
        resizeTo: canvasHost,
        backgroundAlpha: 0,
        antialias: true,
        preference: "webgl",
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }

      app.canvas.setAttribute("data-testid", "friend-graph-canvas");
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.pointerEvents = "none";
      canvasHost.appendChild(app.canvas);

      const world = new Container();
      const regionLayer = new Graphics();
      const regionLabelLayer = new Container();
      const edgeLayer = new Graphics();
      const edgeHighlightLayer = new Graphics();
      const nodeLayer = new Container();
      const hoverLayer = new Graphics();
      const labelLayer = new Container();
      world.addChild(regionLayer);
      world.addChild(edgeLayer);
      world.addChild(edgeHighlightLayer);
      world.addChild(nodeLayer);
      world.addChild(hoverLayer);
      world.addChild(regionLabelLayer);
      app.stage.addChild(world);
      app.stage.addChild(labelLayer);
      pixiRef.current = {
        app,
        world,
        regionLayer,
        regionLabelLayer,
        edgeLayer,
        edgeHighlightLayer,
        nodeLayer,
        hoverLayer,
        labelLayer,
        nodeDisplays: new Map(),
        regionDisplays: new Map(),
        labelDisplays: new Map(),
      };
      scheduleSyncScene();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(drawRafRef.current);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      pixiRef.current?.app.destroy(true);
      pixiRef.current = null;
    };
  }, [scheduleSyncScene]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setCanvasSize({
        width: Math.max(320, container.clientWidth),
        height: Math.max(320, container.clientHeight || DEFAULT_HEIGHT),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventGestureDefault = (event: Event) => {
      event.preventDefault();
    };

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
    const worker = new Worker(
      new URL("../../lib/identity-graph-layout.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ requestId: number; layout: IdentityGraphLayout; durationMs: number }>) => {
      if (event.data.requestId < latestResolvedLayoutRequestIdRef.current) return;
      latestResolvedLayoutRequestIdRef.current = event.data.requestId;
      layoutRef.current = event.data.layout;
      spatialIndexRef.current = buildSpatialIndex(event.data.layout.nodes);
      lastLayoutMsRef.current = event.data.durationMs;
      if (!hasFittedInitialLayoutRef.current) {
        transformRef.current = fitTransformToNodes(
          graphFitItems(event.data.layout),
          canvasSize.width,
          canvasSize.height,
          FIT_PADDING,
        );
        hasFittedInitialLayoutRef.current = true;
      }
      setLayoutVersion((value) => value + 1);
      scheduleSyncScene();
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [canvasSize.height, canvasSize.width, scheduleSyncScene]);

  useEffect(() => {
    if (!workerRef.current || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const previousSnapshot = previousRequestSnapshotRef.current;
    const sizeOnlyResize =
      previousSnapshot &&
      previousSnapshot.signature === modelSignature &&
      Math.abs(previousSnapshot.width - canvasSize.width) / Math.max(previousSnapshot.width, 1) <= 0.12 &&
      Math.abs(previousSnapshot.height - canvasSize.height) / Math.max(previousSnapshot.height, 1) <= 0.12;
    const relinkOnly =
      countLinkedAccountChanges(previousRequestedModelRef.current, model) === 1;
    const quality: GraphLayoutQuality = sizeOnlyResize || relinkOnly ? "fast" : "full";
    const requestId = latestLayoutRequestIdRef.current + 1;
    latestLayoutRequestIdRef.current = requestId;
    previousRequestSnapshotRef.current = {
      signature: modelSignature,
      width: canvasSize.width,
      height: canvasSize.height,
    };
    previousRequestedModelRef.current = model;
    workerRef.current.postMessage({
      requestId,
      model,
      width: canvasSize.width,
      height: canvasSize.height,
      quality,
    });
  }, [canvasSize.height, canvasSize.width, model, modelSignature]);

  useEffect(() => {
    if (!layoutReady && layoutRef.current.nodes.length > 0) {
      fitAll();
      return;
    }
    scheduleSyncScene();
  }, [fitAll, layoutReady, layoutVersion, modelSignature, scheduleSyncScene, selectedAccountId, selectedPersonId]);

  const viewportToWorld = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: (localX - transformRef.current.x) / transformRef.current.scale,
      y: (localY - transformRef.current.y) / transformRef.current.scale,
    };
  }, []);

  const hitNodeAt = useCallback((clientX: number, clientY: number) => {
    const point = viewportToWorld(clientX, clientY);
    return findHitNode(spatialIndexRef.current, point.x, point.y);
  }, [viewportToWorld]);

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
    scheduleSyncScene();
  }, [scheduleSyncScene]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    markInteractive();
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.exp(-event.deltaY * TRACKPAD_PINCH_ZOOM_SPEED);
      zoomAtPoint(event.clientX, event.clientY, transformRef.current.scale * delta);
      return;
    }

    transformRef.current = {
      ...transformRef.current,
      x: transformRef.current.x - event.deltaX,
      y: transformRef.current.y - event.deltaY,
    };
    scheduleSyncScene();
  }, [markInteractive, scheduleSyncScene, zoomAtPoint]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    container.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (activeTouchPointsRef.current.size >= 2) {
        const [firstEntry, secondEntry] = [...activeTouchPointsRef.current.entries()];
        if (firstEntry && secondEntry) {
          const initialDistance = distanceBetween(firstEntry[1], secondEntry[1]);
          if (initialDistance > 0) {
            pinchStateRef.current = {
              pointerIds: [firstEntry[0], secondEntry[0]],
              initialDistance,
              initialScale: transformRef.current.scale,
              moved: false,
            };
            dragStateRef.current = null;
            setIsInteracting(true);
            markInteractive();
            event.preventDefault();
            return;
          }
        }
      }
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
        dropTargetPersonId: null,
        currentWorldX: point.x,
        currentWorldY: point.y,
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
    setIsInteracting(true);
    markInteractive();
  }, [hitNodeAt, markInteractive, viewportToWorld]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      const first = activeTouchPointsRef.current.get(pinch.pointerIds[0]);
      const second = activeTouchPointsRef.current.get(pinch.pointerIds[1]);
      if (!first || !second) return;

      const currentDistance = distanceBetween(first, second);
      if (currentDistance <= 0) return;

      pinch.moved =
        pinch.moved || Math.abs(currentDistance - pinch.initialDistance) > 4;
      const midpoint = midpointBetween(first, second);
      zoomAtPoint(
        midpoint.x,
        midpoint.y,
        pinch.initialScale * (currentDistance / pinch.initialDistance),
      );
      markInteractive();
      event.preventDefault();
      return;
    }

    const drag = dragStateRef.current;
    if (!drag) {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        const hit = hitNodeAt(event.clientX, event.clientY);
        const nextHoveredNodeId = hit?.id ?? null;
        if (hoveredNodeIdRef.current !== nextHoveredNodeId) {
          hoveredNodeIdRef.current = nextHoveredNodeId;
          scheduleSyncScene();
        }
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;

    if (drag.kind === "pan") {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        drag.moved = true;
      }
      transformRef.current = {
        ...transformRef.current,
        x: drag.originX + deltaX,
        y: drag.originY + deltaY,
      };
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
      markInteractive();
      scheduleSyncScene();
      return;
    }

    const point = viewportToWorld(event.clientX, event.clientY);
    drag.currentWorldX = point.x;
    drag.currentWorldY = point.y;
    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) {
      drag.moved = true;
    }

    if (drag.kind === "person-drag") {
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
      markInteractive();
      scheduleSyncScene();
      return;
    }

    const hit = hitNodeAt(event.clientX, event.clientY);
    drag.dropTargetPersonId = hit?.personId ?? null;
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    markInteractive();
    scheduleSyncScene();
  }, [hitNodeAt, markInteractive, scheduleSyncScene, viewportToWorld, zoomAtPoint]);

  const handlePointerUp = useCallback(async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }

    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      setIsInteracting(activeTouchPointsRef.current.size > 0);
      scheduleSyncScene();
      return;
    }

    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsInteracting(false);

    if (drag.kind === "account-drag") {
      if (drag.moved && drag.dropTargetPersonId && onLinkAccountToPerson) {
        await onLinkAccountToPerson(drag.accountId, drag.dropTargetPersonId);
      } else if (drag.moved) {
        await onPinAccountPosition?.(drag.accountId, drag.currentWorldX, drag.currentWorldY);
      } else if (!drag.moved) {
        const account = accounts[drag.accountId];
        if (account) {
          onSelectAccount(account);
        }
      }
      scheduleSyncScene();
      return;
    }

    if (drag.kind === "person-drag") {
      if (drag.moved) {
        await onPinPersonPosition?.(drag.personId, drag.currentWorldX, drag.currentWorldY);
      } else {
        const person = personsById[drag.personId];
        if (person) {
          onSelectPerson(person);
        }
      }
      scheduleSyncScene();
      return;
    }

    if (drag.moved) {
      scheduleSyncScene();
      return;
    }

    const hit = hitNodeAt(event.clientX, event.clientY);
    if (!hit) {
      onClearSelection?.();
      scheduleSyncScene();
      return;
    }
    if (hit.personId) {
      const person = personsById[hit.personId];
      if (person) {
        onSelectPerson(person);
      }
    } else if (hit.accountId) {
      const account = accounts[hit.accountId];
      if (account) {
        onSelectAccount(account);
      }
    }
    scheduleSyncScene();
  }, [accounts, hitNodeAt, onClearSelection, onLinkAccountToPerson, onPinAccountPosition, onPinPersonPosition, onSelectAccount, onSelectPerson, personsById, scheduleSyncScene]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      scheduleSyncScene();
    }
    if (event.pointerType === "touch") {
      activeTouchPointsRef.current.delete(event.pointerId);
    }
    const pinch = pinchStateRef.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      setIsInteracting(activeTouchPointsRef.current.size > 0);
      scheduleSyncScene();
      return;
    }
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsInteracting(false);
    scheduleSyncScene();
  }, [scheduleSyncScene]);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="friend-graph-viewport"
      className="relative h-full w-full overflow-hidden touch-none overscroll-contain"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleDoubleClick}
      aria-label="Friends identity graph"
    >
      <div className="absolute inset-0">
        <div ref={canvasHostRef} className="absolute inset-0" />
        {!layoutReady ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-full border border-[color:rgb(var(--theme-border-rgb)/0.25)] bg-[color:rgb(var(--theme-surface-rgb)/0.8)] px-4 py-2 text-xs text-[color:var(--theme-text-muted)] backdrop-blur-sm">
              Building graph...
            </div>
          </div>
        ) : null}
        <div
          data-testid="friend-graph-canvas-overlay"
          className={`absolute inset-0 ${isInteracting ? "cursor-grabbing" : "cursor-grab"}`}
        />
      </div>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <button
          type="button"
          className={CONTROL_BASE}
          onClick={fitAll}
        >
          Fit all
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-full border border-[color:rgb(var(--theme-border-rgb)/0.24)] bg-[color:rgb(var(--theme-surface-rgb)/0.72)] px-3 py-1 text-[11px] text-[color:var(--theme-text-muted)] shadow-[0_10px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        {model.nodes.length.toLocaleString()} nodes, {model.edges.length.toLocaleString()} links
      </div>
    </div>
  );
});
