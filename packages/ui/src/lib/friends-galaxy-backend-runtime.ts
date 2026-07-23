export interface FriendsGalaxyManagedBackend<BackendId extends string> {
  readonly id: BackendId;
  takeFatalError?(): string | null;
  dispose(): void;
}

export interface FriendsGalaxyBackendActivation<
  BackendId extends string,
  Backend extends FriendsGalaxyManagedBackend<BackendId>,
  Surface,
> {
  id: BackendId;
  backend: Backend;
  surface: Surface;
  fallbackReason: string | null;
  recovery: boolean;
  retained: boolean;
  generation: number;
}

export interface FriendsGalaxyBackendLoading<BackendId extends string> {
  id: BackendId;
  recovery: boolean;
  reason: string | null;
  generation: number;
}

export interface FriendsGalaxyBackendRecovery<BackendId extends string> {
  failedId: BackendId;
  compatibilityId: BackendId;
  reason: string;
  generation: number;
}

export interface FriendsGalaxyBackendFailure<BackendId extends string> {
  id: BackendId;
  reason: string;
  phase: "activation" | "runtime";
  generation: number;
}

export interface FriendsGalaxyBackendRuntimeOptions<
  BackendId extends string,
  Backend extends FriendsGalaxyManagedBackend<BackendId>,
  Surface,
> {
  compatibilityId: BackendId;
  createSurface(id: BackendId): Surface;
  mountSurface(surface: Surface, id: BackendId): void;
  showSurface(surface: Surface, id: BackendId): void;
  removeSurface(surface: Surface): void;
  createBackend(id: BackendId): Promise<Backend>;
  initializeBackend(backend: Backend, surface: Surface, id: BackendId): Promise<void>;
  fallbackReason(backend: Backend): string | null;
  backendLabel?(backend: Backend): string;
  onLoading?(loading: FriendsGalaxyBackendLoading<BackendId>): void;
  onActivated?(activation: FriendsGalaxyBackendActivation<BackendId, Backend, Surface>): void;
  onRecovering?(recovery: FriendsGalaxyBackendRecovery<BackendId>): void;
  onFailure?(failure: FriendsGalaxyBackendFailure<BackendId>): void;
  onDisposed?(): void;
}

interface ActiveBackend<
  BackendId extends string,
  Backend extends FriendsGalaxyManagedBackend<BackendId>,
  Surface,
