export interface FriendsGalaxyAvatarImageRequest {
  nodeId: string;
  sourceKey: string;
}

export interface FriendsGalaxyAvatarImageAdmissionResult {
  images: ReadonlyMap<string, CanvasImageSource>;
  requestedNodeCount: number;
  readyNodeCount: number;
  failedSourceCount: number;
  cachedSourceCount: number;
}

export type FriendsGalaxyAvatarImageDecoder = (
  sourceKey: string,
) => Promise<CanvasImageSource>;

interface CachedImage {
  image: CanvasImageSource;
  lastUsed: number;
}

interface DecodeTask {
  sourceKey: string;
  resolve: (image: CanvasImageSource | null) => void;
}

function closeImage(image: CanvasImageSource): void {
  const close = (image as CanvasImageSource & { close?: () => void }).close;
  if (typeof close !== "function") return;
  try {
    close.call(image);
  } catch {
    // An already closed ImageBitmap does not need another cleanup attempt.
  }
}

export class FriendsGalaxyAvatarImageAdmission {
  private readonly cache = new Map<string, CachedImage>();
  private readonly failedSources = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<CanvasImageSource | null>>();
  private readonly queue: DecodeTask[] = [];
  private activeDecodeCount = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly decoder: FriendsGalaxyAvatarImageDecoder,
    private readonly maxEntries: number,
    private readonly maxConcurrent: number,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Friends Galaxy avatar admission requires a positive cache capacity.");
    }
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error("Friends Galaxy avatar admission requires positive decode concurrency.");
    }
  }

  async admit(
    requests: readonly FriendsGalaxyAvatarImageRequest[],
  ): Promise<FriendsGalaxyAvatarImageAdmissionResult> {
    if (this.disposed) return this.emptyResult();
    const requestByNodeId = new Map<string, FriendsGalaxyAvatarImageRequest>();
    for (const request of requests) {
      if (!request.nodeId || !request.sourceKey || requestByNodeId.has(request.nodeId)) continue;
      requestByNodeId.set(request.nodeId, request);
      if (requestByNodeId.size >= this.maxEntries) break;
    }
    const admittedRequests = [...requestByNodeId.values()];
    const sourceKeys = [...new Set(admittedRequests.map((request) => request.sourceKey))];
    await Promise.all(sourceKeys.map((sourceKey) => this.load(sourceKey)));
    if (this.disposed) return this.emptyResult();

    const retainedSources = new Set(sourceKeys);
    this.evictToCapacity(retainedSources);
    const images = new Map<string, CanvasImageSource>();
    for (const request of admittedRequests) {
      const cached = this.cache.get(request.sourceKey);
      if (!cached) continue;
      cached.lastUsed = ++this.clock;
      images.set(request.nodeId, cached.image);
    }
    return {
      images,
      requestedNodeCount: admittedRequests.length,
      readyNodeCount: images.size,
      failedSourceCount: sourceKeys.filter((sourceKey) => this.failedSources.has(sourceKey)).length,
      cachedSourceCount: this.cache.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.queue.splice(0)) {
      this.inFlight.delete(task.sourceKey);
      task.resolve(null);
    }
    for (const { image } of this.cache.values()) closeImage(image);
    this.cache.clear();
    this.failedSources.clear();
  }

  private emptyResult(): FriendsGalaxyAvatarImageAdmissionResult {
    return {
      images: new Map(),
      requestedNodeCount: 0,
      readyNodeCount: 0,
      failedSourceCount: 0,
      cachedSourceCount: 0,
    };
  }

  private load(sourceKey: string): Promise<CanvasImageSource | null> {
    const cached = this.cache.get(sourceKey);
    if (cached) {
      cached.lastUsed = ++this.clock;
      return Promise.resolve(cached.image);
    }
    const failedAt = this.failedSources.get(sourceKey);
    if (failedAt !== undefined) {
      this.failedSources.set(sourceKey, ++this.clock);
      return Promise.resolve(null);
    }
    const active = this.inFlight.get(sourceKey);
    if (active) return active;
    const pending = new Promise<CanvasImageSource | null>((resolve) => {
      this.queue.push({ sourceKey, resolve });
    });
    this.inFlight.set(sourceKey, pending);
    this.pump();
    return pending;
  }

  private pump(): void {
    while (!this.disposed && this.activeDecodeCount < this.maxConcurrent) {
      const task = this.queue.shift();
      if (!task) return;
      this.activeDecodeCount += 1;
      void this.decode(task);
    }
  }

  private async decode(task: DecodeTask): Promise<void> {
    let result: CanvasImageSource | null = null;
    try {
      const image = await this.decoder(task.sourceKey);
      if (this.disposed) {
        closeImage(image);
      } else {
        this.cache.set(task.sourceKey, { image, lastUsed: ++this.clock });
        this.evictToCapacity(new Set());
        result = image;
      }
    } catch {
      if (!this.disposed) this.rememberFailure(task.sourceKey);
    } finally {
      this.activeDecodeCount -= 1;
      this.inFlight.delete(task.sourceKey);
      task.resolve(result);
      this.pump();
    }
  }

  private rememberFailure(sourceKey: string): void {
    this.failedSources.set(sourceKey, ++this.clock);
    const failureCapacity = this.maxEntries * 4;
    if (this.failedSources.size <= failureCapacity) return;
    let oldestSource = "";
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [candidate, lastUsed] of this.failedSources) {
      if (lastUsed >= oldestUse) continue;
      oldestSource = candidate;
      oldestUse = lastUsed;
    }
    if (oldestSource) this.failedSources.delete(oldestSource);
  }

  private evictToCapacity(retainedSources: ReadonlySet<string>): void {
    while (this.cache.size > this.maxEntries) {
      let oldestSource = "";
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [sourceKey, cached] of this.cache) {
        if (retainedSources.has(sourceKey) || cached.lastUsed >= oldestUse) continue;
        oldestSource = sourceKey;
        oldestUse = cached.lastUsed;
      }
      if (!oldestSource) {
        for (const [sourceKey, cached] of this.cache) {
          if (cached.lastUsed >= oldestUse) continue;
          oldestSource = sourceKey;
          oldestUse = cached.lastUsed;
        }
      }
      if (!oldestSource) return;
      const evicted = this.cache.get(oldestSource);
      if (evicted) closeImage(evicted.image);
      this.cache.delete(oldestSource);
    }
  }
}
