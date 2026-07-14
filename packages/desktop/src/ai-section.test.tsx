/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../../ui/src/context/PlatformContext.js";
import {
  getDeviceAIPreferences,
  resetDeviceAIPreferencesForTests,
  setDeviceAIPreferences,
} from "../../ui/src/lib/device-ai-preferences.js";
import { useToastStore } from "../../ui/src/components/Toast.js";
import { AISection } from "../../ui/src/components/settings/AISection.js";

describe("AISection device-local transaction", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    resetDeviceAIPreferencesForTests();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("restores the prior provider when the synchronized half of a switch fails", async () => {
    expect(setDeviceAIPreferences({
      provider: "ollama",
      model: "qwen2.5:1.5b",
      ollamaUrl: "http://localhost:11434",
    })).toBe(true);
    const persistenceError = new Error("Automerge worker unavailable");
    const updatePreferences = vi.fn(async () => {
      throw persistenceError;
    });
    const preferences = createDefaultPreferences();
    preferences.ai.autoSummarize = true;
    preferences.ai.extractTopics = true;
    const useTestStore = create(() => ({ preferences, updatePreferences }));
    const platform = {
      store: useTestStore,
      SourceIndicator: null,
      HeaderSyncIndicator: null,
      SettingsExtraSections: null,
      LegalSettingsContent: null,
      FeedEmptyState: null,
      XSettingsContent: null,
      FacebookSettingsContent: null,
      InstagramSettingsContent: null,
      LinkedInSettingsContent: null,
      GoogleContactsSettingsContent: null,
    } as unknown as PlatformConfig;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PlatformProvider value={platform}>
          <AISection />
        </PlatformProvider>,
      );
    });

    const openAIButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("OpenAI"));
    expect(openAIButton).toBeDefined();
    await act(async () => {
      openAIButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updatePreferences).toHaveBeenCalledWith({
      ai: { autoSummarize: true, extractTopics: true },
    });
    expect(getDeviceAIPreferences()).toMatchObject({
      provider: "ollama",
      model: "qwen2.5:1.5b",
    });
    expect(openAIButton?.getAttribute("aria-pressed")).toBe("false");
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      "Freed could not save the AI settings.",
    );
  });
});
