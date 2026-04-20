import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Account, FeedItem, MapMode, Person } from "@freed/shared";
import type { ThemeId } from "@freed/shared/themes";
import {
  FRIEND_GRAPH_DEFAULT_TRANSFORM,
  buildIdentityGraphLayout,
  createIdentityGraphLayoutSignature,
  fitTransformToNodes,
  type IdentityGraphLayout,
  type IdentityGraphNode,
  type ViewTransform,
} from "../../lib/identity-graph.js";
import {
  buildSuggestionStrengthByAccount,
  type AccountLinkSuggestion,
} from "../../lib/account-link-suggestions.js";
import {
  createFriendAvatarPalette,
  type FriendAvatarPalette,
} from "../../lib/friend-avatar-style.js";
import { initialsForName } from "../../lib/friend-avatar.js";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusNode: (id: string) => void;
}

interface FriendGraphProps {
  persons: Person[];
  accounts: Record<string, Account>;
  feedItems: Record<string, FeedItem>;
  mode: MapMode;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  suggestionsByAccount?: Map<string, AccountLinkSuggestion[]>;
  onSelectPerson: (person: Person) => void;
  onSelectAccount: (account: Account) => void;
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
  startWorldX: number;
  startWorldY: number;
  moved: boolean;
  dropTargetPersonId: string | null;
};

type DragState = PanState | AccountDragState;

const DEFAULT_HEIGHT = 560;
const FIT_PADDING = 72;
const MIN_SCALE = 0.38;
const MAX_SCALE = 1.9;
const CONTROL_BASE =
  "inline-flex items-center gap-2 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] px-3 py-1.5 text-xs text-[var(--theme-text-primary)] shadow-[0_12px_28px_rgb(0_0_0_/_0.18)] transition-colors hover:bg-[var(--theme-bg-muted)]";

const PROVIDER_COLORS: Record<string, { fill: string; glow: string; stroke: string }> = {
  instagram: {
    fill: "rgb(244 114 182 / 0.12)",
    glow: "rgb(244 114 182 / 0.2)",
    stroke: "rgb(244 114 182 / 0.3)",
  },
  facebook: {
    fill: "rgb(96 165 250 / 0.12)",
    glow: "rgb(96 165 250 / 0.18)",
    stroke: "rgb(96 165 250 / 0.28)",
  },
  x: {
    fill: "rgb(148 163 184 / 0.14)",
    glow: "rgb(148 163 184 / 0.2)",
    stroke: "rgb(148 163 184 / 0.24)",
  },
  linkedin: {
    fill: "rgb(56 189 248 / 0.12)",
    glow: "rgb(56 189 248 / 0.18)",
    stroke: "rgb(56 189 248 / 0.24)",
  },
};

const avatarCache = new Map<string, HTMLImageElement | null>();

