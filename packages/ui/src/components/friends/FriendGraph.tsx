import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MapMode } from "@freed/shared";
import type { ThemeId } from "@freed/shared/themes";
import { type LibraryCoreNormalizedQueryExecutor } from "@freed/shared/library-core";
import { useLibraryPersonPicker } from "../../hooks/useLibraryPersonPicker.js";
import {
  friendsGalaxyGraphDescription,
  friendsGalaxyRecoveryAnnouncement,
  friendsGalaxySelectionAnnouncement,
  friendsGalaxyUnavailableAnnouncement,
} from "../../lib/friends-galaxy-accessibility.js";
import { diffFriendsGalaxyIdentityActivitySummaries } from "../../lib/friends-galaxy-activity-index.js";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../lib/friends-galaxy-camera.js";
import { useCommandSurfaceStore } from "../../lib/command-surface-store.js";
import {
  createFriendsGalaxyDiagnosticSnapshot,
  serializeFriendsGalaxyDiagnosticSnapshot,
} from "../../lib/friends-galaxy-diagnostics.js";
import { FriendsGalaxyInputController } from "../../lib/friends-galaxy-input-controller.js";
import type { FriendsGalaxyContextTarget } from "../../lib/friends-galaxy-interaction.js";
import { FriendsGalaxyProductEngine } from "../../lib/friends-galaxy-product-engine.js";
import type {
  FriendsGalaxyProductWorkerActivityResponse,
  FriendsGalaxyProductWorkerPresentationResponse,
  FriendsGalaxyProductWorkerSourceResponse,
} from "../../lib/friends-galaxy-product-worker-protocol.js";
import { projectFriendsGalaxyWorldPoint } from "../../lib/friends-galaxy-projection.js";
import type { FriendsGalaxyRendererScene } from "../../lib/friends-galaxy-renderer.js";
import { FRIENDS_GALAXY_SQLITE_SOURCE_FENCE_CHANGED } from "../../lib/friends-galaxy-sqlite-source.js";
import { friendsGalaxyRendererPaletteForTheme } from "../../lib/friends-galaxy-theme-palettes.js";
import type {
  FriendsGalaxyTransform,
  FriendsGalaxyViewportGeometry,
} from "../../lib/friends-galaxy-viewport.js";
import { FriendsGalaxySourceScheduler } from "../../lib/friends-galaxy-source-scheduler.js";
import {
  EMPTY_IDENTITY_GRAPH_ACTIVITY_SUMMARIES,
  type IdentityGraphActivitySummaries,
} from "../../lib/identity-graph-activity-summary.js";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
} from "../../lib/identity-graph-atlas.js";
import { IdentityGalaxyNodeKindCode } from "../../lib/identity-galaxy-scene.js";
import { CANVAS_CONTROL_BUTTON_CLASS } from "../layout/layoutConstants.js";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusNode: (nodeId: string) => void;
  setPresentationVisible: (visible: boolean) => void;
}

export type FriendGraphContextResolver = (
  target: FriendsGalaxyContextTarget,
) => Promise<IdentityGraphAtlasNode | null>;

interface FriendGraphProps {
  sqliteGraphQuery: LibraryCoreNormalizedQueryExecutor;
  sourceVersion: number;
  mode: MapMode;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  onSelectPersonId: (personId: string) => void;
  onSelectAccountId: (accountId: string) => void;
  onSourceCounts: (
    counts: Readonly<{
      channelCount: number;
      linkedAccountCount: number;
      personCount: number;
    }>,
  ) => void;
  resolveContextNode: FriendGraphContextResolver;
  onClearSelection?: () => void;
  onLinkAccountToPerson?: (
    accountId: string,
    personId: string,
  ) => Promise<void> | void;
  onPinPersonPosition?: (
    personId: string,
    x: number,
    y: number,
  ) => Promise<void> | void;
  onPinAccountPosition?: (
    accountId: string,
    x: number,
    y: number,
  ) => Promise<void> | void;
  onDropNodeToRelationshipTier?: (drop: {
    personId?: string;
    accountId?: string;
    level: 1 | 3 | 5;
  }) => Promise<void> | void;
  themeId?: ThemeId;
  presentationVisible?: boolean;
  controlsAdjacentToSidebar?: boolean;
}

interface GraphContextMenuState {
  x: number;
  y: number;
  node: IdentityGraphAtlasNode;
}

interface GraphDebugNode {
  id: string;
  personId?: string;
  accountId?: string;
  feedUrl?: string;
  linkedPersonId?: string | null;
  kind: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  radius: number;
}

interface GraphSurfacePerfSnapshot {
  modelBuildMs: number;
  layoutMs: number;
  sceneSyncMs: number;
  labelPassMs: number;
  sceneSyncCount: number;
  presentationSyncCount: number;
  activitySyncCount: number;
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
  bufferUploadCount: number;
  presentationInFlight: boolean;
  presentationQueued: boolean;
  activityInFlight: boolean;
  activityQueued: boolean;
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
  decorativeStarCount: number;
  decorativeStarMode: DecorativeStarMode;
  firstVisibleMs: number;
  lastBuildMs: number;
  frameP95Ms: number;
  longTaskCount: number;
  memoryEstimateBytes: number;
  rendererType: string;
  touchInputMode: string;
  lod: "overview" | "middle" | "detail";
  capped: boolean;
  nodeCount: number;
  linkCount: number;
  personCount: number;
  channelCount: number;
  transformScale: number;
}

interface GraphDiagnosticState {
  sourceScene: FriendsGalaxyRendererScene | null;
  presentationAtlas: IdentityGraphAtlas | null;
  sourceReceipt: FriendsGalaxyProductWorkerSourceResponse["receipt"] | null;
  sourceDurationMs: number;
  sceneSyncMs: number;
  sceneSyncCount: number;
  presentationSyncCount: number;
  activitySyncCount: number;
  sourceAdmissionCount: number;
  transformOnlySyncCount: number;
  lastTransform: FriendsGalaxyTransform | null;
  firstVisibleMs: number;
  lastBuildMs: number;
  activityPatchKeyCount: number;
  activityPatchNodeCount: number;
  unknownActivitySourceCount: number;
}

