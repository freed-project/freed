/**
 * Mock for @tauri-apps/plugin-store
 *
 * secure-storage.ts wraps @tauri-apps/plugin-store's Store class to persist
 * encrypted API keys. In test mode we back it with a simple in-memory Map.
 */

const stores = new Map<string, Map<string, unknown>>();

function storageKey(path: string): string {
  return `__TAURI_MOCK_STORE__:${path}`;
}

function loadStoreData(path: string): Map<string, unknown> {
  try {
    const raw = window.localStorage.getItem(storageKey(path));
    if (!raw) return new Map<string, unknown>();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map<string, unknown>(Object.entries(parsed));
  } catch {
    return new Map<string, unknown>();
  }
}

function persistStoreData(path: string, mem: Map<string, unknown>): void {
  try {
    window.localStorage.setItem(
      storageKey(path),
      JSON.stringify(Object.fromEntries(mem)),
    );
  } catch {
    // Ignore persistence failures in test mode.
  }
}

function shouldThrow(): boolean {
  try {
    return window.localStorage.getItem("__TAURI_MOCK_STORE_THROW__") === "1";
  } catch {
    return false;
  }
}

export class Store {
  private readonly path: string;
  private mem: Map<string, unknown>;

  constructor(path: string) {
    this.path = path;
    const existing = stores.get(path);
    if (existing) {
      this.mem = existing;
      return;
    }

    this.mem = loadStoreData(path);
    stores.set(path, this.mem);
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.mem.get(key) as T) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.mem.set(key, value);
    persistStoreData(this.path, this.mem);
  }

  async delete(key: string): Promise<void> {
    this.mem.delete(key);
    persistStoreData(this.path, this.mem);
  }

  async save(): Promise<void> {}

  async load(): Promise<void> {}
}

export async function load(
  path: string,
  _options?: { defaults?: Record<string, unknown>; autoSave?: boolean },
): Promise<Store> {
  if (shouldThrow()) {
    throw new Error("mock plugin-store failure");
  }
  return new Store(path);
}
