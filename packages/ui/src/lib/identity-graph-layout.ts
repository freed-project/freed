import type {
  IdentityGraphEdge,
  IdentityGraphModel,
  IdentityGraphNode,
} from "./identity-graph-model.js";
import {
  forceCenter,
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";

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

export interface IdentityGraphLayoutNode extends IdentityGraphNode {
  x: number;
  y: number;
}

export interface IdentityGraphLayout {
  nodes: IdentityGraphLayoutNode[];
  edges: IdentityGraphEdge[];
  regions: IdentityGraphRegion[];
}

export interface IdentityGraphRegion {
  id: string;
  provider: string;
  label: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  count: number;
}

export interface SpatialIndex {
  cellSize: number;
  buckets: Map<string, IdentityGraphLayoutNode[]>;
}

interface BuildIdentityGraphLayoutArgs {
  model: IdentityGraphModel;
  width: number;
  height: number;
  quality?: GraphLayoutQuality;
}

export type GraphLayoutQuality = "full" | "fast";

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function seededUnit(value: string): number {
  return (hashValue(value) % 10_000) / 10_000;
}

function seededAngle(value: string): number {
  return seededUnit(value) * Math.PI * 2;
}

function hasPinnedPosition(node: IdentityGraphNode): boolean {
  return node.graphPinned === true &&
    typeof node.graphX === "number" &&
    Number.isFinite(node.graphX) &&
    typeof node.graphY === "number" &&
    Number.isFinite(node.graphY);
}

function applyPinnedPosition(node: IdentityGraphNode, fallback: { x: number; y: number }): { x: number; y: number } {
  if (hasPinnedPosition(node)) {
    return {
      x: node.graphX!,
      y: node.graphY!,
    };
  }
  return fallback;
}

interface ForcePersonNode extends SimulationNodeDatum {
  source: IdentityGraphNode;
  targetX: number;
  targetY: number;
}

function providerLabel(provider: string): string {
  if (provider === "rss") return "RSS";
  if (provider === "x") return "X";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function solvePersonField(
  friendNodes: IdentityGraphNode[],
  connectionNodes: IdentityGraphNode[],
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  quality: GraphLayoutQuality,
): IdentityGraphLayoutNode[] {
  const minDimension = Math.min(width, height);
  const friendRadius = Math.max(84, minDimension * 0.18);
  const connectionRadius = Math.max(220, minDimension * 0.36);
  const nodes = [...friendNodes, ...connectionNodes];
  if (nodes.length === 0) return [];

  const forceNodes: ForcePersonNode[] = nodes.map((node, index) => {
    const ringRadius = node.kind === "friend_person"
      ? friendRadius + Math.floor(index / 56) * 58
      : connectionRadius + Math.floor(index / 96) * 52;
    const angle = seededAngle(node.id);
    const targetX = centerX + Math.cos(angle) * ringRadius;
    const targetY = centerY + Math.sin(angle) * ringRadius * 0.72;
    const fallback = {
      x: targetX + (seededUnit(`${node.id}:x`) - 0.5) * 26,
      y: targetY + (seededUnit(`${node.id}:y`) - 0.5) * 26,
    };
    const pinned = applyPinnedPosition(node, fallback);
    return {
      source: node,
      x: pinned.x,
      y: pinned.y,
      fx: hasPinnedPosition(node) ? pinned.x : undefined,
      fy: hasPinnedPosition(node) ? pinned.y : undefined,
      targetX,
      targetY,
    };
  });

  const ticks = quality === "fast"
    ? Math.min(34, 12 + Math.ceil(Math.sqrt(nodes.length)))
    : Math.min(140, 42 + Math.ceil(Math.sqrt(nodes.length) * 4));
  const simulation = forceSimulation(forceNodes)
    .stop()
    .alpha(0.82)
    .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
    .velocityDecay(0.48)
    .force("center", forceCenter(centerX, centerY).strength(0.012))
    .force("x", forceX((node) => (node as ForcePersonNode).targetX).strength((node) =>
      (node as ForcePersonNode).source.kind === "friend_person" ? 0.08 : 0.11,
    ))
    .force("y", forceY((node) => (node as ForcePersonNode).targetY).strength((node) =>
      (node as ForcePersonNode).source.kind === "friend_person" ? 0.08 : 0.11,
    ))
    .force("collide", forceCollide((node) => (node as ForcePersonNode).source.radius + 18).iterations(quality === "fast" ? 1 : 2));

  for (let index = 0; index < ticks; index += 1) {
    simulation.tick();
  }

  return forceNodes.map((node) => ({
    ...node.source,
    x: node.x ?? node.targetX,
    y: node.y ?? node.targetY,
  }));
}

function buildOverlapBuckets(
  nodes: IdentityGraphLayoutNode[],
  cellSize: number,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const minX = Math.floor((node.x - node.radius) / cellSize);
    const maxX = Math.floor((node.x + node.radius) / cellSize);
    const minY = Math.floor((node.y - node.radius) / cellSize);
    const maxY = Math.floor((node.y + node.radius) / cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(index);
        } else {
          buckets.set(key, [index]);
        }
      }
    }
  }
  return buckets;
}

