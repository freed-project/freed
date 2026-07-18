export type GalaxyActivityNamespace = "social" | "rss";

export interface GalaxyActivitySourceKey {
  namespace: GalaxyActivityNamespace;
  key: string;
}

export interface GalaxyActivityContribution extends GalaxyActivitySourceKey {
  globalId: string;
  publishedAt: number;
  hasLocation: boolean;
  avatarUrl: string | null;
}

export interface GalaxyActivityDelta {
  previous: GalaxyActivityContribution | null;
  next: GalaxyActivityContribution | null;
}

export interface GalaxyActivitySummary {
  itemCount: number;
  latestActivityAt: number;
  sampleItemIds: string[];
  hasLocation: boolean;
  avatarUrlCandidates: string[];
}

export interface GalaxyActivitySummarySnapshot {
  social: Record<string, GalaxyActivitySummary>;
  rss: Record<string, GalaxyActivitySummary>;
  itemCount: number;
  revision: number;
}

export interface GalaxyActivitySummaryPatch extends GalaxyActivitySourceKey {
  summary: GalaxyActivitySummary | null;
}

export interface GalaxyActivityPatchResult {
  patches: GalaxyActivitySummaryPatch[];
  changedItemCount: number;
  rebuiltSourceCount: number;
  rebuildContributionCount: number;
  itemCount: number;
  revision: number;
}

export type GalaxyActivityRebuildResolver = (
  invalidatedSources: readonly GalaxyActivitySourceKey[],
) => Iterable<GalaxyActivityContribution>;

interface RankedCandidate {
  globalId: string;
  publishedAt: number;
}

interface AvatarCandidate extends RankedCandidate {
  avatarUrl: string;
}

interface ActivityBucket {
  itemCount: number;
  locationItemCount: number;
  samples: RankedCandidate[];
  avatars: AvatarCandidate[];
}

const MAX_SAMPLE_ITEM_IDS = 3;
const MAX_AVATAR_URL_CANDIDATES = 3;

function compareRankedCandidate(left: RankedCandidate, right: RankedCandidate): number {
  return right.publishedAt - left.publishedAt || left.globalId.localeCompare(right.globalId);
}

function cloneSummary(summary: GalaxyActivitySummary): GalaxyActivitySummary {
  return {
    ...summary,
    sampleItemIds: [...summary.sampleItemIds],
    avatarUrlCandidates: [...summary.avatarUrlCandidates],
  };
}

function contributionEqual(
  left: GalaxyActivityContribution,
  right: GalaxyActivityContribution,
): boolean {
  return left.globalId === right.globalId &&
    left.namespace === right.namespace &&
    left.key === right.key &&
    left.publishedAt === right.publishedAt &&
    left.hasLocation === right.hasLocation &&
    left.avatarUrl === right.avatarUrl;
}

function emptyBucket(): ActivityBucket {
  return {
    itemCount: 0,
    locationItemCount: 0,
    samples: [],
    avatars: [],
  };
}

function insertRankedCandidate<T extends RankedCandidate>(
  candidates: T[],
  candidate: T,
  cap: number,
): void {
  const insertionIndex = candidates.findIndex(
    (existing) => compareRankedCandidate(candidate, existing) < 0,
  );
  if (insertionIndex < 0) {
    if (candidates.length < cap) candidates.push(candidate);
    return;
  }
  candidates.splice(insertionIndex, 0, candidate);
  if (candidates.length > cap) candidates.length = cap;
}

function addContributionToBucket(
  bucket: ActivityBucket,
  contribution: GalaxyActivityContribution,
): void {
  bucket.itemCount += 1;
  if (contribution.hasLocation) bucket.locationItemCount += 1;
  insertRankedCandidate(bucket.samples, contribution, MAX_SAMPLE_ITEM_IDS);

  if (!contribution.avatarUrl) return;
  const existingIndex = bucket.avatars.findIndex(
    (candidate) => candidate.avatarUrl === contribution.avatarUrl,
  );
  const candidate: AvatarCandidate = {
    globalId: contribution.globalId,
    publishedAt: contribution.publishedAt,
    avatarUrl: contribution.avatarUrl,
  };
  if (existingIndex >= 0) {
    const existing = bucket.avatars[existingIndex]!;
    if (compareRankedCandidate(candidate, existing) >= 0) return;
    bucket.avatars.splice(existingIndex, 1);
  }
  insertRankedCandidate(bucket.avatars, candidate, MAX_AVATAR_URL_CANDIDATES);
}

function bucketSummary(bucket: ActivityBucket): GalaxyActivitySummary {
  return {
    itemCount: bucket.itemCount,
    latestActivityAt: bucket.samples[0]?.publishedAt ?? 0,
    sampleItemIds: bucket.samples.map((sample) => sample.globalId),
    hasLocation: bucket.locationItemCount > 0,
    avatarUrlCandidates: bucket.avatars.map((candidate) => candidate.avatarUrl),
  };
}

function sourceToken(source: GalaxyActivitySourceKey): string {
  return `${source.namespace}\u0000${source.key}`;
}

export class GalaxyActivitySummaryIndex {
  private readonly socialBuckets = new Map<string, ActivityBucket>();
  private readonly rssBuckets = new Map<string, ActivityBucket>();
  private totalItemCount = 0;
  private currentRevision = 0;

  constructor(contributions: Iterable<GalaxyActivityContribution> = []) {
    for (const contribution of contributions) this.addContribution(contribution);
  }

  get itemCount(): number {
    return this.totalItemCount;
  }