interface ScheduledFriendsGalaxySource {
  readonly backgroundSeed: string;
  readonly backgroundStarCount: number;
  fallbackBaseline: IdentityGraphActivitySummaries;
  readonly mode: MapMode;
  readonly proceduralBackgroundStarCount: number;
  readonly sourceRevision: number;
  readonly viewport: {
    readonly height: number;
    readonly selectedAccountId?: string | null;
    readonly selectedPersonId?: string | null;
    readonly width: number;
  };
}

const BACKGROUND_STAR_COUNT = 100_000;
type DecorativeStarMode = "buffered" | "procedural" | "off";
const DECORATIVE_STAR_MODE: DecorativeStarMode = "procedural";
const CONTROL_BASE = "btn-secondary rounded-lg px-3 py-1.5 text-xs shadow-sm";
const MENU_WIDTH = 264;
const MENU_ESTIMATED_HEIGHT = 376;

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function shouldExposeGraphDebug(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as typeof window & { __FREED_GRAPH_DEBUG_ENABLED__?: boolean })
      .__FREED_GRAPH_DEBUG_ENABLED__ === true
  );
}

function nodeKindLabel(node: IdentityGraphAtlasNode): string {
  if (node.kind === "friend_person") return "Friend";
  if (node.kind === "connection_person") return "Connection";
  if (node.kind === "feed") return "Feed";
  if (node.kind === "provider_cluster") return "Galaxy";
  return node.provider ? `${node.provider} account` : "Account";
}

function lodForScale(scale: number): GraphSurfacePerfSnapshot["lod"] {
  if (scale < 0.24) return "overview";
  if (scale < 0.9) return "middle";
  return "detail";
}

function graphDebugNodes(
  scene: FriendsGalaxyRendererScene,
  transform: FriendsGalaxyTransform,
  geometry: FriendsGalaxyViewportGeometry,
): GraphDebugNode[] {
  const matrix = new Float32Array(16);
  const point = new Float32Array(2);
  writeFriendsGalaxyWebGpuViewProjection(
    matrix,
    transform,
    geometry.canvasWidth,
    geometry.canvasHeight,
  );
  const scale = Math.max(0.0001, transform.scale);
  const metadataByNodeId = new Map(
    scene.atlas.nodes.map((node) => [node.id, node]),
  );
  return scene.scene.nodeIds.map((id, nodeIndex) => {
    const offset = nodeIndex * 3;
    const worldX = scene.scene.positions[offset]!;
    const worldY = -scene.scene.positions[offset + 1]!;
    const metadata = metadataByNodeId.get(id);
    let screenX = transform.x + worldX * scale;
    let screenY = transform.y + worldY * scale;
    projectFriendsGalaxyWorldPoint(
      point,
      {
        viewProjection: matrix,
        width: geometry.canvasWidth,
        height: geometry.canvasHeight,
      },
      scene.scene.positions[offset]!,
      scene.scene.positions[offset + 1]!,
      scene.scene.positions[offset + 2]!,
    );
    screenX = point[0]!;
    screenY = point[1]!;
    const kindCode = scene.scene.kinds[nodeIndex];
    const kind =
      kindCode === IdentityGalaxyNodeKindCode.FriendPerson
        ? "friend_person"
        : kindCode === IdentityGalaxyNodeKindCode.ConnectionPerson
          ? "connection_person"
          : kindCode === IdentityGalaxyNodeKindCode.Feed
            ? "feed"
            : "account";
    const personId = scene.scene.personIds[nodeIndex] ?? undefined;
    const accountId = scene.scene.accountIds[nodeIndex] ?? undefined;
    const linkedPersonId = scene.scene.linkedPersonIds[nodeIndex];
    return {
      id,
      personId,
      accountId,
      feedUrl:
        metadata?.feedUrl ??
        (id.startsWith("feed:") ? id.slice("feed:".length) : undefined),
      linkedPersonId,
      kind,
      x: metadata?.x ?? worldX,
      y: metadata?.y ?? worldY,
      screenX,
      screenY,
      radius: metadata?.radius ?? scene.scene.radii[nodeIndex]!,
    };
  });
}

