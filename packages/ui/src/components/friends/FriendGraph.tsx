/**
 * Force-directed graph of Friend nodes rendered on a <canvas>.
 *
 * Layout engine: d3-force (no SVG, no wrapper lib).
 * Animation: requestAnimationFrame loop driven by the simulation's tick events.
 *
 * Visual encoding:
 *  - Node radius: baseRadius(careLevel) * log2(recentPostCount + 2), capped at 48px
 *  - Node opacity: full if posted today, fading to 50% for 30+ day silence
 *  - Pulse ring: amber if isDue && careLevel >= 4 (pulled toward ReconnectRing zone)
 *  - Avatar: drawn as clipped circular image or initials fallback
 */

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3-force";
import type { Friend, FeedItem } from "@freed/shared";
import {
  nodeRadius,
  nodeOpacity,
  isInReconnectZone,
  feedItemsForFriend,
} from "@freed/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FriendNode extends d3.SimulationNodeDatum {
  friend: Friend;
  radius: number;
  opacity: number;
  inReconnectZone: boolean;
  avatarImg: HTMLImageElement | null;
}

interface FriendGraphProps {
  friends: Friend[];
  feedItems: Record<string, FeedItem>;
  /** Canvas height in px. Defaults to filling the container. */
  height?: number;
  onSelectFriend: (friend: Friend) => void;
  selectedFriendId?: string | null;
  /** y-coordinate (canvas space) where the Reconnect zone gravity target sits */
  reconnectZoneY?: number;
}

// ---------------------------------------------------------------------------
// Avatar image cache — persisted between renders inside the module
// ---------------------------------------------------------------------------

const avatarCache = new Map<string, HTMLImageElement | null>();

function loadAvatar(url: string): HTMLImageElement | null {
  if (avatarCache.has(url)) return avatarCache.get(url)!;
  const img = new Image();
  img.crossOrigin = "anonymous";
  avatarCache.set(url, null); // optimistic: null until loaded
  img.onload = () => {
    avatarCache.set(url, img);
  };
  img.src = url;
  return null;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: FriendNode,
  selected: boolean,
  now: number
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = node.radius;

  ctx.save();
  ctx.globalAlpha = node.opacity;

  // Reconnect zone amber glow
  if (node.inReconnectZone) {
    ctx.shadowColor = "rgba(251,191,36,0.8)";
    ctx.shadowBlur = 16;
  }

  // Selection ring
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(139,92,246,0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Clip to circle
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // Avatar or gradient fallback
  const img = node.avatarImg;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  } else {
    // Gradient fallback using care level hue
    const hue = 200 + node.friend.careLevel * 20;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `hsl(${hue}, 70%, 55%)`);
    grad.addColorStop(1, `hsl(${hue + 40}, 60%, 35%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    // Initials
    const initials = node.friend.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = node.opacity;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `bold ${Math.max(10, r * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, x, y);
  }

  ctx.restore();

  // Pulse ring for recent posts (last 24h) — drawn outside clip
  const items = feedItemsForFriend({} as Record<string, FeedItem>, node.friend);
  void items; // unused here — opacity already encodes recency
  if (node.opacity === 1.0) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 800);
    ctx.save();
    ctx.globalAlpha = 0.35 * pulse;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = node.inReconnectZone ? "#f59e0b" : "#8b5cf6";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Name label below node
  ctx.save();
  ctx.globalAlpha = Math.min(node.opacity + 0.15, 1);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `${Math.max(9, r * 0.38)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const label =
    node.friend.name.length > 14
      ? node.friend.name.slice(0, 13) + "…"
      : node.friend.name;
  ctx.fillText(label, x, y + r + 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendGraph({
  friends,
  feedItems,
  height,
  onSelectFriend,
  selectedFriendId,
  reconnectZoneY,
}: FriendGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<FriendNode, never> | null>(null);
  const nodesRef = useRef<FriendNode[]>([]);
  const rafRef = useRef<number>(0);

  // Build node list from friends, preserving existing x/y to avoid jitter
  const syncNodes = useCallback(() => {
    const now = Date.now();
    const existingById = new Map(
      nodesRef.current.map((n) => [n.friend.id, n])
    );

    nodesRef.current = friends.map((friend) => {
      const existing = existingById.get(friend.id);
      const r = nodeRadius(friend, feedItems);
      const op = nodeOpacity(friend, feedItems, now);
      const inZone = isInReconnectZone(friend, now);
      const avatarUrl = friend.avatarUrl ?? friend.sources[0]?.avatarUrl;
      const avatarImg = avatarUrl ? loadAvatar(avatarUrl) : null;

      return {
        friend,
        radius: r,
        opacity: op,
        inReconnectZone: inZone,
        avatarImg,
        // Preserve position if node already existed
        x: existing?.x,
        y: existing?.y,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
      };
    });
  }, [friends, feedItems]);

  // Setup / rebuild simulation when friends change
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = container.clientWidth || 600;
    const H = height ?? container.clientHeight || 500;
    canvas.width = W;
    canvas.height = H;

    syncNodes();
    const nodes = nodesRef.current;

    if (simRef.current) simRef.current.stop();

    const RECONNECT_Y = reconnectZoneY ?? H * 0.18;

    simRef.current = d3
      .forceSimulation<FriendNode>(nodes)
      .force("center", d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force(
        "collide",
        d3
          .forceCollide<FriendNode>((n) => n.radius + 8)
          .strength(0.85)
          .iterations(2)
      )
      .force("charge", d3.forceManyBody<FriendNode>().strength(-80))
      // Pull reconnect-zone friends toward the top
      .force(
        "reconnect",
        d3
          .forceY<FriendNode>(RECONNECT_Y)
          .strength((n) => (n.inReconnectZone ? 0.12 : 0))
      )
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .on("tick", () => {
        // Update avatar cache hits — images may have loaded since last tick
        for (const node of nodes) {
          const url = node.friend.avatarUrl ?? node.friend.sources[0]?.avatarUrl;
          if (url && !node.avatarImg) {
            node.avatarImg = avatarCache.get(url) ?? null;
          }
        }
      });

    return () => {
      simRef.current?.stop();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, feedItems, height, reconnectZoneY]);

  // RAF draw loop — runs independently of simulation restarts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw(now: number) {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas!.width, canvas!.height);

      for (const node of nodesRef.current) {
        drawNode(ctx, node, node.friend.id === selectedFriendId, now);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [selectedFriendId]);

  // Hit-test on click — find topmost node under cursor
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);

      let hit: FriendNode | null = null;
      for (const node of nodesRef.current) {
        const dx = (node.x ?? 0) - mx;
        const dy = (node.y ?? 0) - my;
        if (dx * dx + dy * dy <= node.radius * node.radius) {
          hit = node;
        }
      }
      if (hit) onSelectFriend(hit.friend);
    },
    [onSelectFriend]
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ height: height ?? "100%" }}
        onClick={handleClick}
        aria-label="Friends social graph"
      />
    </div>
  );
}
