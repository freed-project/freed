import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import {
  clearDeviceAIPreferences,
  DEVICE_AI_PREFERENCES_STORAGE_KEY,
  DEFAULT_OLLAMA_URL,
  getDeviceAIPreferences,
  migrateLegacyDeviceAIPreferences,
  resetDeviceAIPreferencesForTests,
  setDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import {
  clearDeviceDisplayPreferences,
  DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
  getDeviceDisplayPreferences,
  migrateLegacyDeviceDisplayPreferences,
  resetDeviceDisplayPreferencesForTests,
  setDeviceDisplayPreferences,
} from "@freed/ui/lib/device-display-preferences";
import {
  beginFactoryResetBoundary,
  resetFactoryResetStateForTests,
} from "@freed/ui/lib/factory-reset";

describe("device-local preferences", () => {
  beforeEach(() => {
    resetFactoryResetStateForTests();
    window.localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetDeviceAIPreferencesForTests();
  });

  afterEach(() => {
    resetFactoryResetStateForTests();
    vi.restoreAllMocks();
  });

  it("imports legacy Automerge display state once", () => {
    const display = createDefaultPreferences().display;
    const migrated = migrateLegacyDeviceDisplayPreferences({
      ...display,
      sidebarMode: "closed",
      sidebarWidth: 312,
      friendsSidebarWidth: 388,
      friendsSidebarOpen: false,
      friendsMode: "friends",
      mapMode: "all_content",
      feedSignalModes: ["events", "personal"],
      savedContentSortMode: "shortest_read",
      reading: {
        ...display.reading,
        dualColumnMode: false,
      },
    });

    expect(migrated).toBe(true);
    expect(getDeviceDisplayPreferences()).toMatchObject({
      sidebarMode: "closed",
      sidebarWidth: 312,
      friendsSidebarWidth: 388,
      friendsSidebarOpen: false,
      friendsMode: "friends",
      mapMode: "all_content",
      feedSignalModes: ["events", "personal"],
      savedContentSortMode: "shortest_read",
      dualColumnMode: false,
    });
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it("never lets a later synced snapshot overwrite local display state", () => {
    const display = createDefaultPreferences().display;
    migrateLegacyDeviceDisplayPreferences({ ...display, sidebarMode: "expanded" });
    setDeviceDisplayPreferences({ sidebarMode: "closed", mapMode: "friends" });

    const migrated = migrateLegacyDeviceDisplayPreferences({
      ...display,
      sidebarMode: "compact",
      mapMode: "all_content",
    });

    expect(migrated).toBe(false);
    expect(getDeviceDisplayPreferences()).toMatchObject({
      sidebarMode: "closed",
      mapMode: "friends",
    });
  });

  it("persists partial display changes without disturbing other local controls", () => {
    setDeviceDisplayPreferences({ sidebarWidth: 340, friendsSidebarOpen: false });
    setDeviceDisplayPreferences({ sidebarMode: "compact" });

    expect(getDeviceDisplayPreferences()).toMatchObject({
      sidebarWidth: 340,
      sidebarMode: "compact",
      friendsSidebarOpen: false,
    });
  });

  it("imports legacy device AI settings once and keeps later changes local", () => {
    expect(migrateLegacyDeviceAIPreferences({
      provider: "ollama",
      model: "qwen",
      ollamaUrl: "http://studio.local:11434",
      autoSummarize: false,
      extractTopics: false,
    })).toBe(true);
    setDeviceAIPreferences({
      provider: "integrated",
      model: "",
      ollamaUrl: "http://laptop.local:11434",
    });

    expect(migrateLegacyDeviceAIPreferences({
      provider: "openai",
      model: "gpt-test",
      ollamaUrl: "http://other.local:11434",
      autoSummarize: false,
      extractTopics: false,
    })).toBe(false);
    expect(getDeviceAIPreferences()).toEqual({
      provider: "integrated",
      model: "",
      ollamaUrl: "http://laptop.local:11434",
    });
  });

  it("uses local AI defaults when no settings have been saved", () => {
    expect(getDeviceAIPreferences()).toEqual({
      provider: "none",
      model: "",
      ollamaUrl: DEFAULT_OLLAMA_URL,
    });
  });

  it("records a completed AI migration even when the legacy document has no runtime choice", () => {
    expect(migrateLegacyDeviceAIPreferences({
      autoSummarize: false,
      extractTopics: false,
    })).toBe(true);
    expect(JSON.parse(
      window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY) ?? "null",
    )).toMatchObject({
      version: 1,
      legacyMigrationCompleted: true,
      values: { provider: "none" },
    });

    resetDeviceAIPreferencesForTests();
    expect(migrateLegacyDeviceAIPreferences({
      provider: "ollama",
      model: "late-cloud-model",
      ollamaUrl: "http://late-cloud.local:11434",
      autoSummarize: false,
      extractTopics: false,
    })).toBe(false);
    expect(getDeviceAIPreferences().provider).toBe("none");
  });

  it("does not downgrade future local preference records", () => {
    const displayV2 = JSON.stringify({
      version: 2,
      values: { sidebarMode: "closed", futureLayout: "orbital" },
    });
    const aiV2 = JSON.stringify({
      version: 2,
      values: { provider: "future-provider", encryptedRuntime: true },
    });
    window.localStorage.setItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY, displayV2);
    window.localStorage.setItem(DEVICE_AI_PREFERENCES_STORAGE_KEY, aiV2);

    const legacy = createDefaultPreferences();
    expect(migrateLegacyDeviceDisplayPreferences({
      ...legacy.display,
      sidebarMode: "compact",
    })).toBe(false);
    expect(migrateLegacyDeviceAIPreferences({
      provider: "ollama",
      model: "legacy",
      ollamaUrl: DEFAULT_OLLAMA_URL,
      autoSummarize: false,
      extractTopics: false,
    })).toBe(false);

    expect(setDeviceDisplayPreferences({ sidebarMode: "expanded" })).toBe(false);
    expect(setDeviceAIPreferences({ provider: "none" })).toBe(false);
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(displayV2);
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).toBe(aiV2);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("expanded");
    expect(getDeviceAIPreferences().provider).toBe("none");
  });

  it("preserves corrupt local preference data before an explicit replacement", () => {
    const corrupt = "{definitely-not-json";
    window.localStorage.setItem(DEVICE_AI_PREFERENCES_STORAGE_KEY, corrupt);
    expect(migrateLegacyDeviceAIPreferences({
      provider: "ollama",
      model: "legacy",
      ollamaUrl: DEFAULT_OLLAMA_URL,
      autoSummarize: false,
      extractTopics: false,
    })).toBe(false);
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).toBe(corrupt);

    setDeviceAIPreferences({ provider: "integrated" });
    const recoveryKeys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).filter((key) => key?.startsWith(`${DEVICE_AI_PREFERENCES_STORAGE_KEY}.recovery.`));
    expect(recoveryKeys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(recoveryKeys[0] ?? "") ?? "null")).toMatchObject({
      reason: "corrupt",
      raw: corrupt,
    });
    expect(getDeviceAIPreferences().provider).toBe("integrated");
  });

  it("clears device-local display and AI choices during a device reset", () => {
    setDeviceDisplayPreferences({ sidebarMode: "closed", mapMode: "friends" });
    setDeviceAIPreferences({
      provider: "ollama",
      model: "qwen",
      ollamaUrl: "http://studio.local:11434",
    });

    clearDeviceDisplayPreferences();
    clearDeviceAIPreferences();

    expect(getDeviceDisplayPreferences().sidebarMode).toBe("expanded");
    expect(getDeviceDisplayPreferences().mapMode).toBeUndefined();
    expect(getDeviceAIPreferences()).toEqual({
      provider: "none",
      model: "",
      ollamaUrl: DEFAULT_OLLAMA_URL,
    });
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).not.toBeNull();

    const legacyDisplay = createDefaultPreferences().display;
    expect(migrateLegacyDeviceDisplayPreferences({
      ...legacyDisplay,
      sidebarMode: "closed",
    })).toBe(false);
    expect(migrateLegacyDeviceAIPreferences({
      provider: "ollama",
      model: "legacy-model",
      ollamaUrl: "http://legacy.local:11434",
      autoSummarize: false,
      extractTopics: false,
    })).toBe(false);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("expanded");
    expect(getDeviceAIPreferences().provider).toBe("none");
  });

  it("keeps the last persisted display and AI state when storage fails", () => {
    expect(setDeviceDisplayPreferences({ sidebarMode: "closed" })).toBe(true);
    expect(setDeviceAIPreferences({ provider: "integrated" })).toBe(true);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(setDeviceDisplayPreferences({ sidebarMode: "compact" })).toBe(false);
    expect(setDeviceAIPreferences({ provider: "none" })).toBe(false);
    expect(clearDeviceDisplayPreferences()).toBe(false);
    expect(clearDeviceAIPreferences()).toBe(false);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("closed");
    expect(getDeviceAIPreferences().provider).toBe("integrated");
  });

  it("blocks preference writers after reset starts while allowing reset clears", () => {
    expect(setDeviceDisplayPreferences({ sidebarMode: "closed" })).toBe(true);
    expect(setDeviceAIPreferences({ provider: "integrated" })).toBe(true);
    const displayBeforeReset = window.localStorage.getItem(
      DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY,
    );
    const aiBeforeReset = window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY);

    beginFactoryResetBoundary();

    expect(setDeviceDisplayPreferences({ sidebarMode: "compact" })).toBe(false);
    expect(setDeviceAIPreferences({ provider: "ollama" })).toBe(false);
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY))
      .toBe(displayBeforeReset);
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).toBe(aiBeforeReset);

    expect(clearDeviceDisplayPreferences()).toBe(true);
    expect(clearDeviceAIPreferences()).toBe(true);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("expanded");
    expect(getDeviceAIPreferences().provider).toBe("none");

    window.localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetDeviceAIPreferencesForTests();
    const legacy = createDefaultPreferences();
    expect(migrateLegacyDeviceDisplayPreferences(legacy.display)).toBe(false);
    expect(migrateLegacyDeviceAIPreferences(legacy.ai)).toBe(false);
    expect(window.localStorage.getItem(DEVICE_DISPLAY_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEVICE_AI_PREFERENCES_STORAGE_KEY)).toBeNull();
  });
});
