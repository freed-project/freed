export const FRIENDS_GALAXY_LABEL_FADE_DURATION_MS = 240;
const MAX_RETAINED_LABELS = 192;

/** One reversible timeline shared by GPU renderers, with bounded outgoing rows. */
export class FriendsGalaxyLabelFade<T extends { id: string }> {
  private readonly opacity = new Map<string, number>();
  private readonly targets = new Map<string, number>();
  private pool: readonly T[] = [];
  private candidates = new Set<string>();
  private lastTime = Number.NaN;
  private active = false;

  get isActive(): boolean { return this.active; }

  clear(): void {
    this.opacity.clear();
    this.targets.clear();
    this.pool = [];
    this.candidates.clear();
    this.lastTime = Number.NaN;
    this.active = false;
  }

  mergePool(next: readonly T[]): readonly T[] {
    this.candidates = new Set(next.map((label) => label.id));
    const outgoing = this.pool.filter((label) => !this.candidates.has(label.id) &&
      (this.opacity.get(label.id) ?? 0) > 0).slice(0, MAX_RETAINED_LABELS);
    this.pool = [...next, ...outgoing];
    const retained = new Set(this.pool.map((label) => label.id));
    for (const id of this.opacity.keys()) if (!retained.has(id)) {
      this.opacity.delete(id);
      this.targets.delete(id);
    }
    return this.pool;
  }

  eligible<L extends T>(labels: readonly L[]): readonly L[] {
    return labels.filter((label) => this.candidates.has(label.id));
  }

  step<L extends T>(labels: readonly L[], desired: ReadonlySet<string>, timeMs: number, motion: boolean): Array<{ label: L; opacity: number }> {
    const elapsed = Number.isFinite(this.lastTime) ? Math.max(0, timeMs - this.lastTime) : 0;
    this.lastTime = timeMs;
    this.active = false;
    const result: Array<{ label: L; opacity: number }> = [];
    for (const label of labels) {
      const target = desired.has(label.id) ? 1 : 0;
      const previous = this.opacity.get(label.id) ?? 0;
      // A new target starts now, never inherits time spent idle at the old one.
      const delta = this.targets.get(label.id) === target ? elapsed / FRIENDS_GALAXY_LABEL_FADE_DURATION_MS : 0;
      this.targets.set(label.id, target);
      const opacity = !motion ? target : target > previous ? Math.min(target, previous + delta) : Math.max(target, previous - delta);
      this.opacity.set(label.id, opacity);
      if (opacity !== target) this.active = true;
      if (opacity > 0 || target > 0) result.push({ label, opacity });
    }
    return result;
  }
}