export const FriendGraph = forwardRef<FriendGraphHandle, FriendGraphProps>(
  function FriendGraph(
    {
      sqliteGraphQuery,
      sourceVersion,
      mode,
      selectedPersonId,
      selectedAccountId,
      onSelectPersonId,
      onSelectAccountId,
      onSourceCounts,
      resolveContextNode,
      onClearSelection,
      onLinkAccountToPerson,
      onPinPersonPosition,
      onPinAccountPosition,
      onDropNodeToRelationshipTier,
      themeId,
      presentationVisible = true,
      controlsAdjacentToSidebar = false,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<FriendsGalaxyProductEngine | null>(null);
    const controllerRef = useRef<FriendsGalaxyInputController | null>(null);
    const canvasHostRef = useRef<HTMLDivElement | null>(null);
    const mountedAtRef = useRef(nowMs());
    const sourceBuildStartedAtRef = useRef(mountedAtRef.current);
    const sqliteGraphQueryRef = useRef(sqliteGraphQuery);
    const graphReadyRef = useRef(false);
    const diagnosticsOwnerRef = useRef({});
    const recoveringRef = useRef(false);
    const contextMenuOpenRef = useRef(false);
    const contextResolutionRef = useRef(0);
    const sourceRevisionRef = useRef(0);
    const activityRevisionRef = useRef(0);
    const sourceSchedulerRef =
      useRef<FriendsGalaxySourceScheduler<ScheduledFriendsGalaxySource> | null>(
        null,
      );
    const sourceControlSignatureRef = useRef<string | null>(null);
    const nextSourceImmediateRef = useRef(false);
    const sourceActivityBaselineRef = useRef(
      new Map<number, IdentityGraphActivitySummaries>(),
    );
    const lastAppliedActivityRef =
      useRef<IdentityGraphActivitySummaries | null>(null);
    const latestActivityRef = useRef<IdentityGraphActivitySummaries | null>(
      null,
    );
    const diagnosticsRef = useRef<GraphDiagnosticState>({
      sourceScene: null,
      presentationAtlas: null,
      sourceReceipt: null,
      sourceDurationMs: 0,
      sceneSyncMs: 0,
      sceneSyncCount: 0,
      presentationSyncCount: 0,
      activitySyncCount: 0,
      sourceAdmissionCount: 0,
      transformOnlySyncCount: 0,
      lastTransform: null,
      firstVisibleMs: 0,
      lastBuildMs: 0,
      activityPatchKeyCount: 0,
      activityPatchNodeCount: 0,
      unknownActivitySourceCount: 0,
    });
    const activitySummaries = EMPTY_IDENTITY_GRAPH_ACTIVITY_SUMMARIES;
    const [sourceCounts, setSourceCounts] = useState({
      channelCount: 0,
      linkCount: 0,
      personCount: 0,
    });
    const { channelCount, linkCount, personCount } = sourceCounts;
    const [graphReady, setGraphReady] = useState(false);
    const [graphStatus, setGraphStatus] = useState("Building galaxy...");
    const [graphError, setGraphError] = useState<string | null>(null);
    const decorativeStarMode = DECORATIVE_STAR_MODE;
    const [sourceBuildInFlight, setSourceBuildInFlight] = useState(true);
    const [lastBuildMs, setLastBuildMs] = useState<number | null>(null);
    const [sourceRetry, setSourceRetry] = useState(0);
    const [contextMenu, setContextMenu] =
      useState<GraphContextMenuState | null>(null);
    const [linkPickerAccountId, setLinkPickerAccountId] = useState<
      string | null
    >(null);
    const [linkPickerQuery, setLinkPickerQuery] = useState("");
    const { rows: personPickerOptions } = useLibraryPersonPicker({
      enabled: linkPickerAccountId !== null,
      query: sqliteGraphQuery,
      search: linkPickerQuery,
      sourceVersion,
    });
    const [reducedMotion, setReducedMotion] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    const copyDiagnosticsRequestId = useCommandSurfaceStore(
      (state) => state.copyFriendsDiagnosticsRequestId,
    );
    const handledCopyDiagnosticsRequestIdRef = useRef(copyDiagnosticsRequestId);
    const graphDescriptionId = useId();
    const graphAnnouncementId = useId();

    const backgroundStarCount = 0;
    const proceduralBackgroundStarCount = BACKGROUND_STAR_COUNT;

    latestActivityRef.current = activitySummaries;
    sqliteGraphQueryRef.current = sqliteGraphQuery;

    const closeContextMenu = useCallback(() => {
      contextResolutionRef.current += 1;
      const shouldRestoreFocus = contextMenuOpenRef.current;
      contextMenuOpenRef.current = false;
      setContextMenu(null);
      setLinkPickerAccountId(null);
      setLinkPickerQuery("");
      if (shouldRestoreFocus) {
        window.requestAnimationFrame(() =>
          viewportRef.current?.focus({ preventScroll: true }),
        );
      }
    }, []);

    const selectNode = useCallback(
      (nodeId: string | null) => {
        closeContextMenu();
        if (!nodeId) {
          onClearSelection?.();
          return;
        }
        const node = engineRef.current?.metadata(nodeId);
        if (node?.personId) {
          onSelectPersonId(node.personId);
          return;
        }
        if (node?.accountId) {
          onSelectAccountId(node.accountId);
        }
      },
      [closeContextMenu, onClearSelection, onSelectAccountId, onSelectPersonId],
    );

    const selectNodeRef = useRef(selectNode);
    selectNodeRef.current = selectNode;
    const contextResolverRef = useRef<
      (target: FriendsGalaxyContextTarget | null) => void
    >(() => undefined);
    const publishDiagnosticsRef = useRef<() => void>(() => undefined);

    const requestActivityDiff = useCallback(
      (
        previous: IdentityGraphActivitySummaries,
        next: IdentityGraphActivitySummaries,
      ) => {
        const engine = engineRef.current;
        if (
          !engine?.sourceReady ||
          engine.requestedSourceRevision !== engine.activeSourceRevision
        )
          return;
        const patches = diffFriendsGalaxyIdentityActivitySummaries(
          previous,
          next,
        );
        if (patches.length === 0) {
          lastAppliedActivityRef.current = next;
          return;
        }
        activityRevisionRef.current += 1;
        const requestId = engine.requestActivity({
          kind: "activity",
          sourceRevision: engine.activeSourceRevision!,
          activityRevision: activityRevisionRef.current,
          referenceTime: Date.now(),
          patches,
        });
        if (requestId !== null) {
          diagnosticsRef.current.activityPatchKeyCount = patches.length;
          lastAppliedActivityRef.current = next;
          publishDiagnosticsRef.current();
        }
      },
      [],
    );

    const publishDiagnostics = useCallback(() => {
      const viewport = viewportRef.current;
      const engine = engineRef.current;
      const controller = controllerRef.current;
      if (!viewport || !engine || !controller) return;
      const snapshot = controller.snapshot();
      const transform = snapshot.transform;
      if (!transform) return;
      const diagnostic = diagnosticsRef.current;
      const atlas =
        diagnostic.presentationAtlas ?? diagnostic.sourceScene?.atlas ?? null;
      const receipt = diagnostic.sourceReceipt;
      const renderer = snapshot.renderer;
      const previousTransform = diagnostic.lastTransform;
      if (
        previousTransform &&
        (previousTransform.x !== transform.x ||
          previousTransform.y !== transform.y ||
          previousTransform.scale !== transform.scale)
      ) {
        diagnostic.transformOnlySyncCount += 1;
      }
      diagnostic.lastTransform = { ...transform };
      const visibleNodeCount =
        atlas?.nodes.length ?? engine.presentationNodeCount;
      const residentNodeCount =
        receipt?.semanticNodeCount ?? renderer?.semanticStarCount ?? 0;
      const visibleLabelCount =
        renderer?.labelCount ?? atlas?.labels.length ?? 0;
      const visibleProviderLabelCount = atlas
        ? new Set(
            atlas.labels
              .filter((label) => label.kind === "provider_cluster")
              .map((label) => label.nodeId),
          ).size
        : 0;
      const qualityMode = snapshot.cameraInMotion ? "interactive" : "settled";
      const perf: GraphSurfacePerfSnapshot = {
        modelBuildMs: activitySummaries.buildMs,
        layoutMs: diagnostic.sourceDurationMs,
        sceneSyncMs: diagnostic.sceneSyncMs,
        labelPassMs: 0,
        sceneSyncCount: diagnostic.sceneSyncCount,
        presentationSyncCount: diagnostic.presentationSyncCount,
        activitySyncCount: diagnostic.activitySyncCount,
        contentSyncCount: diagnostic.sourceAdmissionCount,
        transformOnlySyncCount: diagnostic.transformOnlySyncCount,
        edgeRebuildCount: renderer?.contextualEdgeCount ?? 0,
        nodeRestyleCount: 0,
        labelLayoutCount:
          renderer?.labelLayoutCount ?? renderer?.labelAtlasBuildCount ?? 0,
        avatarDisplayCount: renderer?.avatarCount ?? 0,
        visibleLabelCount,
        visibleNodeLabelCount: Math.max(
          0,
          visibleLabelCount - visibleProviderLabelCount,
        ),
        visibleProviderLabelCount,
        rendererLabelCount: renderer?.labelCount ?? 0,
        readyRendererLabelCount: renderer?.labelCount ?? 0,
        rendererEdgeCount: renderer?.contextualEdgeCount ?? 0,
        bufferUploadCount: renderer?.bufferUploadCount ?? 0,
        presentationInFlight: engine.presentationInFlight,
        presentationQueued: engine.presentationQueued,
        activityInFlight: engine.activityInFlight,
        activityQueued: engine.activityQueued,
        denseRenderMode: residentNodeCount >= 1_200 ? "dense" : "containers",
        denseInteractionEligible: residentNodeCount >= 1_200,
        denseInteractionNodeCount:
          qualityMode === "interactive" ? visibleNodeCount : 0,
        denseInteractionCulled: residentNodeCount > visibleNodeCount,
        denseInteractionRebuildCount: 0,
        qualityMode,
        sourceNodeCount: residentNodeCount,
        residentNodeCount,
        visibleNodeCount,
        renderedPrimitiveCount:
          residentNodeCount +
          (renderer?.decorativeStarCount ?? 0) +
          visibleLabelCount +
          (renderer?.contextualEdgeCount ?? 0),
        decorativeStarCount: renderer?.decorativeStarCount ?? 0,
        decorativeStarMode,
        firstVisibleMs: diagnostic.firstVisibleMs,
        lastBuildMs: diagnostic.lastBuildMs,
        frameP95Ms: snapshot.frame.p95Ms,
        longTaskCount: snapshot.longTasks.count ?? 0,
        memoryEstimateBytes: renderer?.trackedGpuDataBytes ?? 0,
        rendererType: renderer?.id ?? "initializing",
        touchInputMode: snapshot.touchInputMode,
        lod: lodForScale(transform.scale),
        capped: residentNodeCount > visibleNodeCount,
        nodeCount: residentNodeCount,
        linkCount,
        personCount,
        channelCount,
        transformScale: transform.scale,
      };
      viewport.dataset.graphNodeCount = String(residentNodeCount);
      viewport.dataset.graphLinkCount = String(linkCount);
      viewport.dataset.graphPersonCount = String(personCount);
      viewport.dataset.graphChannelCount = String(channelCount);
      viewport.dataset.graphResidentNodeCount = String(residentNodeCount);
      viewport.dataset.graphVisibleNodeCount = String(visibleNodeCount);
      viewport.dataset.graphDecorativeStarCount = String(
        renderer?.decorativeStarCount ?? 0,
      );
      viewport.dataset.graphDecorativeStarMode = decorativeStarMode;
      viewport.dataset.graphLastBuildMs = String(
        Math.round(diagnostic.lastBuildMs),
      );
      viewport.dataset.graphRenderer = renderer?.id ?? "initializing";
      viewport.dataset.graphQualityMode = qualityMode;
      viewport.dataset.visibleLabelCount = String(visibleLabelCount);
      viewport.dataset.rendererLabelCount = String(renderer?.labelCount ?? 0);
      viewport.dataset.readyRendererLabelCount = String(
        renderer?.labelCount ?? 0,
      );
      viewport.dataset.rendererEdgeCount = String(
        renderer?.contextualEdgeCount ?? 0,
      );
      viewport.dataset.graphDiagnostics = "published";
      const graphWindow = window as typeof window & {
        __FREED_GRAPH_OWNER__?: object;
        __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot;
      };
      graphWindow.__FREED_GRAPH_OWNER__ = diagnosticsOwnerRef.current;
      graphWindow.__FREED_GRAPH_PERF__ = perf;

      if (shouldExposeGraphDebug() && diagnostic.sourceScene && atlas) {
        (
          window as typeof window & {
            __FREED_GRAPH_DEBUG__?: {
              nodes: GraphDebugNode[];
              regions: IdentityGraphAtlas["regions"];
              labels: IdentityGraphAtlas["labels"];
              transform: FriendsGalaxyTransform;
              qualityMode: "interactive" | "settled";
              metrics: GraphSurfacePerfSnapshot;
            };
          }
        ).__FREED_GRAPH_DEBUG__ = {
          nodes: graphDebugNodes(
            diagnostic.sourceScene,
            transform,
            snapshot.viewportGeometry,
          ),
          regions: diagnostic.sourceScene.atlas.regions,
          labels: atlas.labels,
          transform: {
            x: transform.x - snapshot.viewportGeometry.interactionLeft,
            y: transform.y - snapshot.viewportGeometry.interactionTop,
            scale: transform.scale,
          },
          qualityMode,
          metrics: perf,
        };
      }
    }, [
      activitySummaries.buildMs,
      channelCount,
      decorativeStarMode,
      linkCount,
      personCount,
    ]);
    publishDiagnosticsRef.current = publishDiagnostics;

    const sourceReadyRef = useRef<
      (response: FriendsGalaxyProductWorkerSourceResponse) => void
    >(() => undefined);
    sourceReadyRef.current = (response) => {
      const diagnostic = diagnosticsRef.current;
      diagnostic.sourceScene = response.rendererScene;
      diagnostic.presentationAtlas = response.rendererScene.atlas;
      diagnostic.sourceReceipt = response.receipt;
      const nextSourceCounts = {
        channelCount: response.rendererScene.accountCount,
        linkedAccountCount: response.rendererScene.linkedAccountCount,
        personCount: response.rendererScene.personCount,
      };
      setSourceCounts({
        channelCount: nextSourceCounts.channelCount,
        linkCount: nextSourceCounts.linkedAccountCount,
        personCount: nextSourceCounts.personCount,
      });
      onSourceCounts(nextSourceCounts);
      diagnostic.sourceDurationMs = response.durationMs;
      diagnostic.sceneSyncMs = 0;
      diagnostic.sceneSyncCount += 1;
      diagnostic.sourceAdmissionCount += 1;
      const baseline =
        sourceActivityBaselineRef.current.get(response.sourceRevision) ??
        latestActivityRef.current;
      sourceActivityBaselineRef.current.clear();
      if (baseline) lastAppliedActivityRef.current = baseline;
      controllerRef.current?.sourceReady();
      const latest = latestActivityRef.current;
      if (baseline && latest) requestActivityDiff(baseline, latest);
      publishDiagnosticsRef.current();
    };

    const presentationReadyRef = useRef<
      (response: FriendsGalaxyProductWorkerPresentationResponse) => void
    >(() => undefined);
    presentationReadyRef.current = (response) => {
      const diagnostic = diagnosticsRef.current;
      diagnostic.presentationAtlas = response.atlas;
      diagnostic.presentationSyncCount += 1;
      diagnostic.sceneSyncMs = 0;
      controllerRef.current?.wake();
      publishDiagnosticsRef.current();
    };

    const activityReadyRef = useRef<
      (response: FriendsGalaxyProductWorkerActivityResponse) => void
    >(() => undefined);
    activityReadyRef.current = (response) => {
      const diagnostic = diagnosticsRef.current;
      diagnostic.activitySyncCount += 1;
      diagnostic.activityPatchNodeCount =
        response.scenePatches.nodeIndices.length;
      diagnostic.unknownActivitySourceCount =
        response.scenePatches.unknownSources.length;
      publishDiagnosticsRef.current();
    };

    contextResolverRef.current = (target) => {
      if (!target) {
        closeContextMenu();
        return;
      }
      const viewport = viewportRef.current;
      const node = engineRef.current?.metadata(target.nodeId);
      if (!viewport) return;
      const openMenu = (resolvedNode: IdentityGraphAtlasNode) => {
        const x = Math.max(
          8,
          Math.min(target.interactionX, viewport.clientWidth - MENU_WIDTH - 8),
        );
        const y = Math.max(
          8,
          Math.min(
            target.interactionY,
            viewport.clientHeight - MENU_ESTIMATED_HEIGHT - 8,
          ),
        );
        setLinkPickerAccountId(null);
        setLinkPickerQuery("");
        contextMenuOpenRef.current = true;
        setContextMenu({ x, y, node: resolvedNode });
      };
      if (node) {
        contextResolutionRef.current += 1;
        openMenu(node);
        return;
      }
      const resolution = contextResolutionRef.current + 1;
      contextResolutionRef.current = resolution;
      void resolveContextNode(target)
        .then((resolvedNode) => {
          if (contextResolutionRef.current !== resolution || !resolvedNode)
            return;
          openMenu(resolvedNode);
        })
        .catch(() => {
          if (contextResolutionRef.current === resolution) closeContextMenu();
        });
    };

    useEffect(() => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReducedMotion(media.matches);
      update();
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
      if (!contextMenu) return;
      window.requestAnimationFrame(() => {
        const menu = contextMenuRef.current;
        if (!menu || linkPickerAccountId) return;
        menu
          .querySelector<HTMLElement>("button:not([disabled])")
          ?.focus({ preventScroll: true });
      });
    }, [contextMenu, linkPickerAccountId]);

    useEffect(() => {
      const selectedNodeId = selectedPersonId
        ? `person:${selectedPersonId}`
        : selectedAccountId
          ? `account:${selectedAccountId}`
          : null;
      const selectedLabel = selectedNodeId
        ? (engineRef.current?.metadata(selectedNodeId)?.label ?? null)
        : null;
      setAnnouncement(
        friendsGalaxySelectionAnnouncement(selectedLabel, "selection"),
      );
    }, [selectedAccountId, selectedPersonId]);

    useLayoutEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const backgroundLayer = document.querySelector<HTMLElement>(
        '[data-testid="friends-background-layer"]',
      );
      const canvasHost = document.createElement("div");
      canvasHost.dataset.testid = "friend-graph-canvas-host";
      canvasHost.style.position = "absolute";
      canvasHost.style.inset = "0";
      canvasHost.style.overflow = "hidden";
      canvasHost.style.pointerEvents = "none";
      canvasHost.style.opacity = presentationVisible ? "1" : "0";
      canvasHost.style.backgroundColor =
        friendsGalaxyRendererPaletteForTheme(themeId).background;
      canvasHost.style.transition = "opacity 140ms ease";
      (backgroundLayer ?? viewport).appendChild(canvasHost);
      canvasHostRef.current = canvasHost;

      const engine = new FriendsGalaxyProductEngine({
        palette: friendsGalaxyRendererPaletteForTheme(themeId),
        rendererId: "raw-webgpu",
        createSurface: (rendererId) => {
          const canvas = document.createElement("canvas");
          canvas.dataset.rendererId = rendererId;
          canvas.style.position = "absolute";
          canvas.style.inset = "0";
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.pointerEvents = "none";
          canvas.style.opacity = "0";
          canvas.setAttribute("aria-hidden", "true");
          return canvas;
        },
        mountSurface: (surface) => {
          canvasHost.appendChild(surface);
        },
        showSurface: (surface) => {
          for (const candidate of canvasHost.querySelectorAll("canvas")) {
            candidate.style.opacity = candidate === surface ? "1" : "0";
            candidate.removeAttribute("data-testid");
          }
          surface.dataset.testid = "friend-graph-canvas";
          graphReadyRef.current = true;
          setGraphReady(true);
          setSourceBuildInFlight(false);
          setGraphStatus("");
          setGraphError(null);
          const completedAt = nowMs();
          diagnosticsRef.current.lastBuildMs = Math.max(
            0,
            completedAt - sourceBuildStartedAtRef.current,
          );
          setLastBuildMs(diagnosticsRef.current.lastBuildMs);
          if (diagnosticsRef.current.firstVisibleMs === 0) {
            diagnosticsRef.current.firstVisibleMs =
              completedAt - mountedAtRef.current;
          }
          delete (
            window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string }
          ).__FREED_GRAPH_DRAW_ERROR__;
          if (recoveringRef.current) {
            const rendererLabel =
              surface.dataset.rendererId === "raw-webgpu"
                ? "WebGPU"
                : "WebGL2 compatibility graphics";
            setAnnouncement(friendsGalaxyRecoveryAnnouncement(rendererLabel));
            recoveringRef.current = false;
          }
          controllerRef.current?.wake();
          publishDiagnosticsRef.current();
        },
        removeSurface: (surface) => surface.remove(),
        onLoading: ({ recovery }) => {
          if (!graphReadyRef.current) {
            setGraphStatus(
              recovery ? "Recovering graphics..." : "Starting galaxy...",
            );
          }
        },
        onRecovering: ({ reason }) => {
          recoveringRef.current = true;
          setGraphStatus("Recovering graphics...");
          (
            window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string }
          ).__FREED_GRAPH_DRAW_ERROR__ = reason;
        },
        onFailure: ({ reason }) => {
          setSourceBuildInFlight(false);
          if (!engineRef.current?.activeRenderer) {
            setGraphError(reason);
            setGraphStatus("");
            setAnnouncement(friendsGalaxyUnavailableAnnouncement());
          }
        },
        onWorkerFailure: (failure) => {
          setSourceBuildInFlight(false);
          if (
            failure.phase === "source" &&
            failure.message === FRIENDS_GALAXY_SQLITE_SOURCE_FENCE_CHANGED
          ) {
            nextSourceImmediateRef.current = true;
            setSourceRetry((value) => value + 1);
            return;
          }
          if (failure.phase === "source" && !engineRef.current?.sourceReady) {
            setGraphError(failure.message);
            setGraphStatus("");
          }
        },
        onSourceSceneReady: (response) => sourceReadyRef.current(response),
        onPresentationReady: (response) =>
          presentationReadyRef.current(response),
        onActivityReady: (response) => activityReadyRef.current(response),
      });
      engineRef.current = engine;
      sourceSchedulerRef.current = new FriendsGalaxySourceScheduler({
        flush: ({ fallbackBaseline, ...input }) => {
          const baseline = latestActivityRef.current ?? fallbackBaseline;
          sourceActivityBaselineRef.current.set(input.sourceRevision, baseline);
          if (!engine.sourceReady) {
            graphReadyRef.current = false;
            setGraphReady(false);
            setGraphStatus("Building galaxy...");
          }
          sourceBuildStartedAtRef.current = nowMs();
          setSourceBuildInFlight(true);
          setGraphError(null);
          engine.requestNormalizedSource(input, sqliteGraphQueryRef.current);
        },
      });
      engine.setFieldStyle("nebula");
      engine.setInteraction({
        selectedNodeId: selectedPersonId
          ? `person:${selectedPersonId}`
          : selectedAccountId
            ? `account:${selectedAccountId}`
            : null,
        hoveredNodeId: null,
      });
      const controller = new FriendsGalaxyInputController({
        viewport,
        canvasHost,
        engine,
        onSelection: (nodeId) => selectNodeRef.current(nodeId),
        onContext: (target) => contextResolverRef.current(target),
        onDetails: (nodeId) => selectNodeRef.current(nodeId),
        onStateChange: () => publishDiagnosticsRef.current(),
        onPresentationVisibilityChange: (visible) => {
          canvasHost.style.opacity = visible ? "1" : "0";
        },
      });
      controllerRef.current = controller;
      controller.setPresentationVisible(presentationVisible);

      return () => {
        sourceSchedulerRef.current?.dispose();
        sourceSchedulerRef.current = null;
        controller.dispose();
        engine.dispose();
        controllerRef.current = null;
        engineRef.current = null;
        canvasHostRef.current = null;
        canvasHost.remove();
        const graphWindow = window as typeof window & {
          __FREED_GRAPH_OWNER__?: object;
          __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot;
          __FREED_GRAPH_DEBUG__?: unknown;
        };
        const diagnosticsOwner = diagnosticsOwnerRef.current;
        window.setTimeout(() => {
          const activeViewport = document.querySelector(
            '[data-testid="friend-graph-viewport"]',
          );
          if (
            !activeViewport &&
            graphWindow.__FREED_GRAPH_OWNER__ === diagnosticsOwner
          ) {
            delete graphWindow.__FREED_GRAPH_OWNER__;
            delete graphWindow.__FREED_GRAPH_PERF__;
            delete graphWindow.__FREED_GRAPH_DEBUG__;
          }
        }, 0);
      };
    }, []);

    useEffect(() => {
      const controller = controllerRef.current;
      const scheduler = sourceSchedulerRef.current;
      if (!scheduler || !controller) return;
      sourceRevisionRef.current += 1;
      const sourceRevision = sourceRevisionRef.current;
      const baseline = latestActivityRef.current ?? activitySummaries;
      const geometry = controller.geometry;
      const controlSignature = [
        mode,
        backgroundStarCount,
        proceduralBackgroundStarCount,
        sourceVersion,
        sourceRetry,
      ].join(":");
      const controlsChanged =
        sourceControlSignatureRef.current !== null &&
        sourceControlSignatureRef.current !== controlSignature;
      sourceControlSignatureRef.current = controlSignature;
      const immediate = controlsChanged || nextSourceImmediateRef.current;
      nextSourceImmediateRef.current = false;
      scheduler.request(
        {
          fallbackBaseline: baseline,
          backgroundSeed: `freed-friends-${mode}-${sourceRevision.toLocaleString()}`,
          backgroundStarCount,
          mode,
          proceduralBackgroundStarCount,
          sourceRevision,
          viewport: {
            width: geometry.canvasWidth,
            height: geometry.canvasHeight,
            selectedPersonId,
            selectedAccountId,
          },
        },
        immediate,
      );
    }, [
      backgroundStarCount,
      proceduralBackgroundStarCount,
      mode,
      sourceVersion,
      sourceRetry,
    ]);

    useEffect(() => {
      const previous = lastAppliedActivityRef.current;
      if (!previous) {
        lastAppliedActivityRef.current = activitySummaries;
        return;
      }
      requestActivityDiff(previous, activitySummaries);
    }, [activitySummaries, requestActivityDiff]);

    useEffect(() => {
      const nodeId = selectedPersonId
        ? `person:${selectedPersonId}`
        : selectedAccountId
          ? `account:${selectedAccountId}`
          : null;
      controllerRef.current?.setSelection(nodeId, {
        selectedPersonId,
        selectedAccountId,
      });
    }, [selectedAccountId, selectedPersonId]);

    useEffect(() => {
      const palette = friendsGalaxyRendererPaletteForTheme(themeId);
      engineRef.current?.setPalette(palette);
      if (canvasHostRef.current)
        canvasHostRef.current.style.backgroundColor = palette.background;
      controllerRef.current?.wake();
    }, [themeId]);

    useEffect(() => {
      controllerRef.current?.setPresentationVisible(presentationVisible);
    }, [presentationVisible]);

    const fitAll = useCallback(() => controllerRef.current?.fitAll(), []);
    const focusNode = useCallback((nodeId: string) => {
      controllerRef.current?.focusNode(nodeId);
      const label = engineRef.current?.metadata(nodeId)?.label ?? null;
      setAnnouncement(friendsGalaxySelectionAnnouncement(label, "focus"));
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        fitAll,
        focusNode,
        setPresentationVisible: (visible) =>
          controllerRef.current?.setPresentationVisible(visible),
      }),
      [fitAll, focusNode],
    );

    const handleCopyDiagnostics = useCallback(async () => {
      const engine = engineRef.current;
      const controller = controllerRef.current;
      const receipt = diagnosticsRef.current.sourceReceipt;
      const cameraFrame = engine?.cameraFrame;
      const snapshot = controller?.snapshot();
      const transform = snapshot?.transform;
      if (
        !engine ||
        !controller ||
        !receipt ||
        !cameraFrame ||
        !snapshot ||
        !transform
      )
        return;
      const exported = createFriendsGalaxyDiagnosticSnapshot({
        capturedAt: new Date().toISOString(),
        receipt: {
          ...receipt,
          activitySummaryCount:
            Object.keys(activitySummaries.social).length +
            Object.keys(activitySummaries.rss).length,
          representedActivityItemCount: activitySummaries.itemCount,
        },
        personCount,
        accountCount: channelCount,
        backgroundStarCount:
          backgroundStarCount + proceduralBackgroundStarCount,
        backend: snapshot.renderer,
        theme: themeId ?? "scriptorium",
        fieldStyle: "nebula",
        transform,
        cameraScaleLimits: cameraFrame.scaleLimits,
        outwardZoomEnvelope: cameraFrame.outwardZoomEnvelope,
        viewportWidth: snapshot.viewportGeometry.canvasWidth,
        viewportHeight: snapshot.viewportGeometry.canvasHeight,
        cameraInMotion: snapshot.cameraInMotion,
        selectionActive: snapshot.selectedNodeId !== null,
        hoverActive: snapshot.hoveredNodeId !== null,
        touchInputMode: snapshot.touchInputMode,
        wheelInputMode: snapshot.wheelInputMode,
        inertialPanActive: snapshot.inertialPanActive,
        inertialZoomActive: snapshot.inertialZoomActive,
        inertialZoomPending: snapshot.inertialZoomPending,
        presentationVisible: snapshot.presentationVisible,
        frameLoop: snapshot.frameLoop,
        settlePending: snapshot.settlePending,
        renderResizePending: snapshot.renderResizePending,
        backendGeneration: engine.rendererGeneration,
        backendRecoveryPending: engine.recoveryPending,
        backendTerminalFailure: engine.terminalRendererFailure,
        recoveryReason: engine.recoveryReason,
        longTasks: snapshot.longTasks,
        frame: snapshot.frame,
        submit: snapshot.submit,
        activityPatchKeyCount: diagnosticsRef.current.activityPatchKeyCount,
        activityPatchNodeCount: diagnosticsRef.current.activityPatchNodeCount,
        unknownActivitySourceCount:
          diagnosticsRef.current.unknownActivitySourceCount,
        avatarRequestedCount: 0,
        avatarReadyCount: snapshot.renderer?.avatarCount ?? 0,
        avatarFailureCount: 0,
      });
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(
          serializeFriendsGalaxyDiagnosticSnapshot(exported),
        );
        setGraphStatus("Diagnostics copied");
        window.setTimeout(() => setGraphStatus(""), 1_200);
      } catch {
        setGraphStatus("Clipboard unavailable");
      }
    }, [
      activitySummaries,
      backgroundStarCount,
      channelCount,
      personCount,
      proceduralBackgroundStarCount,
      themeId,
    ]);

    useEffect(() => {
      if (
        copyDiagnosticsRequestId === handledCopyDiagnosticsRequestIdRef.current
      )
        return;
      handledCopyDiagnosticsRequestIdRef.current = copyDiagnosticsRequestId;
      void handleCopyDiagnostics();
    }, [copyDiagnosticsRequestId, handleCopyDiagnostics]);

    const handleOpenContextDetails = useCallback(() => {
      if (!contextMenu) return;
      selectNode(contextMenu.node.id);
    }, [contextMenu, selectNode]);

    const handlePinContextNode = useCallback(async () => {
      const node = contextMenu?.node;
      if (!node) return;
      nextSourceImmediateRef.current = true;
      if (node.personId) {
        await onPinPersonPosition?.(node.personId, node.x, node.y);
      } else if (node.accountId) {
        await onPinAccountPosition?.(node.accountId, node.x, node.y);
      }
      closeContextMenu();
    }, [
      closeContextMenu,
      contextMenu,
      onPinAccountPosition,
      onPinPersonPosition,
    ]);

    const handlePromoteContextNode = useCallback(
      async (level: 1 | 3 | 5) => {
        const node = contextMenu?.node;
        if (!node || !onDropNodeToRelationshipTier) return;
        nextSourceImmediateRef.current = true;
        await onDropNodeToRelationshipTier({
          personId: node.personId,
          accountId: node.accountId,
          level,
        });
        closeContextMenu();
      },
      [closeContextMenu, contextMenu, onDropNodeToRelationshipTier],
    );

    const handleLinkAccountToPickerPerson = useCallback(
      async (personId: string) => {
        if (!linkPickerAccountId || !onLinkAccountToPerson) return;
        nextSourceImmediateRef.current = true;
        await onLinkAccountToPerson(linkPickerAccountId, personId);
        closeContextMenu();
      },
      [closeContextMenu, linkPickerAccountId, onLinkAccountToPerson],
    );

    const contextMenuStyle = contextMenu
      ? ({
          left: contextMenu.x,
          top: contextMenu.y,
          "--theme-menu-top": `${contextMenu.y}px`,
        } as CSSProperties)
      : undefined;

    return (
      <div
        ref={viewportRef}
        data-testid="friend-graph-viewport"
        className="relative z-[1] h-full w-full touch-none overscroll-contain bg-transparent outline-none"
        tabIndex={0}
        role="region"
        aria-label="Friends galaxy"
        aria-describedby={graphDescriptionId}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home 0 Escape Enter Shift+F10 ContextMenu"
      >
        <p id={graphDescriptionId} className="sr-only">
          {friendsGalaxyGraphDescription(
            selectedPersonId
              ? (engineRef.current?.metadata(`person:${selectedPersonId}`)
                  ?.label ?? null)
              : selectedAccountId
                ? (engineRef.current?.metadata(`account:${selectedAccountId}`)
                    ?.label ?? null)
                : null,
            reducedMotion,
          )}
        </p>
        <p
          id={graphAnnouncementId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcement}
        </p>
        <div
          data-testid="friend-graph-canvas-overlay"
          className="absolute inset-0 cursor-grab bg-transparent active:cursor-grabbing"
          aria-hidden="true"
        />

        {!graphReady || graphError || graphStatus ? (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
            <div className="max-w-[min(28rem,calc(100%-2rem))] rounded-lg border border-[color:rgb(var(--theme-border-rgb)/0.28)] bg-[color:rgb(var(--theme-surface-rgb)/0.9)] px-4 py-2 text-center text-xs text-[color:var(--theme-text-secondary)] shadow-lg backdrop-blur-md">
              {graphError ? (
                <div className="pointer-events-auto flex items-center gap-3">
                  <span>{graphError}</span>
                  <button
                    type="button"
                    className="btn-secondary rounded-lg px-3 py-1 text-xs"
                    onClick={() => setSourceRetry((value) => value + 1)}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                graphStatus || "Building galaxy..."
              )}
            </div>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            ref={contextMenuRef}
            className="theme-menu-shell absolute z-30 w-64 max-w-[calc(100%-1rem)] rounded-lg border border-[color:rgb(var(--theme-border-rgb)/0.28)] bg-[color:rgb(var(--theme-surface-rgb)/0.96)] p-2 text-sm text-[color:var(--theme-text-primary)] shadow-2xl backdrop-blur-xl"
            style={contextMenuStyle}
            role="dialog"
            aria-label="Galaxy actions"
            data-testid="friend-graph-context-menu"
            data-graph-gesture-ignore="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeContextMenu();
            }}
          >
            <div className="px-2 pb-2">
              <p className="truncate text-sm font-semibold">
                {contextMenu.node.label}
              </p>
              <p className="text-xs text-[color:var(--theme-text-muted)]">
                {nodeKindLabel(contextMenu.node)}
              </p>
            </div>
            {linkPickerAccountId ? (
              <div className="space-y-2">
                <input
                  className="theme-input w-full rounded-lg px-3 py-2 text-sm outline-none"
                  value={linkPickerQuery}
                  onChange={(event) => setLinkPickerQuery(event.target.value)}
                  placeholder="Search people"
                  autoFocus
                />
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {personPickerOptions.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[color:var(--theme-bg-card-hover)]"
                      onClick={() =>
                        void handleLinkAccountToPickerPerson(person.id)
                      }
                    >
                      <span className="block truncate font-medium">
                        {person.name}
                      </span>
                      <span className="block text-xs text-[color:var(--theme-text-muted)]">
                        {person.relationshipStatus === "friend"
                          ? "Friend"
                          : "Connection"}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`${CONTROL_BASE} w-full`}
                  onClick={() => setLinkPickerAccountId(null)}
                >
                  Back
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {contextMenu.node.personId || contextMenu.node.accountId ? (
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                    onClick={handleOpenContextDetails}
                  >
                    Open details
                  </button>
                ) : null}
                {(contextMenu.node.personId || contextMenu.node.accountId) &&
                (onPinPersonPosition || onPinAccountPosition) ? (
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                    onClick={() => void handlePinContextNode()}
                  >
                    Pin here
                  </button>
                ) : null}
                {contextMenu.node.accountId && onLinkAccountToPerson ? (
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                    onClick={() => {
                      setLinkPickerAccountId(
                        contextMenu.node.accountId ?? null,
                      );
                      setLinkPickerQuery("");
                    }}
                  >
                    Link to person
                  </button>
                ) : null}
                {onDropNodeToRelationshipTier &&
                (contextMenu.node.personId || contextMenu.node.accountId) ? (
                  <>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                      onClick={() => void handlePromoteContextNode(1)}
                    >
                      Mark followed
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                      onClick={() => void handlePromoteContextNode(3)}
                    >
                      Promote to Friend
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-[color:var(--theme-bg-card-hover)]"
                      onClick={() => void handlePromoteContextNode(5)}
                    >
                      Promote to Fam
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left text-[color:var(--theme-text-muted)] hover:bg-[color:var(--theme-bg-card-hover)]"
                  onClick={closeContextMenu}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        ) : null}

        <div
          data-testid="friend-graph-controls"
          data-graph-gesture-ignore="true"
          className={`absolute z-20 flex items-center gap-2 ${
            controlsAdjacentToSidebar
              ? "top-[var(--feed-card-gap,8px)]"
              : "right-3 top-3 sm:right-4 sm:top-4"
          }`}
          style={
            controlsAdjacentToSidebar
              ? // The control crosses 4px into the 12px resize gutter so the
                // remaining 8px matches the detail panel's outer window inset.
                { right: "calc(var(--feed-card-gap, 8px) - 0.75rem)" }
              : undefined
          }
        >
          <button
            type="button"
            className={CANVAS_CONTROL_BUTTON_CLASS}
            onClick={fitAll}
          >
            Fit all
          </button>
          <span
            className="theme-canvas-control rounded-lg px-2.5 py-1.5 text-xs tabular-nums text-[color:var(--theme-text-muted)]"
            data-testid="friend-graph-build-time"
            title="Worker and renderer time for the last Galaxy build"
          >
            {lastBuildMs === null
              ? "Build..."
              : `${Math.round(lastBuildMs).toLocaleString()} ms${
                  sourceBuildInFlight ? ", updating" : ""
                }`}
          </span>
        </div>
      </div>
    );
  },
);
