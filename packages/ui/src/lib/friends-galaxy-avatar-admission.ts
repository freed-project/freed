export type FriendsGalaxyAvatarAdmissionStart = "applied" | "pending" | "start";

export class FriendsGalaxyAvatarAdmissionState<Owner extends object> {
  private appliedOwner: Owner | null = null;
  private appliedKey = "";
  private pendingOwner: Owner | null = null;
  private pendingKey = "";
  private pendingGeneration = 0;

  begin(owner: Owner, key: string, generation: number): FriendsGalaxyAvatarAdmissionStart {
    if (owner === this.appliedOwner && key === this.appliedKey) return "applied";
    if (owner === this.pendingOwner && key === this.pendingKey) {
      this.pendingGeneration = generation;
      return "pending";
    }
    this.pendingOwner = owner;
    this.pendingKey = key;
    this.pendingGeneration = generation;
    return "start";
  }

  canCommit(owner: Owner, key: string, generation: number): boolean {
    return owner === this.pendingOwner && key === this.pendingKey &&
      generation === this.pendingGeneration;
  }

  commit(owner: Owner, key: string, generation: number): boolean {
    if (!this.canCommit(owner, key, generation)) return false;
    this.appliedOwner = owner;
    this.appliedKey = key;
    this.clearPending();
    return true;
  }

  discard(owner: Owner, key: string): boolean {
    if (owner !== this.pendingOwner || key !== this.pendingKey) return false;
    this.clearPending();
    return true;
  }

  reset(): void {
    this.appliedOwner = null;
    this.appliedKey = "";
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingOwner = null;
    this.pendingKey = "";
    this.pendingGeneration = 0;
  }
}
