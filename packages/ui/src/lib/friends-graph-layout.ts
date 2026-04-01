import * as d3 from "d3-force";
import {
  feedItemsForFriend,
  isInReconnectZone,
  nodeOpacity,
  nodeRadius,
  type FeedItem,
  type Friend,
} from "@freed/shared";
import { resolveFriendAvatarUrl } from "./friend-avatar.js";

export interface FriendLayoutNode extends d3.SimulationNodeDatum {
  friend: Friend;
  radius: number;
  opacity: number;
  inReconnectZone: boolean;
  anchorX: number;
  anchorY: number;
  label: string;
  labelWidth: number;
  labelHeight: number;
  avatarUrl: string | null;
  avatarImg?: HTMLImageElement | null;
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export const FRIEND_GRAPH_DEFAULT_TRANSFORM: ViewTransform = {
  x: 0,
  y: 0,
  scale: 1,
};

export function createLayoutSignature(
  friends: Friend[],
  feedItems: Record<string, FeedItem>,
  now: number = Date.now()
): string {
  return friends
    .map((friend) => {
      const reconnect = isInReconnectZone(friend, now) ? "1" : "0";
      const radius = Math.round(nodeRadius(friend, feedItems));
      return `${friend.id}:${friend.careLevel}:${reconnect}:${radius}`;
    })
    .sort()
    .join("|");
}

function hashId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function compareFriends(a: Friend, b: Friend): number {
  return b.careLevel - a.careLevel || a.name.localeCompare(b.name);
}

function labelForFriend(friend: Friend): string {
  return friend.name.length > 18 ? `${friend.name.slice(0, 17)}...` : friend.name;
}

function estimateLabelWidth(label: string): number {
  return Math.max(68, Math.round(label.length * 7.4 + 22));
}

function buildAnchor(
  friend: Friend,
  width: number,
  height: number,
  index: number,
  count: number,
  reconnect: boolean
): { x: number; y: number } {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(320, height);
  const centerX = safeWidth / 2;
  const reconnectBandY = safeHeight * 0.24;
  const mainBandY = safeHeight * 0.58;
  const careOffset = (5 - friend.careLevel) * 30;
  const angleBase = (Math.PI * 2 * index) / Math.max(1, count);
  const jitterSeed = hashId(friend.id);
  const angle = angleBase + (jitterSeed % 13) * 0.035;

  if (reconnect) {
    const radius = Math.min(safeWidth * 0.22, 140) + (jitterSeed % 24);
    return {
      x: centerX + Math.cos(angle) * radius,
      y: reconnectBandY + Math.sin(angle) * 26,
    };
  }

  const orbit = Math.min(safeWidth, safeHeight) * 0.18 + (index % 5) * 28 + careOffset;
  return {
    x: centerX + Math.cos(angle) * orbit,
    y: mainBandY + Math.sin(angle) * (orbit * 0.48),
  };
}

export function buildFrozenFriendGraphLayout(
  friends: Friend[],
  feedItems: Record<string, FeedItem>,
  width: number,
  height: number,
  previousPositions?: Map<string, { x: number; y: number }>,
  now: number = Date.now()
): FriendLayoutNode[] {
  const sortedFriends = [...friends].sort(compareFriends);
  const reconnectFriends = sortedFriends.filter((friend) => isInReconnectZone(friend, now));
  const regularFriends = sortedFriends.filter((friend) => !isInReconnectZone(friend, now));
  const orderedFriends = reconnectFriends.concat(regularFriends);

  const nodes: FriendLayoutNode[] = orderedFriends.map((friend, index) => {
    const reconnect = isInReconnectZone(friend, now);
    const previous = previousPositions?.get(friend.id);
    const anchor = buildAnchor(friend, width, height, index, orderedFriends.length, reconnect);
    const label = labelForFriend(friend);
    const labelWidth = estimateLabelWidth(label);
    const friendItems = feedItemsForFriend(feedItems, friend)
      .sort((a, b) => b.publishedAt - a.publishedAt);
    return {
      friend,
      radius: nodeRadius(friend, feedItems),
      opacity: nodeOpacity(friend, feedItems, now),
      inReconnectZone: reconnect,
      anchorX: anchor.x,
      anchorY: anchor.y,
      label,
      labelWidth,
      labelHeight: 20,
      avatarUrl: resolveFriendAvatarUrl(friend, friendItems.map((item) => item.author.avatarUrl)),
      x: previous?.x ?? anchor.x,
      y: previous?.y ?? anchor.y,
      vx: 0,
      vy: 0,
    };
  });

  const simulation = d3
    .forceSimulation<FriendLayoutNode>(nodes)
    .force("x", d3.forceX<FriendLayoutNode>((node) => node.anchorX).strength(0.22))
    .force("y", d3.forceY<FriendLayoutNode>((node) => node.anchorY).strength(0.24))
    .force(
      "collide",
      d3
        .forceCollide<FriendLayoutNode>((node) => Math.max(node.radius + 20, node.labelWidth * 0.58))
        .iterations(4)
        .strength(1)
    )
    .force("charge", d3.forceManyBody<FriendLayoutNode>().strength(-48))
    .velocityDecay(0.34)
    .alpha(0.95)
    .alphaDecay(0.04)
    .stop();

  for (let tick = 0; tick < 180; tick += 1) {
    simulation.tick();
  }
  simulation.stop();

  for (const node of nodes) {
    node.fx = node.x;
    node.fy = node.y;
  }

  return nodes;
}

export function fitTransformToNodes(
  nodes: Array<{ x?: number; y?: number; radius: number }>,
  width: number,
  height: number,
  padding: number = 64
): ViewTransform {
  if (nodes.length === 0) return { ...FRIEND_GRAPH_DEFAULT_TRANSFORM };

  const left = Math.min(...nodes.map((node) => (node.x ?? 0) - node.radius));
  const right = Math.max(...nodes.map((node) => (node.x ?? 0) + node.radius));
  const top = Math.min(...nodes.map((node) => (node.y ?? 0) - node.radius));
  const bottom = Math.max(...nodes.map((node) => (node.y ?? 0) + node.radius));

  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const scale = Math.max(
    0.45,
    Math.min(
      1.6,
      Math.min(
        (width - padding * 2) / contentWidth,
        (height - padding * 2) / contentHeight
      )
    )
  );

  const x = width / 2 - ((left + right) / 2) * scale;
  const y = height / 2 - ((top + bottom) / 2) * scale;
  return { x, y, scale };
}
