/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AISection } from "./AISection";

const mocks = vi.hoisted(() => ({
  viewer: true,
  save: vi.fn(async () => {}),
  saveDevice: vi.fn(() => true),
  device: { provider: "ollama", model: "local", ollamaUrl: "http://localhost:11434" },
}));
vi.mock("../../context/PlatformContext.js", () => ({
  usePlatform: () => ({ libraryAccess: mocks.viewer ? "read-only" : "editable" }),
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    preferences: { ai: { autoSummarize: true, extractTopics: true } },
    updatePreferences: mocks.save,
  }),
}));
vi.mock("../../lib/device-ai-preferences.js", () => ({
  useDeviceAIPreferences: () => [mocks.device, mocks.saveDevice],
}));

describe("viewer AI preferences", () => {
  it.each([true, false])("preserves local configuration with viewer=%s", async (viewer) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.viewer = viewer;
    vi.clearAllMocks();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<AISection />));
      const workflow = container.querySelector<HTMLButtonElement>('[aria-label="Summaries and extraction"]')!;
      expect(workflow.disabled).toBe(viewer);
      await act(async () => workflow.click());
      if (viewer) expect(mocks.save).not.toHaveBeenCalled();
      else expect(mocks.save).toHaveBeenCalledWith({ ai: { autoSummarize: false } });
      mocks.save.mockClear();
      const off = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="ai-provider-selector"] button')]
        .find(button => button.textContent?.includes("Off"))!;
      expect(off).toBeDefined();
      await act(async () => off.click());
      expect(mocks.saveDevice).toHaveBeenCalledWith({ provider: "none", model: "" });
      if (viewer) expect(mocks.save).not.toHaveBeenCalled();
      else expect(mocks.save).toHaveBeenCalledWith({ ai: { autoSummarize: false, extractTopics: false } });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
