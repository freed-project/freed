import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", async () => {
  return import("../__mocks__/@tauri-apps/plugin-store/index");
});

import { __resetMockStores } from "../__mocks__/@tauri-apps/plugin-store/index";
import { secureStorage } from "./secure-storage";

const credentials = secureStorage as typeof secureStorage & {
  getApiKey(provider: string): Promise<string | null>;
  setApiKey(provider: string, key: string): Promise<void>;
};

describe("secure storage reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetMockStores();
  });

  it("removes every encrypted credential, including Story Wall tokens", async () => {
    await credentials.setApiKey("openai", "openai-secret");
    await credentials.setApiKey("anthropic", "anthropic-secret");
    await credentials.setApiKey("github_story_wall", "github-secret");

    await secureStorage.clearAllCredentials();

    await expect(credentials.getApiKey("openai")).resolves.toBeNull();
    await expect(credentials.getApiKey("anthropic")).resolves.toBeNull();
    await expect(credentials.getApiKey("github_story_wall")).resolves.toBeNull();
  });

  it("rejects when the encrypted store cannot be cleared", async () => {
    await credentials.setApiKey("openai", "keep-until-persisted");
    window.localStorage.setItem("__TAURI_MOCK_STORE_THROW__", "1");

    await expect(secureStorage.clearAllCredentials()).rejects.toThrow(
      "mock plugin-store failure",
    );

    window.localStorage.removeItem("__TAURI_MOCK_STORE_THROW__");
    await expect(credentials.getApiKey("openai")).resolves.toBe(
      "keep-until-persisted",
    );
  });
});
