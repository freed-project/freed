/**
 * Encrypted device-local key-value store for API keys
 *
 * Uses tauri-plugin-store which encrypts the JSON file with a device-specific
 * key. API keys stored here are NEVER synced via Automerge -- they stay on
 * the device where they were entered.
 *
 * Sync-safe fields (provider name, model, toggles) live in UserPreferences.ai
 * inside the Automerge doc. Only the raw API key strings live here.
 */

import { Store } from "@tauri-apps/plugin-store";

type ApiKeyProvider = "openai" | "anthropic" | "gemini";

// Singleton store instance -- lazy-initialized on first use
let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    // "secure.json" is an encrypted JSON file stored in the Tauri app data dir.
    // The plugin handles encryption transparently.
    _store = await Store.load("secure.json", { defaults: {}, autoSave: true });
  }
  return _store;
}

export const secureStorage = {
  /**
   * Retrieve an API key for the given provider.
   * Returns null when no key has been set.
   */
  async getApiKey(provider: ApiKeyProvider): Promise<string | null> {
    const store = await getStore();
    return (await store.get<string>(`apiKey.${provider}`)) ?? null;
  },

  /**
   * Persist an API key for the given provider.
   * The key is encrypted at rest by tauri-plugin-store.
   */
  async setApiKey(provider: ApiKeyProvider, key: string): Promise<void> {
    const store = await getStore();
    await store.set(`apiKey.${provider}`, key);
  },

  /**
   * Remove the stored API key for the given provider.
   */
  async clearApiKey(provider: ApiKeyProvider): Promise<void> {
    const store = await getStore();
    await store.delete(`apiKey.${provider}`);
  },
};
