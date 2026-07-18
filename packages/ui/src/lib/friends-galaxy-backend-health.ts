export class FriendsGalaxyBackendHealth {
  private fatalError: string | null = null;

  reportFatalError(reason: string): void {
    const normalized = reason.trim();
    if (!normalized || this.fatalError) return;
    this.fatalError = normalized;
  }

  takeFatalError(): string | null {
    const error = this.fatalError;
    this.fatalError = null;
    return error;
  }

  clear(): void {
    this.fatalError = null;
  }
}
