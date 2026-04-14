import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FeedItem, Friend } from "@freed/shared";
import {
  buildFrozenFriendGraphLayout,
  createLayoutSignature,
  fitTransformToNodes,
  FRIEND_GRAPH_DEFAULT_TRANSFORM,
  type FriendLayoutNode,
  type ViewTransform,
} from "../../lib/friends-graph-layout.js";
import {
  createFriendAvatarPalette,
  type FriendAvatarPalette,
} from "../../lib/friend-avatar-style.js";
import { initialsForName } from "../../lib/friend-avatar.js";
import type { ThemeId } from "@freed/shared/themes";

export interface FriendGraphHandle {
  fitAll: () => void;
  focusFriend: (friendId: string) => void;
}

interface FriendGraphProps {
  friends: Friend[];
  feedItems: Record<string, FeedItem>;
  onSelectFriend: (friend: Friend) => void;
  selectedFriendId?: string | null;
  themeId?: ThemeId;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

const LABEL_OFFSET_Y = 12;
const LABEL_PILL_HEIGHT = 20;
const LABEL_PILL_RADIUS = 10;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.4;
const FIT_PADDING = 72;
const DEFAULT_HEIGHT = 560;
const CONTROL_BASE =
  "inline-flex items-center gap-2 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] px-3 py-1.5 text-xs text-[var(--theme-text-primary)] shadow-[0_12px_28px_rgb(0_0_0_/_0.18)] transition-colors hover:bg-[var(--theme-bg-muted)]";

const avatarCache = new Map<string, HTMLImageElement | null>();

interface FriendGraphTheme {
  surfaceFill: string;
  textPrimary: string;
  labelFillStart: string;
  labelFillEnd: string;
  labelShadow: string;
  labelBorderSoft: string;
  reconnectGlow: string;
  reconnectStroke: string;
}

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

function readFriendGraphTheme(): FriendGraphTheme {
  if (typeof document === "undefined") {
    return {
      surfaceFill: "color-mix(in srgb, var(--theme-bg-surface) 96%, transparent)",
      textPrimary: "var(--theme-text-primary)",
      labelFillStart: "var(--theme-bg-elevated)",
      labelFillEnd: "var(--theme-bg-surface)",
      labelShadow: "rgb(var(--theme-shell-rgb) / 0.28)",
      labelBorderSoft: "var(--theme-border-subtle)",
      reconnectGlow: "rgb(var(--theme-feedback-warning-rgb) / 0.34)",
      reconnectStroke: "rgb(var(--theme-feedback-warning-rgb) / 0.9)",
    };
  }

  const styles = getComputedStyle(document.documentElement);
  return {
    surfaceFill: styles.getPropertyValue("--theme-graph-surface-fill").trim() || "color-mix(in srgb, var(--theme-bg-surface) 96%, transparent)",
    textPrimary: styles.getPropertyValue("--theme-graph-text-primary").trim() || "var(--theme-text-primary)",
    labelFillStart: styles.getPropertyValue("--theme-graph-label-fill-start").trim() || "var(--theme-bg-elevated)",
    labelFillEnd: styles.getPropertyValue("--theme-graph-label-fill-end").trim() || "var(--theme-bg-surface)",
    labelShadow: styles.getPropertyValue("--theme-graph-label-shadow").trim() || "rgb(var(--theme-shell-rgb) / 0.28)",
    labelBorderSoft: styles.getPropertyValue("--theme-graph-label-border-soft").trim() || "var(--theme-border-subtle)",
    reconnectGlow: styles.getPropertyValue("--theme-graph-reconnect-glow").trim() || "rgb(var(--theme-feedback-warning-rgb) / 0.34)",
    reconnectStroke: styles.getPropertyValue("--theme-graph-reconnect-stroke").trim() || "rgb(var(--theme-feedback-warning-rgb) / 0.9)",
  };
}

function graphBounds(nodes: FriendLayoutNode[]) {
  return {
    left: Math.min(...nodes.map((node) => Math.min((node.x ?? 0) - node.radius, (node.x ?? 0) - node.labelWidth / 2))),
    right: Math.max(...nodes.map((node) => Math.max((node.x ?? 0) + node.radius, (node.x ?? 0) + node.labelWidth / 2))),
    top: Math.min(...nodes.map((node) => (node.y ?? 0) - node.radius)),
    bottom: Math.max(...nodes.map((node) => (node.y ?? 0) + node.radius + LABEL_OFFSET_Y + LABEL_PILL_HEIGHT + 8)),
  };
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

function applyViewportClamp(transform: ViewTransform, nodes: FriendLayoutNode[], width: number, height: number): ViewTransform {
  if (nodes.length === 0) return transform;

  const bounds = graphBounds(nodes);
  const scaledWidth = (bounds.right - bounds.left) * transform.scale;
  const scaledHeight = (bounds.bottom - bounds.top) * transform.scale;

  if (scaledWidth <= width - FIT_PADDING * 0.5) {
    transform.x = width / 2 - ((bounds.left + bounds.right) / 2) * transform.scale;
  }

  if (scaledHeight <= height - FIT_PADDING * 0.5) {
    transform.y = height / 2 - ((bounds.top + bounds.bottom) / 2) * transform.scale;
  }

  return transform;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: FriendLayoutNode,
  selected: boolean,
  now: number,
  avatarPalette: FriendAvatarPalette,
  graphTheme: FriendGraphTheme
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const radius = node.radius;

  ctx.save();

  if (node.inReconnectZone) {
    ctx.shadowColor = graphTheme.reconnectGlow;
    ctx.shadowBlur = 18;
  }

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = graphTheme.surfaceFill;
  ctx.fill();
  ctx.restore();

  if (selected) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = avatarPalette.selectionOuterStroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  const avatarUrl = node.avatarUrl;
  const avatarImg = avatarUrl ? (node.avatarImg ?? loadAvatar(avatarUrl)) : null;
  if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
    ctx.globalAlpha = node.opacity;
    ctx.drawImage(avatarImg, x - radius, y - radius, radius * 2, radius * 2);
    const imageOverlay = ctx.createRadialGradient(x - radius * 0.18, y - radius * 0.24, 0, x, y, radius);
    imageOverlay.addColorStop(0, avatarPalette.imageHighlight);
    imageOverlay.addColorStop(0.5, "transparent");
    imageOverlay.addColorStop(1, avatarPalette.imageShadow);
    ctx.fillStyle = imageOverlay;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    node.avatarImg = avatarImg;
  } else {
    const gradient = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.3, 0, x, y, radius);
    gradient.addColorStop(0, avatarPalette.gradientStart);
    gradient.addColorStop(0.38, avatarPalette.gradientMid);
    gradient.addColorStop(1, avatarPalette.gradientEnd);
    ctx.globalAlpha = node.opacity;
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    ctx.restore();
    ctx.save();
    ctx.globalAlpha = node.opacity;
    ctx.fillStyle = avatarPalette.text;
    ctx.font = `600 ${Math.max(10, radius * 0.52)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = avatarPalette.initialsShadow;
    ctx.shadowBlur = 12;
    ctx.fillText(initialsForName(node.friend.name), x, y);
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = selected ? avatarPalette.selectionStroke : avatarPalette.borderSoft;
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.stroke();
  ctx.restore();

  if (node.opacity >= 0.98) {
    const pulse = 0.48 + 0.52 * Math.sin(now / 760);
    ctx.save();
    ctx.globalAlpha = 0.26 * pulse;
    ctx.beginPath();
    ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = node.inReconnectZone ? graphTheme.reconnectStroke : avatarPalette.selectionOuterStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.92;
  const labelY = y + radius + LABEL_OFFSET_Y;
  const labelX = x - node.labelWidth / 2;
  ctx.shadowColor = selected ? avatarPalette.selectionOuterStroke : graphTheme.labelShadow;
  ctx.shadowBlur = 10;
  drawRoundedRect(
    ctx,
    labelX,
    labelY - 2,
    node.labelWidth,
    LABEL_PILL_HEIGHT,
    LABEL_PILL_RADIUS
  );
  const labelFill = ctx.createLinearGradient(labelX, labelY, labelX, labelY + LABEL_PILL_HEIGHT);
  labelFill.addColorStop(0, selected ? avatarPalette.selectionOuterStroke : graphTheme.labelFillStart);
  labelFill.addColorStop(1, selected ? avatarPalette.gradientEnd : graphTheme.labelFillEnd);
  ctx.fillStyle = labelFill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? avatarPalette.labelBorder : graphTheme.labelBorderSoft;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = graphTheme.textPrimary;
  ctx.font = `${Math.max(11, radius * 0.36)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.label, x, labelY + LABEL_PILL_HEIGHT / 2 - 1);
  ctx.restore();
}

export const FriendGraph = forwardRef<FriendGraphHandle, FriendGraphProps>(function FriendGraph(
  {
    friends,
    feedItems,
    onSelectFriend,
    selectedFriendId,
    themeId,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<FriendLayoutNode[]>([]);
  const transformRef = useRef<ViewTransform>({ ...FRIEND_GRAPH_DEFAULT_TRANSFORM });
  const dragStateRef = useRef<DragState | null>(null);
  const layoutSignatureRef = useRef<string>("");
  const rafRef = useRef<number>(0);
  const previousPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [viewportVersion, setViewportVersion] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: DEFAULT_HEIGHT });
  const [isInteracting, setIsInteracting] = useState(false);
  const avatarPalette = useMemo(
    () => createFriendAvatarPalette(themeId),
    [themeId]
  );
  const graphTheme = readFriendGraphTheme();

  const layoutSignature = useMemo(
    () => createLayoutSignature(friends, feedItems),
    [feedItems, friends]
  );

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

  const drawGraph = useCallback((now: number) => {
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
    for (const node of nodesRef.current) {
      drawNode(ctx, node, node.friend.id === selectedFriendId, now, avatarPalette, graphTheme);
    }
    ctx.restore();
  }, [avatarPalette, selectedFriendId]);

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame((now) => {
      drawGraph(now);
    });
  }, [drawGraph]);

  const fitAll = useCallback(() => {
    if (nodesRef.current.length === 0) return;
    transformRef.current = fitTransformToNodes(
      nodesRef.current,
      canvasSize.width,
      canvasSize.height,
      FIT_PADDING
    );
    setViewportVersion((version) => version + 1);
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, scheduleDraw]);

  const focusFriend = useCallback((friendId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.friend.id === friendId);
    if (!node) return;
    const scale = transformRef.current.scale;
    transformRef.current = {
      x: canvasSize.width / 2 - (node.x ?? 0) * scale,
      y: canvasSize.height / 2 - (node.y ?? 0) * scale,
      scale,
    };
    setViewportVersion((version) => version + 1);
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, scheduleDraw]);

  useImperativeHandle(ref, () => ({
    fitAll,
    focusFriend,
  }), [fitAll, focusFriend]);

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

    const suppressBrowserViewportZoom = (event: Event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const suppressWheelScroll = (event: WheelEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("wheel", suppressWheelScroll, { passive: false });
    canvas.addEventListener("gesturestart", suppressBrowserViewportZoom, { passive: false });
    canvas.addEventListener("gesturechange", suppressBrowserViewportZoom, { passive: false });
    canvas.addEventListener("gestureend", suppressBrowserViewportZoom, { passive: false });

    return () => {
      canvas.removeEventListener("wheel", suppressWheelScroll);
      canvas.removeEventListener("gesturestart", suppressBrowserViewportZoom);
      canvas.removeEventListener("gesturechange", suppressBrowserViewportZoom);
      canvas.removeEventListener("gestureend", suppressBrowserViewportZoom);
    };
  }, []);

  useEffect(() => {
    const shouldRebuild = layoutSignatureRef.current !== layoutSignature
      || nodesRef.current.length === 0;
    if (!shouldRebuild) {
      scheduleDraw();
      return;
    }

    nodesRef.current = buildFrozenFriendGraphLayout(
      friends,
      feedItems,
      canvasSize.width,
      canvasSize.height,
      previousPositionsRef.current
    );
    previousPositionsRef.current = new Map(
      nodesRef.current.map((node) => [node.friend.id, { x: node.x ?? 0, y: node.y ?? 0 }])
    );
    layoutSignatureRef.current = layoutSignature;

    if (viewportVersion === 0) {
      transformRef.current = fitTransformToNodes(
        nodesRef.current,
        canvasSize.width,
        canvasSize.height,
        FIT_PADDING
      );
    } else {
      transformRef.current = applyViewportClamp(
        transformRef.current,
        nodesRef.current,
        canvasSize.width,
        canvasSize.height
      );
    }
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, feedItems, friends, layoutSignature, scheduleDraw, viewportVersion]);

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
    for (let index = nodesRef.current.length - 1; index >= 0; index -= 1) {
      const node = nodesRef.current[index];
      const dx = (node.x ?? 0) - point.x;
      const dy = (node.y ?? 0) - point.y;
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
    setViewportVersion((version) => version + 1);
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
    setViewportVersion((version) => version + 1);
    scheduleDraw();
  }, [scheduleDraw, zoomAtPoint]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      moved: false,
    };
    setIsInteracting(true);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
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
    setViewportVersion((version) => version + 1);
    scheduleDraw();
  }, [scheduleDraw]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    dragStateRef.current = null;
    setIsInteracting(false);
    if (moved) return;

    const hit = findHitNode(event.clientX, event.clientY);
    if (hit) {
      onSelectFriend(hit.friend);
    }
  }, [findHitNode, onSelectFriend]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsInteracting(false);
    }
  }, []);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = findHitNode(event.clientX, event.clientY);
    if (hit) {
      focusFriend(hit.friend.id);
    } else {
      fitAll();
    }
  }, [findHitNode, fitAll, focusFriend]);

  return (
    <div ref={containerRef} className="theme-soft-viewport relative h-full w-full">
      <div className="theme-soft-viewport-content">
        <canvas
          ref={canvasRef}
          className={`h-full w-full touch-none ${isInteracting ? "cursor-grabbing" : "cursor-grab"}`}
          data-testid="friend-graph-canvas"
          data-view-scale={transformRef.current.scale.toFixed(4)}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
          aria-label="Friends social graph"
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
