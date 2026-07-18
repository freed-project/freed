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