function loadAvatar(url: string): HTMLImageElement | null {
  if (avatarCache.has(url)) return avatarCache.get(url) ?? null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  avatarCache.set(url, null);
  img.onload = () => avatarCache.set(url, img);
  img.src = url;
  return null;
}

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const clampedRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(x + width - clampedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  ctx.lineTo(x + width, y + height - clampedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  ctx.lineTo(x + clampedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
  ctx.closePath();
}

function nodeIsSelected(
  node: IdentityGraphNode,
  selectedPersonId?: string | null,
  selectedAccountId?: string | null,
): boolean {
  if (node.kind === "person") return node.personId === selectedPersonId;
  return node.accountId === selectedAccountId;
}

function nodeDisplayName(node: IdentityGraphNode, persons: Record<string, Person>, accounts: Record<string, Account>) {
  if (node.kind === "person" && node.personId) {
    return persons[node.personId]?.name ?? node.label;
  }
  if (node.accountId) {
    const account = accounts[node.accountId];
    return account?.displayName ?? account?.handle ?? account?.externalId ?? node.label;
  }
  return node.label;
}

function drawProviderRegions(ctx: CanvasRenderingContext2D, layout: IdentityGraphLayout) {
  for (const region of layout.regions) {
    const palette = PROVIDER_COLORS[region.provider] ?? PROVIDER_COLORS.x;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = palette.fill;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 34;
    ctx.beginPath();
    ctx.ellipse(region.x, region.y, region.radiusX, region.radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(region.x + region.radiusX * 0.18, region.y - region.radiusY * 0.12, region.radiusX * 0.66, region.radiusY * 0.72, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(region.x, region.y, region.radiusX, region.radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  layout: IdentityGraphLayout,
  selectedPersonId?: string | null,
) {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const edge of layout.edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    ctx.save();
    ctx.strokeStyle = source.personId === selectedPersonId
      ? "rgb(var(--theme-accent-secondary-rgb) / 0.72)"
      : "rgb(var(--theme-text-rgb) / 0.18)";
    ctx.lineWidth = source.personId === selectedPersonId ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: IdentityGraphNode,
  selected: boolean,
  dropTarget: boolean,
  displayName: string,
  avatarPalette: FriendAvatarPalette,
) {
  const radius = node.radius;
  ctx.save();
  ctx.globalAlpha = node.opacity;
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(node.x - radius * 0.3, node.y - radius * 0.35, 0, node.x, node.y, radius);
  gradient.addColorStop(0, avatarPalette.gradientStart);
  gradient.addColorStop(0.45, avatarPalette.gradientMid);
  gradient.addColorStop(1, avatarPalette.gradientEnd);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  const avatarImg = node.avatarUrl ? (avatarCache.get(node.avatarUrl) ?? loadAvatar(node.avatarUrl)) : null;
  if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = node.opacity;
    ctx.drawImage(avatarImg, node.x - radius, node.y - radius, radius * 2, radius * 2);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = avatarPalette.text;
    ctx.font = `600 ${Math.max(10, radius * 0.54)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsForName(displayName || node.label), node.x, node.y);
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  ctx.lineWidth = selected ? 3 : dropTarget ? 2.5 : 1.25;
  ctx.strokeStyle = selected
    ? avatarPalette.selectionOuterStroke
    : dropTarget
      ? "rgb(var(--theme-feedback-success-rgb) / 0.92)"
      : "rgb(var(--theme-text-rgb) / 0.18)";
  ctx.stroke();
  ctx.restore();

  if (node.kind !== "person") {
    const providerPalette = PROVIDER_COLORS[node.provider ?? "x"] ?? PROVIDER_COLORS.x;
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x + radius * 0.62, node.y - radius * 0.62, Math.max(5, radius * 0.26), 0, Math.PI * 2);
    ctx.fillStyle = providerPalette.stroke;
    ctx.fill();
    ctx.restore();
  }

  if (node.suggestionConfidence) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x - radius * 0.7, node.y - radius * 0.7, Math.max(5, radius * 0.22), 0, Math.PI * 2);
    ctx.fillStyle = node.suggestionConfidence === "high"
      ? "rgb(var(--theme-feedback-success-rgb) / 0.95)"
      : "rgb(var(--theme-feedback-warning-rgb) / 0.9)";
    ctx.fill();
    ctx.restore();
  }

  const label = node.label;
  const labelWidth = Math.max(70, Math.round(label.length * 7.2 + 24));
  const labelHeight = 20;
  const labelX = node.x - labelWidth / 2;
  const labelY = node.y + radius + 12;
  ctx.save();
  drawRoundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 10);
  ctx.fillStyle = selected ? avatarPalette.selectionOuterStroke : "rgb(var(--theme-surface-rgb) / 0.88)";
  ctx.strokeStyle = "rgb(var(--theme-text-rgb) / 0.14)";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = selected ? avatarPalette.text : "var(--theme-text-primary)";
  ctx.font = `${Math.max(10, radius * 0.38)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, node.x, labelY + labelHeight / 2);
  ctx.restore();
}

export const FriendGraph = forwardRef<FriendGraphHandle, FriendGraphProps>(function FriendGraph(
  {
    persons,
    accounts,
    feedItems,
    mode,
    selectedPersonId,
    selectedAccountId,
    suggestionsByAccount,
    onSelectPerson,
    onSelectAccount,
    onLinkAccountToPerson,
    themeId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<IdentityGraphLayout>({ nodes: [], edges: [], regions: [] });
  const dragStateRef = useRef<DragState | null>(null);
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const layoutSignatureRef = useRef("");
  const rafRef = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: DEFAULT_HEIGHT });
  const [isInteracting, setIsInteracting] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const avatarPalette = useMemo(() => createFriendAvatarPalette(themeId), [themeId]);
  const personsById = useMemo(() => Object.fromEntries(persons.map((person) => [person.id, person])), [persons]);
  const suggestionStrengthByAccount = useMemo(
    (): Map<string, "high" | "medium"> =>
      suggestionsByAccount
        ? new Map(
            Array.from(suggestionsByAccount.entries()).map(([accountId, suggestions]) => [
              accountId,
              suggestions.some((suggestion) => suggestion.confidence === "high")
                ? ("high" as const)
                : ("medium" as const),
            ]),
          )
        : buildSuggestionStrengthByAccount(personsById, accounts),
    [accounts, personsById, suggestionsByAccount],
  );

  const layoutSignature = useMemo(
    () => createIdentityGraphLayoutSignature(persons, Object.values(accounts), feedItems, mode),
    [accounts, feedItems, mode, persons],
  );

  const rebuildLayout = useCallback((preserveViewport: boolean) => {
    const nextLayout = buildIdentityGraphLayout({
      persons,
      accounts,
      feedItems,
      width: canvasSize.width,
      height: canvasSize.height,
      mode,
      suggestionsByAccount: suggestionStrengthByAccount,
    });
    layoutRef.current = nextLayout;
    layoutSignatureRef.current = layoutSignature;
    if (!preserveViewport || layoutVersion === 0) {
      transformRef.current = fitTransformToNodes(nextLayout.nodes, canvasSize.width, canvasSize.height, FIT_PADDING);
    }
    setLayoutVersion((value) => value + 1);
  }, [accounts, canvasSize.height, canvasSize.width, feedItems, layoutSignature, layoutVersion, mode, persons, suggestionStrengthByAccount]);

  const updateCanvasSize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight || DEFAULT_HEIGHT);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    setCanvasSize({ width, height });
  }, []);

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const transform = transformRef.current;
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    drawProviderRegions(ctx, layoutRef.current);
    drawEdges(ctx, layoutRef.current, selectedPersonId);

    const dropTargetPersonId =
      dragStateRef.current?.kind === "account-drag" ? dragStateRef.current.dropTargetPersonId : null;

    for (const node of layoutRef.current.nodes) {
      drawNode(
        ctx,
        node,
        nodeIsSelected(node, selectedPersonId, selectedAccountId),
        node.kind === "person" && node.personId === dropTargetPersonId,
        nodeDisplayName(node, personsById, accounts),
        avatarPalette,
      );
    }
    ctx.restore();
  }, [accounts, avatarPalette, personsById, selectedAccountId, selectedPersonId]);

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      drawGraph();
    });
  }, [drawGraph]);

  const fitAll = useCallback(() => {
    if (layoutRef.current.nodes.length === 0) return;
    transformRef.current = fitTransformToNodes(layoutRef.current.nodes, canvasSize.width, canvasSize.height, FIT_PADDING);
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, scheduleDraw]);

  const focusNode = useCallback((id: string) => {
    const hit = layoutRef.current.nodes.find((node) => node.id === id || node.personId === id || node.accountId === id);
    if (!hit) return;
    const scale = transformRef.current.scale;
    transformRef.current = {
      x: canvasSize.width / 2 - hit.x * scale,
      y: canvasSize.height / 2 - hit.y * scale,
      scale,
    };
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, scheduleDraw]);

  useImperativeHandle(ref, () => ({
    fitAll,
    focusNode,
  }), [fitAll, focusNode]);

  useEffect(() => {
    updateCanvasSize();
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    window.addEventListener("resize", updateCanvasSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateCanvasSize);
    };
  }, [updateCanvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const suppress = (event: Event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("wheel", suppress, { passive: false });
    canvas.addEventListener("gesturestart", suppress, { passive: false });
    canvas.addEventListener("gesturechange", suppress, { passive: false });
    canvas.addEventListener("gestureend", suppress, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", suppress);
      canvas.removeEventListener("gesturestart", suppress);
      canvas.removeEventListener("gesturechange", suppress);
      canvas.removeEventListener("gestureend", suppress);
    };
  }, []);

  useEffect(() => {
    const shouldRebuild = layoutSignatureRef.current !== layoutSignature || layoutRef.current.nodes.length === 0;
    if (!shouldRebuild) {
      scheduleDraw();
      return;
    }
    rebuildLayout(layoutVersion !== 0);
    scheduleDraw();
  }, [layoutSignature, layoutVersion, rebuildLayout, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [scheduleDraw]);

  const viewportToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const transform = transformRef.current;
    return {
      x: (localX - transform.x) / transform.scale,
      y: (localY - transform.y) / transform.scale,
    };
  }, []);

  const findHitNode = useCallback((clientX: number, clientY: number) => {
    const point = viewportToWorld(clientX, clientY);
    for (let index = layoutRef.current.nodes.length - 1; index >= 0; index -= 1) {
      const node = layoutRef.current.nodes[index];
      const dx = node.x - point.x;
      const dy = node.y - point.y;
      if (dx * dx + dy * dy <= node.radius * node.radius) {
        return node;
      }
    }
    return null;
  }, [viewportToWorld]);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
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
    scheduleDraw();
  }, [scheduleDraw]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.exp(-event.deltaY * 0.0025);
      zoomAtPoint(event.clientX, event.clientY, transformRef.current.scale * delta);
      return;
    }

    transformRef.current = {
      ...transformRef.current,
      x: transformRef.current.x - event.deltaX,
      y: transformRef.current.y - event.deltaY,
    };
    scheduleDraw();
  }, [scheduleDraw, zoomAtPoint]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const hit = findHitNode(event.clientX, event.clientY);

    if (hit?.kind === "unlinked_account" && hit.accountId) {
      dragStateRef.current = {
        kind: "account-drag",
        pointerId: event.pointerId,
        nodeId: hit.id,
        accountId: hit.accountId,
        startX: event.clientX,
        startY: event.clientY,
        startWorldX: hit.x,
        startWorldY: hit.y,
        moved: false,
        dropTargetPersonId: null,
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
  }, [findHitNode]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
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
      scheduleDraw();
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
    }

    const node = layoutRef.current.nodes.find((candidate) => candidate.id === drag.nodeId);
    if (node) {
      const point = viewportToWorld(event.clientX, event.clientY);
      node.x = point.x;
      node.y = point.y;
    }

    const dropTarget = findHitNode(event.clientX, event.clientY);
    drag.dropTargetPersonId =
      dropTarget?.kind === "person" && dropTarget.personId ? dropTarget.personId : null;
    scheduleDraw();
  }, [findHitNode, scheduleDraw, viewportToWorld]);

  const handlePointerUp = useCallback(async (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsInteracting(false);

    if (drag.kind === "account-drag") {
      if (drag.moved && drag.dropTargetPersonId && onLinkAccountToPerson) {
        await onLinkAccountToPerson(drag.accountId, drag.dropTargetPersonId);
      } else if (!drag.moved) {
        const account = accounts[drag.accountId];
        if (account) {
          onSelectAccount(account);
        }
      }
      rebuildLayout(true);
      scheduleDraw();
      return;
    }

    if (drag.moved) return;
    const hit = findHitNode(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.kind === "person" && hit.personId) {
      const person = personsById[hit.personId];
      if (person) onSelectPerson(person);
      return;
    }
    if (hit.accountId) {
      const account = accounts[hit.accountId];
      if (account) onSelectAccount(account);
    }
  }, [accounts, findHitNode, onLinkAccountToPerson, onSelectAccount, onSelectPerson, personsById, rebuildLayout, scheduleDraw]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsInteracting(false);
      rebuildLayout(true);
      scheduleDraw();
    }
  }, [rebuildLayout, scheduleDraw]);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = findHitNode(event.clientX, event.clientY);
    if (hit) {
      focusNode(hit.id);
    } else {
      fitAll();
    }
  }, [findHitNode, fitAll, focusNode]);

  return (
    <div
      ref={containerRef}
      data-testid="friend-graph-viewport"
      className="theme-soft-viewport relative h-full w-full"
    >
      <div className="theme-soft-viewport-content">
        <canvas
          ref={canvasRef}
          className={`h-full w-full touch-none ${isInteracting ? "cursor-grabbing" : "cursor-grab"}`}
          data-testid="friend-graph-canvas"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
          aria-label="Friends identity graph"
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
    </div>
  );
});
