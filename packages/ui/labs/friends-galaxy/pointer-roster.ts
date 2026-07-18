export class GalaxyLabPointerRoster {
  private readonly pointerIds: Int32Array;
  private readonly positionsX: Float64Array;
  private readonly positionsY: Float64Array;
  private readonly startsX: Float64Array;
  private readonly startsY: Float64Array;
  private activeCount = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Pointer roster capacity must be a positive integer.");
    }
    this.pointerIds = new Int32Array(capacity);
    this.pointerIds.fill(-1);
    this.positionsX = new Float64Array(capacity);
    this.positionsY = new Float64Array(capacity);
    this.startsX = new Float64Array(capacity);
    this.startsY = new Float64Array(capacity);
  }

  get count(): number {
    return this.activeCount;
  }

  begin(pointerId: number, x: number, y: number): number {
    const existingIndex = this.indexOf(pointerId);
    if (existingIndex >= 0) {
      this.positionsX[existingIndex] = x;
      this.positionsY[existingIndex] = y;
      this.startsX[existingIndex] = x;
      this.startsY[existingIndex] = y;
      return existingIndex;
    }
    if (this.activeCount >= this.pointerIds.length) return -1;
    const index = this.activeCount;
    this.activeCount += 1;
    this.pointerIds[index] = pointerId;
    this.positionsX[index] = x;
    this.positionsY[index] = y;
    this.startsX[index] = x;
    this.startsY[index] = y;
    return index;
  }

  indexOf(pointerId: number): number {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.pointerIds[index] === pointerId) return index;
    }
    return -1;
  }

  xAt(index: number): number {
    return this.positionsX[index] ?? 0;
  }

  yAt(index: number): number {
    return this.positionsY[index] ?? 0;
  }

  update(index: number, x: number, y: number): void {
    this.positionsX[index] = x;
    this.positionsY[index] = y;
  }

  movedBeyond(index: number, x: number, y: number, distance: number): boolean {
    const deltaX = x - (this.startsX[index] ?? x);
    const deltaY = y - (this.startsY[index] ?? y);
    return deltaX * deltaX + deltaY * deltaY > distance * distance;
  }

  remove(pointerId: number): boolean {
    const removedIndex = this.indexOf(pointerId);
    if (removedIndex < 0) return false;
    const nextCount = this.activeCount - 1;
    for (let index = removedIndex; index < nextCount; index += 1) {
      this.pointerIds[index] = this.pointerIds[index + 1]!;
      this.positionsX[index] = this.positionsX[index + 1]!;
      this.positionsY[index] = this.positionsY[index + 1]!;
      this.startsX[index] = this.startsX[index + 1]!;
      this.startsY[index] = this.startsY[index + 1]!;
    }
    this.pointerIds[nextCount] = -1;
    this.positionsX[nextCount] = 0;
    this.positionsY[nextCount] = 0;
    this.startsX[nextCount] = 0;
    this.startsY[nextCount] = 0;
    this.activeCount = nextCount;
    return true;
  }
}