  get revision(): number {
    return this.currentRevision;
  }

  snapshot(): GalaxyActivitySummarySnapshot {
    return {
      social: this.snapshotNamespace(this.socialBuckets),
      rss: this.snapshotNamespace(this.rssBuckets),
      itemCount: this.totalItemCount,
      revision: this.currentRevision,
    };
  }

  applyDeltas(
    deltas: Iterable<GalaxyActivityDelta>,
    rebuildInvalidated: GalaxyActivityRebuildResolver,
  ): GalaxyActivityPatchResult {
    const touched = new Map<string, GalaxyActivitySourceKey>();
    const invalidated = new Map<string, GalaxyActivitySourceKey>();
    const changedIds = new Set<string>();

    for (const delta of deltas) {
      const { previous, next } = delta;
      if (!previous && !next) continue;
      if (previous && next && previous.globalId !== next.globalId) {
        throw new Error("A Friends Galaxy activity delta cannot replace a different item id.");
      }
      const globalId = previous?.globalId ?? next!.globalId;
      if (changedIds.has(globalId)) {
        throw new Error(`Duplicate Friends Galaxy activity delta for ${globalId}.`);
      }
      if (previous && next && contributionEqual(previous, next)) continue;
      changedIds.add(globalId);

      if (previous) {
        const source = { namespace: previous.namespace, key: previous.key };
        touched.set(sourceToken(source), source);
        if (this.removeContribution(previous)) invalidated.set(sourceToken(source), source);
      }
      if (next) {
        const source = { namespace: next.namespace, key: next.key };
        touched.set(sourceToken(source), source);
        this.addContribution(next);
      }
    }

    if (changedIds.size === 0) {
      return {
        patches: [],
        changedItemCount: 0,
        rebuiltSourceCount: 0,
        rebuildContributionCount: 0,
        itemCount: this.totalItemCount,
        revision: this.currentRevision,
      };
    }

    const sourcesToRebuild = [...invalidated.values()].filter(({ namespace, key }) =>
      Boolean(this.bucketsFor(namespace).get(key)?.itemCount),
    );
    let rebuildContributionCount = 0;
    if (sourcesToRebuild.length > 0) {
      const rebuiltBuckets = new Map<string, ActivityBucket>();
      for (const source of sourcesToRebuild) rebuiltBuckets.set(sourceToken(source), emptyBucket());
      for (const contribution of rebuildInvalidated(sourcesToRebuild)) {
        const bucket = rebuiltBuckets.get(sourceToken(contribution));
        if (!bucket) continue;
        addContributionToBucket(bucket, contribution);
        rebuildContributionCount += 1;
      }
      for (const source of sourcesToRebuild) {
        const token = sourceToken(source);
        const previousBucket = this.bucketsFor(source.namespace).get(source.key);
        const rebuiltBucket = rebuiltBuckets.get(token)!;
        if (!previousBucket || previousBucket.itemCount !== rebuiltBucket.itemCount) {
          throw new Error(`Friends Galaxy activity rebuild mismatch for ${source.key}.`);
        }
        this.bucketsFor(source.namespace).set(source.key, rebuiltBucket);
      }
    }

    this.currentRevision += 1;
    const patches = [...touched.values()]
      .sort((left, right) => left.namespace.localeCompare(right.namespace) ||
        left.key.localeCompare(right.key))
      .map(({ namespace, key }): GalaxyActivitySummaryPatch => {
        const bucket = this.bucketsFor(namespace).get(key);
        return {
          namespace,
          key,
          summary: bucket ? cloneSummary(bucketSummary(bucket)) : null,
        };
      });

    return {
      patches,
      changedItemCount: changedIds.size,
      rebuiltSourceCount: sourcesToRebuild.length,
      rebuildContributionCount,
      itemCount: this.totalItemCount,
      revision: this.currentRevision,
    };
  }

  private bucketsFor(namespace: GalaxyActivityNamespace): Map<string, ActivityBucket> {
    return namespace === "social" ? this.socialBuckets : this.rssBuckets;
  }

  private addContribution(contribution: GalaxyActivityContribution): void {
    const buckets = this.bucketsFor(contribution.namespace);
    let bucket = buckets.get(contribution.key);
    if (!bucket) {
      bucket = emptyBucket();
      buckets.set(contribution.key, bucket);
    }
    addContributionToBucket(bucket, contribution);
    this.totalItemCount += 1;
  }

  private removeContribution(contribution: GalaxyActivityContribution): boolean {
    const buckets = this.bucketsFor(contribution.namespace);
    const bucket = buckets.get(contribution.key);
    if (!bucket || bucket.itemCount <= 0) {
      throw new Error(`Missing Friends Galaxy activity contribution for ${contribution.globalId}.`);
    }

    const invalidatesCandidates = bucket.samples.some(
      (candidate) => candidate.globalId === contribution.globalId,
    ) || bucket.avatars.some((candidate) => candidate.globalId === contribution.globalId);
    bucket.itemCount -= 1;
    if (contribution.hasLocation) bucket.locationItemCount -= 1;
    this.totalItemCount -= 1;
    if (bucket.itemCount === 0) buckets.delete(contribution.key);
    return invalidatesCandidates;
  }

  private snapshotNamespace(
    buckets: ReadonlyMap<string, ActivityBucket>,
  ): Record<string, GalaxyActivitySummary> {
    const snapshot: Record<string, GalaxyActivitySummary> = {};
    for (const [key, bucket] of buckets) snapshot[key] = cloneSummary(bucketSummary(bucket));
    return snapshot;
  }
}