> {
  id: BackendId;
  backend: Backend;
  surface: Surface;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class FriendsGalaxyBackendRuntime<
  BackendId extends string,
  Backend extends FriendsGalaxyManagedBackend<BackendId>,
  Surface extends object,
> {
  private readonly options: FriendsGalaxyBackendRuntimeOptions<BackendId, Backend, Surface>;
  private active: ActiveBackend<BackendId, Backend, Surface> | null = null;
  private currentGeneration = 0;
  private pendingRecovery = false;
  private terminal = false;
  private disposed = false;
  private lastReason: string | null = null;
  private readonly disposedBackends = new WeakSet<object>();
  private readonly removedSurfaces = new WeakSet<object>();
  private readonly pendingSurfaces = new Set<Surface>();

  constructor(options: FriendsGalaxyBackendRuntimeOptions<BackendId, Backend, Surface>) {
    this.options = options;
  }

  get activeBackend(): Backend | null {
    return this.active?.backend ?? null;
  }

  get activeSurface(): Surface | null {
    return this.active?.surface ?? null;
  }

  get activeId(): BackendId | null {
    return this.active?.id ?? null;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  get recoveryPending(): boolean {
    return this.pendingRecovery;
  }

  get terminalFailure(): boolean {
    return this.terminal;
  }

  get recoveryReason(): string | null {
    return this.lastReason;
  }

  activate(
    id: BackendId,
  ): Promise<FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null> {
    if (this.disposed) {
      throw new Error("A disposed Friends Galaxy backend runtime cannot activate a renderer.");
    }
    this.removePendingSurfaces();
    const generation = ++this.currentGeneration;
    this.pendingRecovery = false;
    this.terminal = false;
    this.lastReason = null;
    return this.attemptActivation(id, null, false, generation);
  }

  recoverFromFatalError(
    backend: Backend,
    reason: string,
  ): Promise<FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null> | null {
    if (
      this.disposed || this.pendingRecovery || this.terminal ||
      backend !== this.active?.backend
    ) {
      return null;
    }
    const normalizedReason = reason.trim() ||
      `${this.options.backendLabel?.(backend) ?? backend.id} stopped responding.`;
    this.lastReason = normalizedReason;
    this.removePendingSurfaces();
    const generation = ++this.currentGeneration;
    if (backend.id === this.options.compatibilityId) {
      this.terminal = true;
      this.options.onFailure?.({
        id: backend.id,
        reason: normalizedReason,
        phase: "runtime",
        generation,
      });
      return null;
    }

    this.pendingRecovery = true;
    this.options.onRecovering?.({
      failedId: backend.id,
      compatibilityId: this.options.compatibilityId,
      reason: normalizedReason,
      generation,
    });
    return this.attemptActivation(
      this.options.compatibilityId,
      normalizedReason,
      true,
      generation,
    ).finally(() => {
      if (generation === this.currentGeneration) this.pendingRecovery = false;
    });
  }

  pollHealth(): Promise<FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null> | null {
    const backend = this.active?.backend;
    if (!backend || !backend.takeFatalError) return null;
    let fatalError: string | null;
    try {
      fatalError = backend.takeFatalError();
    } catch (error) {
      fatalError = errorMessage(error);
    }
    return fatalError ? this.recoverFromFatalError(backend, fatalError) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.currentGeneration += 1;
    this.pendingRecovery = false;
    this.terminal = false;
    const active = this.active;
    this.active = null;
    this.removePendingSurfaces();
    if (active) {
      this.disposeBackend(active.backend);
      this.removeSurface(active.surface);
    }
    this.options.onDisposed?.();
  }

  private async attemptActivation(
    id: BackendId,
    inheritedFallbackReason: string | null,
    recovery: boolean,
    generation: number,
  ): Promise<FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null> {
    if (!this.isCurrent(generation)) return null;
    this.options.onLoading?.({
      id,
      recovery,
      reason: inheritedFallbackReason,
      generation,
    });

    let surface: Surface | null = null;
    let backend: Backend | null = null;
    try {
      surface = this.options.createSurface(id);
      this.options.mountSurface(surface, id);
      this.pendingSurfaces.add(surface);
      backend = await this.options.createBackend(id);
      if (backend.id !== id) {
        throw new Error(
          `Friends Galaxy requested backend ${id}, but the factory returned ${backend.id}.`,
        );
      }
      await this.options.initializeBackend(backend, surface, id);
    } catch (error) {
      if (backend) this.disposeBackend(backend);
      if (surface) {
        this.pendingSurfaces.delete(surface);
        this.removeSurface(surface);
      }
      if (!this.isCurrent(generation)) return null;
      return this.handleActivationFailure(id, errorMessage(error), generation);
    }

    if (!this.isCurrent(generation)) {
      this.disposeBackend(backend);
      this.pendingSurfaces.delete(surface);
      this.removeSurface(surface);
      return null;
    }

    let fallbackReason: string | null;
    try {
      fallbackReason = inheritedFallbackReason ?? this.options.fallbackReason(backend);
      this.options.showSurface(surface, id);
    } catch (error) {
      this.disposeBackend(backend);
      this.pendingSurfaces.delete(surface);
      this.removeSurface(surface);
      if (!this.isCurrent(generation)) return null;
      return this.handleActivationFailure(id, errorMessage(error), generation);
    }
    const activation: FriendsGalaxyBackendActivation<BackendId, Backend, Surface> = {
      id,
      backend,
      surface,
      fallbackReason,
      recovery,
      retained: false,
      generation,
    };
    this.pendingSurfaces.delete(surface);
    const previous = this.active;
    this.active = { id, backend, surface };
    this.lastReason = fallbackReason;
    this.pendingRecovery = false;
    this.terminal = false;
    if (previous) {
      this.disposeBackend(previous.backend);
      this.removeSurface(previous.surface);
    }
    this.options.onActivated?.(activation);
    return activation;
  }

  private async handleActivationFailure(
    id: BackendId,
    reason: string,
    generation: number,
  ): Promise<FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null> {
    this.lastReason = reason;
    if (id !== this.options.compatibilityId) {
      this.pendingRecovery = true;
      this.options.onRecovering?.({
        failedId: id,
        compatibilityId: this.options.compatibilityId,
        reason,
        generation,
      });
      const retained = this.retainActiveCompatibility(reason, generation);
      if (retained) return retained;
      return this.attemptActivation(
        this.options.compatibilityId,
        reason,
        true,
        generation,
      );
    }

    this.pendingRecovery = false;
    this.terminal = true;
    this.options.onFailure?.({ id, reason, phase: "activation", generation });
    return null;
  }

  private retainActiveCompatibility(
    reason: string,
    generation: number,
  ): FriendsGalaxyBackendActivation<BackendId, Backend, Surface> | null {
    const active = this.active;
    if (!active || active.id !== this.options.compatibilityId) return null;
    this.pendingRecovery = false;
    this.terminal = false;
    this.lastReason = reason;
    const activation: FriendsGalaxyBackendActivation<BackendId, Backend, Surface> = {
      ...active,
      fallbackReason: reason,
      recovery: true,
      retained: true,
      generation,
    };
    this.options.onActivated?.(activation);
    return activation;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.currentGeneration;
  }

  private disposeBackend(backend: Backend): void {
    if (this.disposedBackends.has(backend)) return;
    this.disposedBackends.add(backend);
    backend.dispose();
  }

  private removePendingSurfaces(): void {
    for (const surface of this.pendingSurfaces) this.removeSurface(surface);
    this.pendingSurfaces.clear();
  }

  private removeSurface(surface: Surface): void {
    if (this.removedSurfaces.has(surface)) return;
    this.removedSurfaces.add(surface);
    this.options.removeSurface(surface);
  }
}
