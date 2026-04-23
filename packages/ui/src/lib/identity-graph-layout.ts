import type {
  IdentityGraphEdge,
  IdentityGraphModel,
  IdentityGraphNode,
} from "./identity-graph-model.js";

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

function placeRadialGroup(
  nodes: IdentityGraphNode[],
  centerX: number,
  centerY: number,
  baseRadius: number,
  ringStep: number,
  startAngle: number,
  endAngle: number,
  elongationY: number,
  singleNodeAtCenter: boolean,
): IdentityGraphLayoutNode[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{
      ...nodes[0],
      x: centerX + (singleNodeAtCenter ? 0 : baseRadius),
      y: centerY,
    }];
  }

  return nodes.map((node, index) => {
    const angleSpan = endAngle - startAngle;
    const ratio = nodes.length === 1 ? 0.5 : index / Math.max(1, nodes.length - 1);
    const angle = startAngle + angleSpan * ratio + ((hashValue(node.id) % 9) - 4) * 0.01;
    const ring = Math.floor(index / 8);
    const radius = baseRadius + ring * ringStep + (hashValue(node.id) % 17);
    return {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * elongationY,
    };
  });
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

  const centerX = width / 2;
  const centerY = height / 2;
  const innerRadius = Math.max(40, Math.min(width, height) * 0.11);
  const middleRadius = Math.max(150, Math.min(width, height) * 0.27);
  const outerRadius = Math.max(260, Math.min(width, height) * 0.42);
  const feedRadius = Math.max(360, Math.min(width, height) * 0.56);

  const positionedFriends = placeRadialGroup(
    friendNodes,
    centerX,
    centerY,
    innerRadius,
    50,
    -Math.PI * 0.92,
    Math.PI * 0.92,
    0.68,
    true,
  );
  const positionedConnections = placeRadialGroup(
    connectionNodes,
    centerX,
    centerY,
    middleRadius,
    48,
    -Math.PI * 0.98,
    Math.PI * 0.98,
    0.8,
    false,
  );

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
        const placed: IdentityGraphLayoutNode = {
          ...node,
          x: anchor.x + Math.cos(angle) * orbit,
          y: anchor.y + Math.sin(angle) * orbit,
        };
        laidOutAccounts.push(placed);
        nodeById.set(node.id, placed);
      });
  }

  const providerBuckets = new Map<string, IdentityGraphNode[]>();
  for (const node of unlinkedAccounts) {
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
    bucket
      .sort((left, right) => left.label.localeCompare(right.label))
      .forEach((node, index) => {
        const ring = Math.floor(index / 18);
        const sectorOffset = ((index % 18) - 8.5) * 0.065;
        const radius = outerRadius + ring * 22 + (hashValue(node.id) % 15);
        const angle = sectorCenter + sectorOffset;
        const placed: IdentityGraphLayoutNode = {
          ...node,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius * 0.84,
        };
        laidOutAccounts.push(placed);
        nodeById.set(node.id, placed);
      });
  });

  const laidOutFeeds = feedNodes
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((node, index) => {
      const ring = Math.floor(index / 28);
      const angle = (-Math.PI * 0.88) + ((Math.PI * 1.76) * (index % 28)) / Math.max(1, Math.min(feedNodes.length, 28));
      const radius = feedRadius + ring * 20 + (hashValue(node.id) % 13);
      const placed: IdentityGraphLayoutNode = {
        ...node,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.9,
      };
      nodeById.set(node.id, placed);
      return placed;
    });

  const nodes = [
    ...positionedFriends,
    ...positionedConnections,
    ...laidOutAccounts,
    ...laidOutFeeds,
  ];

  const overlapIterations =
    quality === "fast"
      ? {
          friends: 2,
          connections: 2,
          accounts: 1,
          feeds: 0,
        }
      : {
          friends: 4,
          connections: 5,
          accounts: 2,
          feeds: 1,
        };

  nudgeOverlapsBucketed(positionedFriends, overlapIterations.friends);
  nudgeOverlapsBucketed(positionedConnections, overlapIterations.connections);
  nudgeOverlapsBucketed(laidOutAccounts, overlapIterations.accounts);
  nudgeOverlapsBucketed(laidOutFeeds, overlapIterations.feeds);

  return {
    nodes,
    edges: model.edges,
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
