import type {
  FriendsGalaxyActivitySourceKey,
  FriendsGalaxyActivitySummary,
  FriendsGalaxyActivitySummaryPatch,
} from "./friends-galaxy-activity-index.js";

export const FriendsGalaxyActivitySceneFlag = {
  HasLocation: 1 << 0,
  HasAvatar: 1 << 1,
  Removed: 1 << 2,
} as const;

export interface FriendsGalaxyActivitySceneBinding extends FriendsGalaxyActivitySourceKey {
  nodeIndex: number;
}

export interface FriendsGalaxyActivityScenePatchBatch {
  revision: number;
  nodeIndices: Uint32Array;
  itemCounts: Uint32Array;
  latestActivityAt: Float64Array;
  sizeScales: Float32Array;
  brightnessScales: Float32Array;
  flags: Uint8Array;
  avatarUrls: Array<string | null>;
  unknownSources: FriendsGalaxyActivitySourceKey[];
}

export const FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP = 4_096;
const FRIENDS_GALAXY_ACTIVITY_SCENE_BUFFER_COUNT = 6;

const ACTIVITY_SCENE_FLAG_MASK =
  FriendsGalaxyActivitySceneFlag.HasLocation |
  FriendsGalaxyActivitySceneFlag.HasAvatar |
  FriendsGalaxyActivitySceneFlag.Removed;

export function friendsGalaxyActivityScenePatchTransferables(
  batch: FriendsGalaxyActivityScenePatchBatch,
): ArrayBuffer[] {
  const buffers = [
    batch.nodeIndices.buffer,
    batch.itemCounts.buffer,
    batch.latestActivityAt.buffer,
    batch.sizeScales.buffer,
    batch.brightnessScales.buffer,
    batch.flags.buffer,
  ];
  const transferables = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) transferables.add(buffer);
  }
  return [...transferables];
}

function boundedPatchText(label: string, value: unknown, maximum: number): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > maximum
  ) {
    throw new Error(`Friends Galaxy activity patches contain an invalid ${label}.`);
  }
}

export function validateFriendsGalaxyActivityScenePatchBatch(
  batch: FriendsGalaxyActivityScenePatchBatch,
  semanticNodeCount: number,
  expectedRevision: number,
): void {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    batch.revision !== expectedRevision
  ) {
    throw new Error("Friends Galaxy activity patches have an invalid revision.");
  }
  if (!Number.isSafeInteger(semanticNodeCount) || semanticNodeCount < 0) {
    throw new Error("Friends Galaxy activity patches require a valid semantic count.");
  }
  if (
    !(batch.nodeIndices instanceof Uint32Array) ||
    !(batch.itemCounts instanceof Uint32Array) ||
    !(batch.latestActivityAt instanceof Float64Array) ||
    !(batch.sizeScales instanceof Float32Array) ||
    !(batch.brightnessScales instanceof Float32Array) ||
    !(batch.flags instanceof Uint8Array) ||
    !Array.isArray(batch.avatarUrls) ||
    !Array.isArray(batch.unknownSources)
  ) {
    throw new Error("Friends Galaxy activity patches have invalid buffer types.");
  }
  const length = batch.nodeIndices.length;
  if (
    length > semanticNodeCount ||
    batch.itemCounts.length !== length ||
    batch.latestActivityAt.length !== length ||
    batch.sizeScales.length !== length ||
    batch.brightnessScales.length !== length ||
    batch.flags.length !== length ||
    batch.avatarUrls.length !== length ||
    batch.unknownSources.length > FRIENDS_GALAXY_ACTIVITY_SOURCE_PATCH_CAP ||
    friendsGalaxyActivityScenePatchTransferables(batch).length !==
      FRIENDS_GALAXY_ACTIVITY_SCENE_BUFFER_COUNT
  ) {
    throw new Error("Friends Galaxy activity patches have inconsistent lengths.");
  }
  let previousNodeIndex = -1;
  for (let index = 0; index < length; index += 1) {
    const nodeIndex = batch.nodeIndices[index]!;
    if (nodeIndex >= semanticNodeCount || nodeIndex <= previousNodeIndex) {
      throw new Error("Friends Galaxy activity patches have invalid node ordering.");
    }
    previousNodeIndex = nodeIndex;
    if (
      !Number.isFinite(batch.latestActivityAt[index]) ||
      batch.latestActivityAt[index]! < 0 ||
      !Number.isFinite(batch.sizeScales[index]) ||
      batch.sizeScales[index]! < 0 ||
      !Number.isFinite(batch.brightnessScales[index]) ||
      batch.brightnessScales[index]! < 0 ||
      (batch.flags[index]! & ~ACTIVITY_SCENE_FLAG_MASK) !== 0
    ) {
      throw new Error("Friends Galaxy activity patches contain invalid node values.");
    }
    const avatarUrl = batch.avatarUrls[index];
    if (avatarUrl !== null) boundedPatchText("avatar URL", avatarUrl, 2_048);
  }
  const unknownTokens = new Set<string>();
  for (const source of batch.unknownSources) {
    if (source.namespace !== "social" && source.namespace !== "rss") {
      throw new Error("Friends Galaxy activity patches contain an invalid namespace.");
    }
    boundedPatchText("source key", source.key, 2_048);
    const token = `${source.namespace}\u0000${source.key}`;
    if (unknownTokens.has(token)) {
      throw new Error("Friends Galaxy activity patches contain duplicate unknown sources.");
    }
    unknownTokens.add(token);
  }
}

