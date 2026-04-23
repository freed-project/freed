import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import {
  type CSSProperties,
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

type DragState = PanState | AccountDragState;

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
  edgeLayer: Graphics;
  nodeLayer: Container;
  labelLayer: Container;
  nodeDisplays: Map<string, NodeDisplay>;
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

const DEFAULT_HEIGHT = 560;
const FIT_PADDING = 84;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.8;
const TRACKPAD_PINCH_ZOOM_SPEED = 0.005;
const GRAPH_INTERACTION_SETTLE_DELAY_MS = 140;
const INTERACTIVE_LABEL_LIMIT = 16;
const CONTROL_BASE = "btn-secondary rounded-xl px-3 py-1.5 text-xs";
const FRIEND_GRAPH_VIEWPORT_MASK_STYLE = {
  "--theme-soft-viewport-base-comp-left": "0px",
  "--theme-soft-viewport-base-comp-right": "0px",
  "--theme-soft-viewport-base-comp-top": "0px",
  "--theme-soft-viewport-base-comp-bottom": "0px",
} as CSSProperties;

const PROVIDER_COLORS: Record<string, number> = {
  instagram: 0xd87093,
  facebook: 0x4b79d8,
  x: 0x64748b,
  linkedin: 0x3b82c4,
  rss: 0xb07a44,
};

const SCRIPTORIUM_PALETTE = {
  friendFill: 0xb98047,
  friendStroke: 0x2f1f12,
  friendText: 0x20140b,
  connectionFill: 0xd1ab77,
  connectionStroke: 0x5d432d,
  connectionText: 0x24160d,
  feedFill: 0x8e6f4d,
  feedStroke: 0x463221,
  labelFill: 0xf0e0c7,
  labelStroke: 0x715335,
  labelText: 0x24170d,
  edge: 0x5a4430,
  selection: 0x1c1712,
  highlight: 0x224f3d,
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
  visibleLabelCount: number;
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

function kindColor(node: IdentityGraphLayoutNode, themeId?: ThemeId) {
  const palette = SCRIPTORIUM_PALETTE;
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
      fill: palette.feedFill,
      stroke: palette.feedStroke,
      text: palette.labelText,
    };
  }
  const providerColor = PROVIDER_COLORS[node.provider ?? "x"] ?? PROVIDER_COLORS.x;
  if (themeId === "scriptorium") {
    return {
      fill: providerColor,
      stroke: palette.selection,
      text: palette.labelText,
    };
  }
  return {
    fill: providerColor,
    stroke: palette.selection,
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
  return { x: node.x, y: node.y };
}

function createNodeDisplay(
  node: IdentityGraphLayoutNode,
  themeId?: ThemeId,
): NodeDisplay {
  const palette = kindColor(node, themeId);
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
        fill: palette.text,
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
      fill: SCRIPTORIUM_PALETTE.labelText,
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
    themeId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const layoutRef = useRef<IdentityGraphLayout>({ nodes: [], edges: [] });
  const spatialIndexRef = useRef<SpatialIndex>({ cellSize: 96, buckets: new Map() });
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const activeTouchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const hasFittedInitialLayoutRef = useRef(false);
  const latestLayoutRequestIdRef = useRef(0);
  const latestResolvedLayoutRequestIdRef = useRef(0);
  const drawRafRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const lastStaticRenderKeyRef = useRef("");
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
    const highlighted = buildHighlightedNodeIds(
      layoutRef.current,
      selectedPersonId,
      selectedAccountId,
    );
    const accountDrag = drag?.kind === "account-drag" ? drag : null;
    const nodeById = new Map(layoutRef.current.nodes.map((node) => [node.id, node]));
    const staticRenderKey = [
      layoutVersion,
      selectedPersonId ?? "",
      selectedAccountId ?? "",
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
      scene.edgeLayer.clear();
      scene.edgeLayer.alpha = 1;
      for (const edge of layoutRef.current.edges) {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) continue;
        const sourcePoint = nodePosition(source, drag);
        const targetPoint = nodePosition(target, drag);
        const emphasized = highlighted.has(source.id) && highlighted.has(target.id);
        scene.edgeLayer.lineStyle(
          emphasized ? 2.1 : 1,
          emphasized ? SCRIPTORIUM_PALETTE.highlight : SCRIPTORIUM_PALETTE.edge,
          emphasized ? 0.56 : highlighted.size > 0 ? 0.12 : 0.24,
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
          display = createNodeDisplay(node, themeId);
          scene.nodeDisplays.set(node.id, display);
          scene.nodeLayer.addChild(display.container);
        }

        const palette = kindColor(node, themeId);
        const selected = isSelectedGraphNode(node, selectedPersonId, selectedAccountId);
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
          selected ? 3 : 1.4,
          selected ? SCRIPTORIUM_PALETTE.selection : palette.stroke,
          selected ? 0.95 : 0.72,
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
          display.providerDot.beginFill(SCRIPTORIUM_PALETTE.selection, 0.72);
          display.providerDot.drawCircle(
            node.radius * 0.52,
            -node.radius * 0.52,
            Math.max(3, node.radius * 0.22),
          );
          display.providerDot.endFill();
        }

        display.highlightRing.clear();
        if (
          accountDrag?.dropTargetPersonId &&
          node.personId === accountDrag.dropTargetPersonId
        ) {
          display.highlightRing.lineStyle(4, SCRIPTORIUM_PALETTE.highlight, 0.8);
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
      Math.round(transform.scale * scaleBucketFactor),
      Math.round(transform.x / transformBucketSize),
      Math.round(transform.y / transformBucketSize),
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

        const fontSize = node.kind === "friend_person" ? 14 : node.kind === "connection_person" ? 13 : 12;
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
        qualityMode === "interactive" ? INTERACTIVE_LABEL_LIMIT : Number.POSITIVE_INFINITY;
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
        display.background.lineStyle(1.15, SCRIPTORIUM_PALETTE.labelStroke, selected ? 0.78 : 0.46);
        display.background.beginFill(
          selected ? SCRIPTORIUM_PALETTE.highlight : SCRIPTORIUM_PALETTE.labelFill,
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
            fill: selected ? 0xf7f4ed : SCRIPTORIUM_PALETTE.labelText,
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
      display.container.visible = true;
      display.container.position.set(
        point.x,
        point.y + node.radius * transform.scale + 14,
      );
      display.container.alpha = nodeAlpha(
        node,
        highlighted,
        drag?.kind === "account-drag" ? drag.dropTargetPersonId : null,
      );
    }

    for (const [labelId, display] of scene.labelDisplays.entries()) {
      if (!currentVisibleLabelIds.has(labelId)) {
        display.container.visible = false;
      }
    }

    perfSnapshotRef.current.sceneSyncCount += 1;
    perfSnapshotRef.current.qualityMode = qualityMode;
    perfSnapshotRef.current.visibleLabelCount = visibleLabelIdsRef.current.length;
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
      containerRef.current.dataset.visibleLabelCount = String(visibleLabelIdsRef.current.length);
      containerRef.current.dataset.graphQualityMode = qualityMode;
    }
    if (typeof window !== "undefined") {
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: {
          nodes: Array<Pick<IdentityGraphLayoutNode, "id" | "personId" | "accountId" | "feedUrl" | "linkedPersonId" | "kind" | "x" | "y" | "radius">>;
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
    settleTimerRef.current = window.setTimeout(() => {
      graphQualityModeRef.current = "settled";
      settleTimerRef.current = null;
      scheduleSyncScene();
    }, GRAPH_INTERACTION_SETTLE_DELAY_MS);
  }, [scheduleSyncScene]);

  const fitAll = useCallback(() => {
    if (layoutRef.current.nodes.length === 0) return;
    transformRef.current = fitTransformToNodes(
      layoutRef.current.nodes,
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
      const edgeLayer = new Graphics();
      const nodeLayer = new Container();
      const labelLayer = new Container();
      world.addChild(edgeLayer);
      world.addChild(nodeLayer);
      app.stage.addChild(world);
      app.stage.addChild(labelLayer);
      pixiRef.current = {
        app,
        world,
        edgeLayer,
        nodeLayer,
        labelLayer,
        nodeDisplays: new Map(),
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
          event.data.layout.nodes,
          canvasSize.width,
          canvasSize.height,
          FIT_PADDING,
        );
        hasFittedInitialLayoutRef.current = true;
        setLayoutReady(true);
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
    if (!drag || drag.pointerId !== event.pointerId) return;

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
        focusNode(drag.dropTargetPersonId);
      } else if (!drag.moved) {
        const account = accounts[drag.accountId];
        if (account) {
          onSelectAccount(account);
          focusNode(drag.accountId);
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
        focusNode(hit.personId);
      }
    } else if (hit.accountId) {
      const account = accounts[hit.accountId];
      if (account) {
        onSelectAccount(account);
        focusNode(hit.accountId);
      }
    }
    scheduleSyncScene();
  }, [accounts, focusNode, hitNodeAt, onClearSelection, onLinkAccountToPerson, onSelectAccount, onSelectPerson, personsById, scheduleSyncScene]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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
    const hit = hitNodeAt(event.clientX, event.clientY);
    if (hit) {
      focusNode(hit.id);
    } else {
      fitAll();
    }
  }, [fitAll, focusNode, hitNodeAt]);

  return (
    <div
      ref={containerRef}
      data-testid="friend-graph-viewport"
      className="theme-soft-viewport relative h-full w-full overflow-hidden touch-none overscroll-contain"
      style={FRIEND_GRAPH_VIEWPORT_MASK_STYLE}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleDoubleClick}
      aria-label="Friends identity graph"
    >
      <div className="theme-soft-viewport-content">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,247,232,0.34),transparent_36%),radial-gradient(circle_at_12%_84%,rgba(188,143,88,0.1),transparent_26%),linear-gradient(180deg,rgba(244,234,215,0.98),rgba(235,223,201,0.94))]" />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_72px_rgba(84,58,35,0.12),inset_0_0_0_1px_rgba(92,71,52,0.12)]" />
        <div ref={canvasHostRef} className="absolute inset-0" />
        {!layoutReady ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-full border border-[color:rgb(var(--theme-border-rgb)/0.25)] bg-[color:rgb(var(--theme-surface-rgb)/0.8)] px-4 py-2 text-xs text-[color:var(--theme-text-muted)] backdrop-blur-sm">
              Building graph…
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
