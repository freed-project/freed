/**
 * Mock for @tauri-apps/plugin-store
 *
 * secure-storage.ts wraps @tauri-apps/plugin-store's Store class to persist
 * encrypted API keys. In test mode we back it with a simple in-memory Map.
 */

export class Store {
  private mem = new Map<string, unknown>();

  constructor(_path: string) {}

  async get<T>(key: string): Promise<T | null> {
    return (this.mem.get(key) as T) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.mem.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.mem.delete(key);
  }

  async save(): Promise<void> {}

  async load(): Promise<void> {}
}

export async function load(
  path: string,
  _options?: { defaults?: Record<string, unknown>; autoSave?: boolean },
): Promise<Store> {
  return new Store(path);
}
