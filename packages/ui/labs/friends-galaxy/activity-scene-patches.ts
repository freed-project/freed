import type {
  GalaxyActivitySourceKey,
  GalaxyActivitySummary,
  GalaxyActivitySummaryPatch,
} from "./activity-summary-index.js";

export const GalaxyActivitySceneFlag = {
  HasLocation: 1 << 0,
  HasAvatar: 1 << 1,
  Removed: 1 << 2,
} as const;

export interface GalaxyActivitySceneBinding extends GalaxyActivitySourceKey {
  nodeIndex: number;
}

export interface GalaxyActivityScenePatchBatch {
  revision: number;
  nodeIndices: Uint32Array;
  itemCounts: Uint32Array;
  latestActivityAt: Float64Array;
  flags: Uint8Array;
  avatarUrls: Array<string | null>;
  unknownSources: GalaxyActivitySourceKey[];
}

interface EncodedPatch {
  nodeIndex: number;
  summary: GalaxyActivitySummary | null;
}

function sourceToken(source: GalaxyActivitySourceKey): string {
  return `${source.namespace}\u0000${source.key}`;
}

function compareSource(left: GalaxyActivitySourceKey, right: GalaxyActivitySourceKey): number {
  return left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key);
}

export class GalaxyActivityScenePatchEncoder {
  private readonly nodeIndicesBySource = new Map<string, number[]>();

  constructor(bindings: Iterable<GalaxyActivitySceneBinding>) {
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
    patches: Iterable<GalaxyActivitySummaryPatch>,
    revision: number,
  ): GalaxyActivityScenePatchBatch {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("A Friends Galaxy activity scene patch requires a non-negative revision.");
    }
    const encodedByNodeIndex = new Map<number, EncodedPatch>();
    const unknownBySource = new Map<string, GalaxyActivitySourceKey>();
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
    const flags = new Uint8Array(encoded.length);
    const avatarUrls = new Array<string | null>(encoded.length);

    encoded.forEach(({ nodeIndex, summary }, index) => {
      nodeIndices[index] = nodeIndex;
      if (!summary) {
        flags[index] = GalaxyActivitySceneFlag.Removed;
        avatarUrls[index] = null;
        return;
      }
      itemCounts[index] = Math.min(0xffff_ffff, Math.max(0, summary.itemCount));
      latestActivityAt[index] = Math.max(0, summary.latestActivityAt);
      flags[index] = (summary.hasLocation ? GalaxyActivitySceneFlag.HasLocation : 0) |
        (summary.avatarUrlCandidates.length > 0 ? GalaxyActivitySceneFlag.HasAvatar : 0);
      avatarUrls[index] = summary.avatarUrlCandidates[0] ?? null;
    });

    return {
      revision,
      nodeIndices,
      itemCounts,
      latestActivityAt,
      flags,
      avatarUrls,
      unknownSources: [...unknownBySource.values()].sort(compareSource),
    };
  }
}
