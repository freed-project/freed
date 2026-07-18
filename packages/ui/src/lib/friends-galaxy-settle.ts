export class FriendsGalaxySettleScheduler {
  private pending = false;
  private deadlineMs = 0;
  private generation = 0;

  get isPending(): boolean {
    return this.pending;
  }

  schedule(generation: number, nowMs: number, delayMs = 140): void {
    this.pending = true;
    this.generation = generation;
    this.deadlineMs = nowMs + delayMs;
  }

  cancel(): void {
    this.pending = false;
  }

  takeDue(nowMs: number): number | null {
    if (!this.pending || nowMs < this.deadlineMs) return null;
    this.pending = false;
    return this.generation;
  }
}