export function nudgeOverlapsBucketed(
  nodes: IdentityGraphLayoutNode[],
  iterations: number,
): void {
  if (nodes.length < 2 || iterations <= 0) return;
  const maxRadius = nodes.reduce((currentMax, node) => Math.max(currentMax, node.radius), 0);
  const cellSize = Math.max(48, Math.ceil(maxRadius * 2 + 12));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const buckets = buildOverlapBuckets(nodes, cellSize);
    const seenPairs = new Set<string>();

    for (const indices of buckets.values()) {
      for (let leftOffset = 0; leftOffset < indices.length; leftOffset += 1) {
        const leftIndex = indices[leftOffset]!;
        const left = nodes[leftIndex]!;
        for (let rightOffset = leftOffset + 1; rightOffset < indices.length; rightOffset += 1) {
          const rightIndex = indices[rightOffset]!;
          const pairKey = leftIndex < rightIndex
            ? `${leftIndex}:${rightIndex}`
            : `${rightIndex}:${leftIndex}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const right = nodes[rightIndex]!;
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.hypot(dx, dy) || 0.001;
          const minDistance = left.radius + right.radius + 10;
          if (distance >= minDistance) continue;
          const push = (minDistance - distance) / 2;
          const unitX = dx / distance;
          const unitY = dy / distance;
          if (left.graphPinned && right.graphPinned) continue;
          if (left.graphPinned) {
            right.x += unitX * push * 2;
            right.y += unitY * push * 2;
            continue;
          }
          if (right.graphPinned) {
            left.x -= unitX * push * 2;
            left.y -= unitY * push * 2;
            continue;
          }
          left.x -= unitX * push;
          left.y -= unitY * push;
          right.x += unitX * push;
          right.y += unitY * push;
        }
      }
    }
  }
}

export function buildIdentityGraphLayout({
  model,
  width,
  height,
  quality = "full",
}: BuildIdentityGraphLayoutArgs): IdentityGraphLayout {
  const friendNodes = model.nodes.filter((node) => node.kind === "friend_person");
  const connectionNodes = model.nodes.filter((node) => node.kind === "connection_person");
  const accountNodes = model.nodes.filter((node) => node.kind === "account");
  const feedNodes = model.nodes.filter((node) => node.kind === "feed");
  const nodeById = new Map<string, IdentityGraphLayoutNode>();
  const regions: IdentityGraphRegion[] = [];

  const centerX = width / 2;
  const centerY = height / 2;
  const minDimension = Math.min(width, height);
  const outerRadius = Math.max(330, minDimension * 0.56);

  const positionedPeople = solvePersonField(
    friendNodes,
    connectionNodes,
    centerX,
    centerY,
    width,
    height,
    quality,
  );
  const positionedFriends = positionedPeople.filter((node) => node.kind === "friend_person");
  const positionedConnections = positionedPeople.filter((node) => node.kind === "connection_person");

  for (const node of [...positionedFriends, ...positionedConnections]) {
    nodeById.set(node.id, node);
  }

  const linkedAccounts = accountNodes.filter((node) => node.linkedPersonId);
  const unlinkedAccounts = accountNodes.filter((node) => !node.linkedPersonId);
  const laidOutAccounts: IdentityGraphLayoutNode[] = [];

  const linkedByPerson = new Map<string, IdentityGraphNode[]>();
  for (const node of linkedAccounts) {
    const key = node.linkedPersonId!;
    const bucket = linkedByPerson.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      linkedByPerson.set(key, [node]);
    }
  }

  for (const [personId, bucket] of linkedByPerson) {
    const anchor = nodeById.get(`person:${personId}`);
    if (!anchor) continue;
    bucket
      .sort((left, right) =>
        (left.provider ?? "").localeCompare(right.provider ?? "") ||
        left.label.localeCompare(right.label),
      )
      .forEach((node, index) => {
        const ring = Math.floor(index / 10);
        const angle = (Math.PI * 2 * index) / Math.max(1, Math.min(bucket.length, 10)) + (hashValue(node.id) % 11) * 0.02;
        const orbit = anchor.radius + 34 + ring * 18;
        const fallback = {
          x: anchor.x + Math.cos(angle) * orbit,
          y: anchor.y + Math.sin(angle) * orbit,
        };
        const position = applyPinnedPosition(node, fallback);
        const placed: IdentityGraphLayoutNode = {
          ...node,
          x: position.x,
          y: position.y,
        };
        laidOutAccounts.push(placed);
        nodeById.set(node.id, placed);
      });
  }

  const unlinkedChannels = [...unlinkedAccounts, ...feedNodes];
  const providerBuckets = new Map<string, IdentityGraphNode[]>();
  for (const node of unlinkedChannels) {
    const provider = node.provider ?? "other";
    const bucket = providerBuckets.get(provider);
    if (bucket) {
      bucket.push(node);
    } else {
      providerBuckets.set(provider, [node]);
    }
  }
  const providers = [...providerBuckets.keys()].sort();
  providers.forEach((provider, providerIndex) => {
    const bucket = providerBuckets.get(provider) ?? [];
    const sectorCenter = (-Math.PI / 2) + (Math.PI * 2 * providerIndex) / Math.max(1, providers.length);
    const islandRing = Math.floor(providerIndex / 8);
    const islandRadius = outerRadius + islandRing * 120;
    const islandX = centerX + Math.cos(sectorCenter) * islandRadius;
    const islandY = centerY + Math.sin(sectorCenter) * islandRadius * 0.82;
    const rows = Math.max(1, Math.ceil(Math.sqrt(bucket.length)));
    const islandSize = Math.max(96, Math.ceil(Math.sqrt(bucket.length)) * 22);
    regions.push({
      id: `region:${provider}`,
      provider,
      label: providerLabel(provider),
      x: islandX,
      y: islandY,
      radiusX: islandSize + 54,
      radiusY: islandSize * 0.72 + 42,
      count: bucket.length,
    });
    bucket
      .sort((left, right) =>
        right.weight - left.weight ||
        left.label.localeCompare(right.label),
      )
      .forEach((node, index) => {
        const col = index % rows;
        const row = Math.floor(index / rows);
        const jitterX = (seededUnit(`${node.id}:provider-x`) - 0.5) * 10;
        const jitterY = (seededUnit(`${node.id}:provider-y`) - 0.5) * 10;
        const fallback = {
          x: islandX + (col - (rows - 1) / 2) * 24 + jitterX,
          y: islandY + (row - (Math.ceil(bucket.length / rows) - 1) / 2) * 24 + jitterY,
        };
        const position = applyPinnedPosition(node, fallback);
        const placed: IdentityGraphLayoutNode = {
          ...node,
          x: position.x,
          y: position.y,
        };
        laidOutAccounts.push(placed);
        nodeById.set(node.id, placed);
      });
  });

  const nodes = [
    ...positionedFriends,
    ...positionedConnections,
    ...laidOutAccounts,
  ];

  const overlapIterations =
    quality === "fast"
      ? {
          friends: 2,
          connections: 2,
          accounts: 1,
        }
      : {
          friends: 4,
          connections: 5,
          accounts: 2,
        };

  nudgeOverlapsBucketed(positionedFriends, overlapIterations.friends);
  nudgeOverlapsBucketed(positionedConnections, overlapIterations.connections);
  nudgeOverlapsBucketed(laidOutAccounts, overlapIterations.accounts);

  return {
    nodes,
    edges: model.edges,
    regions,
  };
}

export function buildSpatialIndex(
  nodes: IdentityGraphLayoutNode[],
  cellSize: number = 96,
): SpatialIndex {
  const buckets = new Map<string, IdentityGraphLayoutNode[]>();
  for (const node of nodes) {
    const minX = Math.floor((node.x - node.radius) / cellSize);
    const maxX = Math.floor((node.x + node.radius) / cellSize);
    const minY = Math.floor((node.y - node.radius) / cellSize);
    const maxY = Math.floor((node.y + node.radius) / cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(node);
        } else {
          buckets.set(key, [node]);
        }
      }
    }
  }
  return { cellSize, buckets };
}

export function findHitNode(
  index: SpatialIndex,
  x: number,
  y: number,
): IdentityGraphLayoutNode | null {
  const bucketX = Math.floor(x / index.cellSize);
  const bucketY = Math.floor(y / index.cellSize);
  const nearby: IdentityGraphLayoutNode[] = [];
  for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      const bucket = index.buckets.get(`${bucketX + xOffset}:${bucketY + yOffset}`);
      if (bucket) {
        nearby.push(...bucket);
      }
    }
  }

  let bestHit: IdentityGraphLayoutNode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of nearby) {
    const dx = node.x - x;
    const dy = node.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > node.radius * node.radius) continue;
    if (distanceSq < bestScore) {
      bestHit = node;
      bestScore = distanceSq;
    }
  }
  return bestHit;
}

export function fitTransformToNodes(
  nodes: Array<{ x: number; y: number; radius: number }>,
  width: number,
  height: number,
  padding: number = 80,
): ViewTransform {
  if (nodes.length === 0) return { ...FRIEND_GRAPH_DEFAULT_TRANSFORM };

  const left = Math.min(...nodes.map((node) => node.x - node.radius));
  const right = Math.max(...nodes.map((node) => node.x + node.radius));
  const top = Math.min(...nodes.map((node) => node.y - node.radius));
  const bottom = Math.max(...nodes.map((node) => node.y + node.radius));
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const scale = clamp(
    Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight),
    0.22,
    1.5,
  );
  return {
    x: width / 2 - ((left + right) / 2) * scale,
    y: height / 2 - ((top + bottom) / 2) * scale,
    scale,
  };
}