interface FriendsGalaxyActivityNodeState {
  itemCount: number;
  latestActivityAt: number;
  sizeScale: number;
  brightnessScale: number;
  flags: number;
  avatarUrl: string | null;
}

export class FriendsGalaxyActivityPatchJournal {
  private readonly stateByNodeIndex = new Map<
    number,
    FriendsGalaxyActivityNodeState
  >();
  private revision = -1;

  constructor(private readonly semanticNodeCount: number) {
    if (!Number.isSafeInteger(semanticNodeCount) || semanticNodeCount < 0) {
      throw new Error("Friends Galaxy activity journal requires a valid semantic count.");
    }
  }

  get nodeCount(): number {
    return this.stateByNodeIndex.size;
  }

  get latestRevision(): number | null {
    return this.revision < 0 ? null : this.revision;
  }

  record(batch: FriendsGalaxyActivityScenePatchBatch): void {
    if (batch.revision <= this.revision) {
      throw new Error("Friends Galaxy activity journal requires increasing revisions.");
    }
    validateFriendsGalaxyActivityScenePatchBatch(
      batch,
      this.semanticNodeCount,
      batch.revision,
    );
    for (let index = 0; index < batch.nodeIndices.length; index += 1) {
      this.stateByNodeIndex.set(batch.nodeIndices[index]!, {
        itemCount: batch.itemCounts[index]!,
        latestActivityAt: batch.latestActivityAt[index]!,
        sizeScale: batch.sizeScales[index]!,
        brightnessScale: batch.brightnessScales[index]!,
        flags: batch.flags[index]!,
        avatarUrl: batch.avatarUrls[index]!,
      });
    }
    this.revision = batch.revision;
  }

  snapshot(): FriendsGalaxyActivityScenePatchBatch | null {
    if (this.revision < 0) return null;
    const entries = [...this.stateByNodeIndex.entries()].sort(
      ([left], [right]) => left - right,
    );
    const nodeIndices = new Uint32Array(entries.length);
    const itemCounts = new Uint32Array(entries.length);
    const latestActivityAt = new Float64Array(entries.length);
    const sizeScales = new Float32Array(entries.length);
    const brightnessScales = new Float32Array(entries.length);
    const flags = new Uint8Array(entries.length);
    const avatarUrls = new Array<string | null>(entries.length);
    entries.forEach(([nodeIndex, state], index) => {
      nodeIndices[index] = nodeIndex;
      itemCounts[index] = state.itemCount;
      latestActivityAt[index] = state.latestActivityAt;
      sizeScales[index] = state.sizeScale;
      brightnessScales[index] = state.brightnessScale;
      flags[index] = state.flags;
      avatarUrls[index] = state.avatarUrl;
    });
    return {
      revision: this.revision,
      nodeIndices,
      itemCounts,
      latestActivityAt,
      sizeScales,
      brightnessScales,
      flags,
      avatarUrls,
      unknownSources: [],
    };
  }
}

interface EncodedPatch {
  nodeIndex: number;
  summary: FriendsGalaxyActivitySummary | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function visualScales(
  summary: FriendsGalaxyActivitySummary | null,
  referenceTime: number,
): { size: number; brightness: number } {
  if (!summary) return { size: 0.82, brightness: 0.72 };
  const countSignal = 1 - Math.exp(-Math.max(0, summary.itemCount) / 80);
  const ageDays = Math.max(0, referenceTime - summary.latestActivityAt) / DAY_MS;
  const recencySignal = Math.exp(-ageDays / 21);
  return {
    size: Math.min(1.2, 0.94 + countSignal * 0.14 + recencySignal * 0.1),
    brightness: Math.min(
      1.18,
      0.82 + countSignal * 0.1 + recencySignal * 0.12 + (summary.hasLocation ? 0.02 : 0),
    ),
  };
}

function sourceToken(source: FriendsGalaxyActivitySourceKey): string {
  return `${source.namespace}\u0000${source.key}`;
}

function compareSource(left: FriendsGalaxyActivitySourceKey, right: FriendsGalaxyActivitySourceKey): number {
  return left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key);
}

