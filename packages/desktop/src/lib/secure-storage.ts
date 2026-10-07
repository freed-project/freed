/**
 * Device-local key-value store for existing provider API keys
 *
 * Uses the default tauri-plugin-store file store, which does not encrypt values.
 * API keys never enter Library Core records or checkpoints. Jev uses its native
 * OS-vault adapter instead. Existing keys require a separately verified migration.
 *
 * Synchronized provider, model, and processing preferences use typed Library
 * Core preference operations. Only raw API key strings live here.
 */

import { Store, load } from "@tauri-apps/plugin-store";
import { scheduleSideEffect } from "./side-effect-scheduler";

type ApiKeyProvider = "openai" | "anthropic" | "gemini" | "github_story_wall";

// Singleton store instance -- lazy-initialized on first use
let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    // The historical filename does not imply encryption. This is a local JSON store.
    _store = await load("secure.json", { defaults: {}, autoSave: true });
  }
  return _store;
}

export const secureStorage = {
  /**
   * Retrieve an API key for the given provider.
   * Returns null when no key has been set.
   */
  async getApiKey(provider: ApiKeyProvider): Promise<string | null> {
    return scheduleSideEffect({
      queue: "nativeStore",
      source: "secure-storage",
      kind: "getApiKey",
      run: async () => {
        const store = await getStore();
        return (await store.get<string>(`apiKey.${provider}`)) ?? null;
      },
    });
  },

  /**
   * Persist an API key for the given provider.
   * This existing provider path uses local file persistence.
   */
  async setApiKey(provider: ApiKeyProvider, key: string): Promise<void> {
    await scheduleSideEffect({
      queue: "nativeStore",
      source: "secure-storage",
      kind: "setApiKey",
      run: async () => {
        const store = await getStore();
        await store.set(`apiKey.${provider}`, key);
      },
    });
  },

  /**
   * Remove the stored API key for the given provider.
   */
  async clearApiKey(provider: ApiKeyProvider): Promise<void> {
    await scheduleSideEffect({
      queue: "nativeStore",
      source: "secure-storage",
      kind: "clearApiKey",
      run: async () => {
        const store = await getStore();
        await store.delete(`apiKey.${provider}`);
      },
    });
  },

};
