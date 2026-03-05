/**
 * Mock for @tauri-apps/plugin-store used when VITE_TEST_TAURI=1.
 *
 * Implements the Store.load() static constructor pattern used by the real
 * plugin. Data lives in memory — nothing is persisted across page reloads,
 * which is exactly what we want for isolated test runs.
 */

export class Store {
  private data: Map<string, unknown>;

  private constructor(initial: Record<string, unknown> = {}) {
    this.data = new Map(Object.entries(initial));
  }

  static async load(
    _path: string,
    options?: { defaults?: Record<string, unknown>; autoSave?: boolean },
  ): Promise<Store> {
    return new Store(options?.defaults ?? {});
  }

  async get<T>(key: string): Promise<T | null> {
    const val = this.data.get(key);
    return val === undefined ? null : (val as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async values(): Promise<unknown[]> {
    return [...this.data.values()];
  }

  async entries(): Promise<[string, unknown][]> {
    return [...this.data.entries()];
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async length(): Promise<number> {
    return this.data.size;
  }

  async save(): Promise<void> {}

  async close(): Promise<void> {}

  async reset(): Promise<void> {
    this.data.clear();
  }
}