export class FriendsGalaxyActivityScenePatchEncoder {
  private readonly nodeIndicesBySource = new Map<string, number[]>();

  constructor(bindings: Iterable<FriendsGalaxyActivitySceneBinding>) {
    const sourceByNodeIndex = new Map<number, string>();
    for (const binding of bindings) {
      if (
        !Number.isSafeInteger(binding.nodeIndex) || binding.nodeIndex < 0 ||
        binding.nodeIndex > 0xffff_ffff
      ) {
        throw new Error("A Friends Galaxy activity scene binding requires a 32-bit node index.");
      }
      const token = sourceToken(binding);
      const existingSource = sourceByNodeIndex.get(binding.nodeIndex);
      if (existingSource && existingSource !== token) {
        throw new Error(
          `Friends Galaxy node ${binding.nodeIndex.toLocaleString()} cannot bind to multiple activity sources.`,
        );
      }
      sourceByNodeIndex.set(binding.nodeIndex, token);
      let nodeIndices = this.nodeIndicesBySource.get(token);
      if (!nodeIndices) {
        nodeIndices = [];
        this.nodeIndicesBySource.set(token, nodeIndices);
      }
      if (!nodeIndices.includes(binding.nodeIndex)) nodeIndices.push(binding.nodeIndex);
    }
    for (const nodeIndices of this.nodeIndicesBySource.values()) {
      nodeIndices.sort((left, right) => left - right);
    }
  }

  encode(
    patches: Iterable<FriendsGalaxyActivitySummaryPatch>,
    revision: number,
    referenceTime: number,
  ): FriendsGalaxyActivityScenePatchBatch {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("A Friends Galaxy activity scene patch requires a non-negative revision.");
    }
    if (!Number.isFinite(referenceTime) || referenceTime < 0) {
      throw new Error("A Friends Galaxy activity scene patch requires a valid reference time.");
    }
    const encodedByNodeIndex = new Map<number, EncodedPatch>();
    const unknownBySource = new Map<string, FriendsGalaxyActivitySourceKey>();
    for (const patch of patches) {
      const nodeIndices = this.nodeIndicesBySource.get(sourceToken(patch));
      if (!nodeIndices) {
        unknownBySource.set(sourceToken(patch), {
          namespace: patch.namespace,
          key: patch.key,
        });
        continue;
      }
      for (const nodeIndex of nodeIndices) {
        encodedByNodeIndex.set(nodeIndex, { nodeIndex, summary: patch.summary });
      }
    }

    const encoded = [...encodedByNodeIndex.values()].sort(
      (left, right) => left.nodeIndex - right.nodeIndex,
    );
    const nodeIndices = new Uint32Array(encoded.length);
    const itemCounts = new Uint32Array(encoded.length);
    const latestActivityAt = new Float64Array(encoded.length);
    const sizeScales = new Float32Array(encoded.length);
    const brightnessScales = new Float32Array(encoded.length);
    const flags = new Uint8Array(encoded.length);
    const avatarUrls = new Array<string | null>(encoded.length);

    encoded.forEach(({ nodeIndex, summary }, index) => {
      nodeIndices[index] = nodeIndex;
      const scales = visualScales(summary, referenceTime);
      sizeScales[index] = scales.size;
      brightnessScales[index] = scales.brightness;
      if (!summary) {
        flags[index] = FriendsGalaxyActivitySceneFlag.Removed;
        avatarUrls[index] = null;
        return;
      }
      itemCounts[index] = Math.min(0xffff_ffff, Math.max(0, summary.itemCount));
      latestActivityAt[index] = Math.max(0, summary.latestActivityAt);
      flags[index] = (summary.hasLocation ? FriendsGalaxyActivitySceneFlag.HasLocation : 0) |
        (summary.avatarUrlCandidates.length > 0 ? FriendsGalaxyActivitySceneFlag.HasAvatar : 0);
      avatarUrls[index] = summary.avatarUrlCandidates[0] ?? null;
    });

    return {
      revision,
      nodeIndices,
      itemCounts,
      latestActivityAt,
      sizeScales,
      brightnessScales,
      flags,
      avatarUrls,
      unknownSources: [...unknownBySource.values()].sort(compareSource),
    };
  }
}
