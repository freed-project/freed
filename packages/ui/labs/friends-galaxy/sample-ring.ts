export class GalaxyLabSampleRing {
  private readonly samples: Float64Array;
  private nextIndex = 0;
  private sampleCount = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Sample ring capacity must be a positive integer.");
    }
    this.samples = new Float64Array(capacity);
  }

  get length(): number {
    return this.sampleCount;
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    this.samples[this.nextIndex] = value;
    this.nextIndex = (this.nextIndex + 1) % this.samples.length;
    this.sampleCount = Math.min(this.samples.length, this.sampleCount + 1);
  }

  clear(): void {
    this.nextIndex = 0;
    this.sampleCount = 0;
  }

  snapshot(): number[] {
    const result = new Array<number>(this.sampleCount);
    const firstIndex = this.sampleCount === this.samples.length ? this.nextIndex : 0;
    for (let index = 0; index < this.sampleCount; index += 1) {
      result[index] = this.samples[(firstIndex + index) % this.samples.length]!;
    }
    return result;
  }
}

export function shouldRefreshGalaxyLabDiagnostics(
  cameraInMotion: boolean,
  elapsedMs: number,
): boolean {
  return !cameraInMotion && elapsedMs >= 500;
}
