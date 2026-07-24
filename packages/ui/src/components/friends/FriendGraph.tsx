import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  friendsGalaxyGraphDescription,
  friendsGalaxyRecoveryAnnouncement,
  friendsGalaxySelectionAnnouncement,
  friendsGalaxyUnavailableAnnouncement,
} from "../../lib/friends-galaxy-accessibility.js";
import {
  diffFriendsGalaxyIdentityActivitySummaries,
} from "../../lib/friends-galaxy-activity-index.js";
import {
  writeFriendsGalaxyWebGpuViewProjection,
} from "../../lib/friends-galaxy-camera.js";
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
import type {
  FriendsGalaxyRendererScene,
} from "../../lib/friends-galaxy-renderer.js";
import { friendsGalaxyRendererPaletteForTheme } from "../../lib/friends-galaxy-theme-palettes.js";
import type {
  FriendsGalaxyTransform,
  FriendsGalaxyViewportGeometry,
} from "../../lib/friends-galaxy-viewport.js";
import {
  buildIdentityGraphActivitySummaries,
  type IdentityGraphActivitySummaries,
} from "../../lib/identity-graph-activity-summary.js";
import type {
  BuildIdentityGraphAtlasModelInput,
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
} from "../../lib/identity-graph-atlas.js";
import { IdentityGalaxyNodeKindCode } from "../../lib/identity-galaxy-scene.js";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusNode: (id: string) => void;
  setPresentationVisible: (visible: boolean) => void;
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
  presentationVisible?: boolean;
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
  sourceAdmissionCount: number;
  transformOnlySyncCount: number;
  lastTransform: FriendsGalaxyTransform | null;
  firstVisibleMs: number;
  activityPatchKeyCount: number;
  activityPatchNodeCount: number;
  unknownActivitySourceCount: number;
}

const BACKGROUND_STAR_COUNT = 100_000;
const CONTROL_BASE = "btn-secondary rounded-lg px-3 py-1.5 text-xs shadow-sm";
const MENU_WIDTH = 264;
const MENU_ESTIMATED_HEIGHT = 376;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function shouldExposeGraphDebug(): boolean {
  return typeof window !== "undefined" &&
    (window as typeof window & { __FREED_GRAPH_DEBUG_ENABLED__?: boolean })
      .__FREED_GRAPH_DEBUG_ENABLED__ === true;
}

function buildSuggestionRecord(
  map: Map<string, FriendCandidateConfidence> | undefined,
): Record<string, FriendCandidateConfidence> {
  return map ? Object.fromEntries(map.entries()) : {};
}

function accountLabel(account: Account): string {
  return account.displayName || account.handle || account.externalId || "Unnamed account";
}

function initialsForLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]!).slice(0, 2).join("").toUpperCase();
  return `${Array.from(parts[0]!)[0] ?? ""}${Array.from(parts[1]!)[0] ?? ""}`.toUpperCase();
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

function normalizedNodeId(
  id: string,
  persons: ReadonlyMap<string, Person>,
  accounts: Record<string, Account>,
  feeds: Record<string, RssFeed>,
): string {
  if (id.startsWith("person:") || id.startsWith("account:") || id.startsWith("feed:")) {
    return id;
  }
  if (persons.has(id)) return `person:${id}`;
  if (accounts[id]) return `account:${id}`;
  if (feeds[id]) return `feed:${id}`;
  return id;
}

function synthesizeContextNode(
  target: FriendsGalaxyContextTarget,
  persons: ReadonlyMap<string, Person>,
  accounts: Record<string, Account>,
  feeds: Record<string, RssFeed>,
): IdentityGraphAtlasNode | null {
  if (target.nodeId.startsWith("person:")) {
    const personId = target.nodeId.slice("person:".length);
    const person = persons.get(personId);
    if (!person) return null;
    return {
      id: target.nodeId,
      kind: person.relationshipStatus === "friend" ? "friend_person" : "connection_person",
      label: person.name || "Unnamed friend",
      x: target.worldX,
      y: target.worldY,
      radius: 32,
      priority: 1,
      personId,
      initials: initialsForLabel(person.name),
      activityCount: 0,
      careLevel: person.careLevel,
      graphPinned: person.graphPinned,
    };
  }
  if (target.nodeId.startsWith("account:")) {
    const accountId = target.nodeId.slice("account:".length);
    const account = accounts[accountId];
    if (!account) return null;
    const label = accountLabel(account);
    return {
      id: target.nodeId,
      kind: "account",
      label,
      x: target.worldX,
      y: target.worldY,
      radius: 14,
      priority: 1,
      accountId,
      provider: account.provider,
      linkedPersonId: account.personId ?? null,
      initials: initialsForLabel(label),
      activityCount: 0,
      graphPinned: account.graphPinned,
    };
  }
  if (target.nodeId.startsWith("feed:")) {
    const feedUrl = target.nodeId.slice("feed:".length);
    const feed = feeds[feedUrl];
    const label = feed?.title || feedUrl;
    return {
      id: target.nodeId,
      kind: "feed",
      label,
      x: target.worldX,
      y: target.worldY,
      radius: 10,
      priority: 1,
      feedUrl,
      provider: "rss",
      initials: initialsForLabel(label),
      activityCount: 0,
    };
  }
  return null;
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
  const metadataByNodeId = new Map(scene.atlas.nodes.map((node) => [node.id, node]));
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
    const kind = kindCode === IdentityGalaxyNodeKindCode.FriendPerson
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
      feedUrl: metadata?.feedUrl ?? (id.startsWith("feed:") ? id.slice("feed:".length) : undefined),
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
    presentationVisible = true,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FriendsGalaxyProductEngine | null>(null);
  const controllerRef = useRef<FriendsGalaxyInputController | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const mountedAtRef = useRef(nowMs());
  const diagnosticsOwnerRef = useRef({});
  const recoveringRef = useRef(false);
  const contextMenuOpenRef = useRef(false);
  const sourceRevisionRef = useRef(0);
  const activityRevisionRef = useRef(0);
  const sourceActivityBaselineRef = useRef(new Map<number, IdentityGraphActivitySummaries>());
  const lastAppliedActivityRef = useRef<IdentityGraphActivitySummaries | null>(null);
  const latestActivityRef = useRef<IdentityGraphActivitySummaries | null>(null);
  const diagnosticsRef = useRef<GraphDiagnosticState>({
    sourceScene: null,
    presentationAtlas: null,
    sourceReceipt: null,
    sourceDurationMs: 0,
    sceneSyncMs: 0,
    sceneSyncCount: 0,
    presentationSyncCount: 0,
    sourceAdmissionCount: 0,
    transformOnlySyncCount: 0,
    lastTransform: null,
    firstVisibleMs: 0,
    activityPatchKeyCount: 0,
    activityPatchNodeCount: 0,
    unknownActivitySourceCount: 0,
  });
  const personsById = useMemo(
    () => new Map(persons.map((person) => [person.id, person])),
    [persons],
  );
  const activitySummaries = useMemo(
    () => activitySummariesProp ?? buildIdentityGraphActivitySummaries(feedItems ?? {}),
    [activitySummariesProp, feedItems],
  );
  const personSuggestionRecord = useMemo(
    () => buildSuggestionRecord(friendSuggestionStrengthByPerson),
    [friendSuggestionStrengthByPerson],
  );
  const accountSuggestionRecord = useMemo(
    () => buildSuggestionRecord(friendSuggestionStrengthByAccount),
    [friendSuggestionStrengthByAccount],
  );
  const personCount = persons.length;
  const channelCount = useMemo(
    () => Object.values(accounts).filter((account) => account.kind === "social").length +
      Object.values(feeds).filter((feed) => feed.enabled !== false).length,
    [accounts, feeds],
  );
  const linkCount = useMemo(() => {
    const visiblePersonIds = new Set(
      persons
        .filter((person) => mode === "all_content" || person.relationshipStatus === "friend")
        .map((person) => person.id),
    );
    return Object.values(accounts).filter((account) =>
      account.kind === "social" && Boolean(account.personId && visiblePersonIds.has(account.personId)),
    ).length;
  }, [accounts, mode, persons]);
  const [graphReady, setGraphReady] = useState(false);
  const [graphStatus, setGraphStatus] = useState("Building galaxy...");
  const [graphError, setGraphError] = useState<string | null>(null);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
  const [linkPickerAccountId, setLinkPickerAccountId] = useState<string | null>(null);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const graphDescriptionId = useId();
  const graphAnnouncementId = useId();

  latestActivityRef.current = activitySummaries;

  const personPickerOptions = useMemo(() => {
    const query = linkPickerQuery.trim().toLocaleLowerCase();
    return persons
      .filter((person) => {
        if (!query) return true;
        return person.name.toLocaleLowerCase().includes(query) ||
          person.notes?.toLocaleLowerCase().includes(query);
      })
      .sort((left, right) => {
        const friendOrder = Number(right.relationshipStatus === "friend") -
          Number(left.relationshipStatus === "friend");
        return friendOrder || left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }, [linkPickerQuery, persons]);

  const closeContextMenu = useCallback(() => {
    const shouldRestoreFocus = contextMenuOpenRef.current;
    contextMenuOpenRef.current = false;
    setContextMenu(null);
    setLinkPickerAccountId(null);
    setLinkPickerQuery("");
    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => viewportRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const selectNode = useCallback((nodeId: string | null) => {
    closeContextMenu();
    if (!nodeId) {
      onClearSelection?.();
      return;
    }
    if (nodeId.startsWith("person:")) {
      const person = personsById.get(nodeId.slice("person:".length));
      if (person) onSelectPerson(person);
      return;
    }
    if (nodeId.startsWith("account:")) {
      const account = accounts[nodeId.slice("account:".length)];
      if (account) onSelectAccount(account);
    }
  }, [accounts, closeContextMenu, onClearSelection, onSelectAccount, onSelectPerson, personsById]);

  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;
  const contextResolverRef = useRef<(target: FriendsGalaxyContextTarget | null) => void>(() => undefined);

  const requestActivityDiff = useCallback((
    previous: IdentityGraphActivitySummaries,
    next: IdentityGraphActivitySummaries,
  ) => {
    const engine = engineRef.current;
    if (
      !engine?.sourceReady ||
      engine.requestedSourceRevision !== engine.activeSourceRevision
    ) return;
    const patches = diffFriendsGalaxyIdentityActivitySummaries(previous, next);
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
    }
  }, []);

  const publishDiagnosticsRef = useRef<() => void>(() => undefined);
  const publishDiagnostics = useCallback(() => {
    const viewport = viewportRef.current;
    const engine = engineRef.current;
    const controller = controllerRef.current;
    if (!viewport || !engine || !controller) return;
    const snapshot = controller.snapshot();
    const transform = snapshot.transform;
    if (!transform) return;
    const diagnostic = diagnosticsRef.current;
    const atlas = diagnostic.presentationAtlas ?? diagnostic.sourceScene?.atlas ?? null;
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
    const visibleNodeCount = atlas?.nodes.length ?? engine.presentationNodeCount;
    const residentNodeCount = receipt?.semanticNodeCount ?? renderer?.semanticStarCount ?? 0;
    const visibleLabelCount = renderer?.labelCount ?? atlas?.labels.length ?? 0;
    const visibleProviderLabelCount = atlas
      ? new Set(atlas.labels
        .filter((label) => label.kind === "provider_cluster")
        .map((label) => label.nodeId)).size
      : 0;
    const qualityMode = snapshot.cameraInMotion ? "interactive" : "settled";
    const perf: GraphSurfacePerfSnapshot = {
      modelBuildMs: activitySummaries.buildMs,
      layoutMs: diagnostic.sourceDurationMs,
      sceneSyncMs: diagnostic.sceneSyncMs,
      labelPassMs: 0,
      sceneSyncCount: diagnostic.sceneSyncCount,
      presentationSyncCount: diagnostic.presentationSyncCount,
      contentSyncCount: diagnostic.sourceAdmissionCount,
      transformOnlySyncCount: diagnostic.transformOnlySyncCount,
      edgeRebuildCount: renderer?.contextualEdgeCount ?? 0,
      nodeRestyleCount: 0,
      labelLayoutCount: renderer?.labelLayoutCount ?? renderer?.labelAtlasBuildCount ?? 0,
      avatarDisplayCount: renderer?.avatarCount ?? 0,
      visibleLabelCount,
      visibleNodeLabelCount: Math.max(0, visibleLabelCount - visibleProviderLabelCount),
      visibleProviderLabelCount,
      rendererLabelCount: renderer?.labelCount ?? 0,
      readyRendererLabelCount: renderer?.labelCount ?? 0,
      rendererEdgeCount: renderer?.contextualEdgeCount ?? 0,
      denseRenderMode: residentNodeCount >= 1_200 ? "dense" : "containers",
      denseInteractionEligible: residentNodeCount >= 1_200,
      denseInteractionNodeCount: qualityMode === "interactive" ? visibleNodeCount : 0,
      denseInteractionCulled: residentNodeCount > visibleNodeCount,
      denseInteractionRebuildCount: 0,
      qualityMode,
      sourceNodeCount: residentNodeCount,
      residentNodeCount,
      visibleNodeCount,
      renderedPrimitiveCount: residentNodeCount +
        (renderer?.decorativeStarCount ?? 0) +
        visibleLabelCount +
        (renderer?.contextualEdgeCount ?? 0),
      firstVisibleMs: diagnostic.firstVisibleMs,
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
    viewport.dataset.graphRenderer = renderer?.id ?? "initializing";
    viewport.dataset.graphQualityMode = qualityMode;
    viewport.dataset.visibleLabelCount = String(visibleLabelCount);
    viewport.dataset.rendererLabelCount = String(renderer?.labelCount ?? 0);
    viewport.dataset.readyRendererLabelCount = String(renderer?.labelCount ?? 0);
    viewport.dataset.rendererEdgeCount = String(renderer?.contextualEdgeCount ?? 0);
    viewport.dataset.graphDiagnostics = "published";
    const graphWindow = window as typeof window & {
      __FREED_GRAPH_OWNER__?: object;
      __FREED_GRAPH_PERF__?: GraphSurfacePerfSnapshot;
    };
    graphWindow.__FREED_GRAPH_OWNER__ = diagnosticsOwnerRef.current;
    graphWindow.__FREED_GRAPH_PERF__ = perf;

    if (shouldExposeGraphDebug() && diagnostic.sourceScene && atlas) {
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: {
          nodes: GraphDebugNode[];
          regions: IdentityGraphAtlas["regions"];
          labels: IdentityGraphAtlas["labels"];
          transform: FriendsGalaxyTransform;
          qualityMode: "interactive" | "settled";
          metrics: GraphSurfacePerfSnapshot;
        };
      }).__FREED_GRAPH_DEBUG__ = {
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
  }, [activitySummaries.buildMs, channelCount, linkCount, personCount]);
  publishDiagnosticsRef.current = publishDiagnostics;

  const sourceReadyRef = useRef<(response: FriendsGalaxyProductWorkerSourceResponse) => void>(
    () => undefined,
  );
  sourceReadyRef.current = (response) => {
    const diagnostic = diagnosticsRef.current;
    diagnostic.sourceScene = response.rendererScene;
    diagnostic.presentationAtlas = response.rendererScene.atlas;
    diagnostic.sourceReceipt = response.receipt;
    diagnostic.sourceDurationMs = response.durationMs;
    diagnostic.sceneSyncMs = 0;
    diagnostic.sceneSyncCount += 1;
    diagnostic.sourceAdmissionCount += 1;
    const baseline = sourceActivityBaselineRef.current.get(response.sourceRevision) ??
      latestActivityRef.current;
    sourceActivityBaselineRef.current.clear();
    if (baseline) lastAppliedActivityRef.current = baseline;
    controllerRef.current?.sourceReady();
    const latest = latestActivityRef.current;
    if (baseline && latest) requestActivityDiff(baseline, latest);
    publishDiagnosticsRef.current();
  };

  const presentationReadyRef = useRef<(
    response: FriendsGalaxyProductWorkerPresentationResponse,
  ) => void>(() => undefined);
  presentationReadyRef.current = (response) => {
    const diagnostic = diagnosticsRef.current;
    diagnostic.presentationAtlas = response.atlas;
    diagnostic.presentationSyncCount += 1;
    diagnostic.sceneSyncMs = 0;
    controllerRef.current?.wake();
    publishDiagnosticsRef.current();
  };

  const activityReadyRef = useRef<(
    response: FriendsGalaxyProductWorkerActivityResponse,
  ) => void>(() => undefined);
  activityReadyRef.current = (response) => {
    const diagnostic = diagnosticsRef.current;
    diagnostic.activityPatchNodeCount = response.scenePatches.nodeIndices.length;
    diagnostic.unknownActivitySourceCount = response.scenePatches.unknownSources.length;
    publishDiagnosticsRef.current();
  };

  contextResolverRef.current = (target) => {
    if (!target) {
      closeContextMenu();
      return;
    }
    const viewport = viewportRef.current;
    const node = engineRef.current?.metadata(target.nodeId) ??
      synthesizeContextNode(target, personsById, accounts, feeds);
    if (!viewport || !node) return;
    const x = Math.max(8, Math.min(target.interactionX, viewport.clientWidth - MENU_WIDTH - 8));
    const y = Math.max(
      8,
      Math.min(target.interactionY, viewport.clientHeight - MENU_ESTIMATED_HEIGHT - 8),
    );
    setLinkPickerAccountId(null);
    setLinkPickerQuery("");
    contextMenuOpenRef.current = true;
    setContextMenu({ x, y, node });
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
      menu.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    });
  }, [contextMenu, linkPickerAccountId]);

  useEffect(() => {
    const selectedLabel = selectedPersonId
      ? personsById.get(selectedPersonId)?.name ?? null
      : selectedAccountId
        ? accounts[selectedAccountId]?.displayName ?? null
        : null;
    setAnnouncement(friendsGalaxySelectionAnnouncement(selectedLabel, "selection"));
  }, [accounts, personsById, selectedAccountId, selectedPersonId]);

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
    canvasHost.style.backgroundColor = friendsGalaxyRendererPaletteForTheme(themeId).background;
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
        setGraphReady(true);
        setGraphStatus("");
        setGraphError(null);
        if (diagnosticsRef.current.firstVisibleMs === 0) {
          diagnosticsRef.current.firstVisibleMs = nowMs() - mountedAtRef.current;
        }
        delete (window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string })
          .__FREED_GRAPH_DRAW_ERROR__;
        if (recoveringRef.current) {
          const rendererLabel = surface.dataset.rendererId === "raw-webgpu"
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
        if (!graphReady) setGraphStatus(recovery ? "Recovering graphics..." : "Starting galaxy...");
      },
      onRecovering: ({ reason }) => {
        recoveringRef.current = true;
        setGraphStatus("Recovering graphics...");
        (window as typeof window & { __FREED_GRAPH_DRAW_ERROR__?: string })
          .__FREED_GRAPH_DRAW_ERROR__ = reason;
      },
      onFailure: ({ reason }) => {
        if (!engineRef.current?.activeRenderer) {
          setGraphError(reason);
          setGraphStatus("");
          setAnnouncement(friendsGalaxyUnavailableAnnouncement());
        }
      },
      onWorkerFailure: (failure) => {
        if (failure.phase === "source" && !engineRef.current?.sourceReady) {
          setGraphError(failure.message);
          setGraphStatus("");
        }
      },
      onSourceSceneReady: (response) => sourceReadyRef.current(response),
      onPresentationReady: (response) => presentationReadyRef.current(response),
      onActivityReady: (response) => activityReadyRef.current(response),
    });
    engineRef.current = engine;
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
        const activeViewport = document.querySelector('[data-testid="friend-graph-viewport"]');
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
    const engine = engineRef.current;
    const controller = controllerRef.current;
    if (!engine || !controller) return;
    sourceRevisionRef.current += 1;
    const sourceRevision = sourceRevisionRef.current;
    const baseline = latestActivityRef.current ?? activitySummaries;
    sourceActivityBaselineRef.current.set(sourceRevision, baseline);
    if (!engine.sourceReady) {
      setGraphReady(false);
      setGraphStatus("Building galaxy...");
    }
    setGraphError(null);
    const geometry = controller.geometry;
    const source: BuildIdentityGraphAtlasModelInput = {
      persons,
      accounts,
      feeds,
      activitySummaries: baseline,
      mode,
      width: 1_400,
      height: 900,
      friendSuggestionStrengthByPerson: personSuggestionRecord,
      friendSuggestionStrengthByAccount: accountSuggestionRecord,
    };
    engine.requestSource({
      kind: "source",
      sourceRevision,
      source,
      viewport: {
        width: geometry.canvasWidth,
        height: geometry.canvasHeight,
        selectedPersonId,
        selectedAccountId,
      },
      backgroundStarCount: BACKGROUND_STAR_COUNT,
      backgroundSeed: `freed-friends-${mode}-${persons.length.toLocaleString()}-${channelCount.toLocaleString()}`,
    });
  }, [
    accountSuggestionRecord,
    accounts,
    channelCount,
    feeds,
    mode,
    personSuggestionRecord,
    persons,
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
    controllerRef.current?.setSelection(
      nodeId,
      { selectedPersonId, selectedAccountId },
    );
  }, [selectedAccountId, selectedPersonId]);

  useEffect(() => {
    const palette = friendsGalaxyRendererPaletteForTheme(themeId);
    engineRef.current?.setPalette(palette);
    if (canvasHostRef.current) canvasHostRef.current.style.backgroundColor = palette.background;
    controllerRef.current?.wake();
  }, [themeId]);

  useEffect(() => {
    controllerRef.current?.setPresentationVisible(presentationVisible);
  }, [presentationVisible]);

  const fitAll = useCallback(() => controllerRef.current?.fitAll(), []);
  const focusNode = useCallback((id: string) => {
    const nodeId = normalizedNodeId(id, personsById, accounts, feeds);
    controllerRef.current?.focusNode(nodeId);
    const label = nodeId.startsWith("person:")
      ? personsById.get(nodeId.slice("person:".length))?.name ?? null
      : nodeId.startsWith("account:")
        ? accounts[nodeId.slice("account:".length)]?.displayName ?? null
        : null;
    setAnnouncement(friendsGalaxySelectionAnnouncement(label, "focus"));
  }, [accounts, feeds, personsById]);
  useImperativeHandle(ref, () => ({
    fitAll,
    focusNode,
    setPresentationVisible: (visible) => controllerRef.current?.setPresentationVisible(visible),
  }), [fitAll, focusNode]);

  const handleCopyDiagnostics = useCallback(async () => {
    const engine = engineRef.current;
    const controller = controllerRef.current;
    const receipt = diagnosticsRef.current.sourceReceipt;
    const cameraFrame = engine?.cameraFrame;
    const snapshot = controller?.snapshot();
    const transform = snapshot?.transform;
    if (!engine || !controller || !receipt || !cameraFrame || !snapshot || !transform) return;
    const exported = createFriendsGalaxyDiagnosticSnapshot({
      capturedAt: new Date().toISOString(),
      receipt: {
        ...receipt,
        activitySummaryCount: Object.keys(activitySummaries.social).length +
          Object.keys(activitySummaries.rss).length,
        representedActivityItemCount: activitySummaries.itemCount,
      },
      personCount,
      accountCount: channelCount,
      backgroundStarCount: BACKGROUND_STAR_COUNT,
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
      unknownActivitySourceCount: diagnosticsRef.current.unknownActivitySourceCount,
      avatarRequestedCount: 0,
      avatarReadyCount: snapshot.renderer?.avatarCount ?? 0,
      avatarFailureCount: 0,
    });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(serializeFriendsGalaxyDiagnosticSnapshot(exported));
      setGraphStatus("Diagnostics copied");
      window.setTimeout(() => setGraphStatus(""), 1_200);
    } catch {
      setGraphStatus("Clipboard unavailable");
    }
  }, [activitySummaries, channelCount, personCount, themeId]);

  const handleOpenContextDetails = useCallback(() => {
    if (!contextMenu) return;
    selectNode(contextMenu.node.id);
  }, [contextMenu, selectNode]);

  const handlePinContextNode = useCallback(async () => {
    const node = contextMenu?.node;
    if (!node) return;
    if (node.personId) {
      await onPinPersonPosition?.(node.personId, node.x, node.y);
    } else if (node.accountId) {
      await onPinAccountPosition?.(node.accountId, node.x, node.y);
    }
    closeContextMenu();
  }, [closeContextMenu, contextMenu, onPinAccountPosition, onPinPersonPosition]);

  const handlePromoteContextNode = useCallback(async (level: 1 | 3 | 5) => {
    const node = contextMenu?.node;
    if (!node || !onDropNodeToRelationshipTier) return;
    await onDropNodeToRelationshipTier({
      personId: node.personId,
      accountId: node.accountId,
      level,
    });
    closeContextMenu();
  }, [closeContextMenu, contextMenu, onDropNodeToRelationshipTier]);

  const handleLinkAccountToPickerPerson = useCallback(async (personId: string) => {
    if (!linkPickerAccountId || !onLinkAccountToPerson) return;
    await onLinkAccountToPerson(linkPickerAccountId, personId);
    closeContextMenu();
  }, [closeContextMenu, linkPickerAccountId, onLinkAccountToPerson]);

  const contextMenuStyle = contextMenu
    ? {
        left: contextMenu.x,
        top: contextMenu.y,
        "--theme-menu-top": `${contextMenu.y}px`,
      } as CSSProperties
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
            ? personsById.get(selectedPersonId)?.name ?? null
            : selectedAccountId
              ? accounts[selectedAccountId]?.displayName ?? null
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
            ) : graphStatus || "Building galaxy..."}
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
            <p className="truncate text-sm font-semibold">{contextMenu.node.label}</p>
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
                    onClick={() => void handleLinkAccountToPickerPerson(person.id)}
                  >
                    <span className="block truncate font-medium">{person.name}</span>
                    <span className="block text-xs text-[color:var(--theme-text-muted)]">
                      {person.relationshipStatus === "friend" ? "Friend" : "Connection"}
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
              {(contextMenu.node.personId || contextMenu.node.accountId) ? (
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
                    setLinkPickerAccountId(contextMenu.node.accountId ?? null);
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
        className="absolute right-3 top-3 z-20 flex items-center gap-2 sm:right-4 sm:top-4"
      >
        <button type="button" className={CONTROL_BASE} onClick={fitAll}>
          Fit all
        </button>
        <button
          type="button"
          className={`${CONTROL_BASE} inline-flex items-center gap-1.5 px-2 sm:px-3`}
          onClick={() => void handleCopyDiagnostics()}
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
