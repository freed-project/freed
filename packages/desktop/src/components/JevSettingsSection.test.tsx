// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { models, selection, providerState, budget, connection, subscribe, unsubscribe, forbiddenFetch, forbiddenInvoke } = vi.hoisted(() => ({
  budget: { get: vi.fn(), set: vi.fn() }, connection: vi.fn(),
  models: { listModels: vi.fn(), downloadModel: vi.fn(), pauseDownload: vi.fn(), removeModel: vi.fn() },
  selection: vi.fn(), providerState: { current: "jev" }, subscribe: vi.fn(), unsubscribe: vi.fn(),
  forbiddenFetch: vi.fn(() => { throw new Error("Network is forbidden in classifier Settings tests."); }),
  forbiddenInvoke: vi.fn(() => { throw new Error("Native IPC is forbidden in classifier Settings tests."); }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: forbiddenInvoke }));
vi.mock("@freed/ui/components/settings/AISection", () => ({ ApiKeyInput: () => <div>Jev key input</div> }));
vi.mock("../lib/jev-client", () => ({ isJevNative: true, jevCredentials: {}, testJevConnection: connection, getJevBudget: budget.get, setJevBudget: budget.set, onJevBudgetChange: () => () => {} }));
vi.mock("../lib/jev-provider", () => ({ getJevClassifierProvider: () => providerState.current, setJevClassifierProvider: selection }));
vi.mock("../lib/gliclass-client", () => ({ gliclassModels: models, GLICLASS_MANIFEST: { estimatedDownloadBytes: 754861034 }, removeLocalGliclass: models.removeModel }));
vi.mock("./ClassifierEvaluation", () => ({ ClassifierEvaluation: () => <div>Labeled evaluation</div> }));
vi.mock("../lib/kev-client", () => ({ kevConnectionStatus: async () => ({ configured: true, model: "jaredpalmer/kev-4b@v1.0" }) }));
vi.mock("../lib/local-ai-models", () => ({ subscribeToLocalAIModelState: subscribe }));
vi.mock("./JevClassificationPreview", () => ({ JevClassificationPreview: () => <div>Classifier evaluation</div> }));
import { JevSettingsSection } from "./JevSettingsSection";
// Tier 1: selecting the optional model downloads it without a key and exposes
// integrity failure/cancel/storage controls instead of claiming readiness.
describe("classifier settings", () => {
  let container: HTMLDivElement; let root: Root; let unmounted: boolean;
  const text = () => container.textContent ?? "";
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find(candidate => candidate.textContent === label)!;
  async function choose(provider: string) { await act(async () => { const select = container.querySelector("select")!; select.value = provider; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
  const chooseLocal = () => choose("gliclass-base");
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
    return { promise, resolve, reject };
  }
  function partialDownload() {
    const pending = deferred<unknown>();
    models.downloadModel.mockImplementationOnce((_id, progress) => {
      progress({ downloadedBytes: 4096 });
      return pending.promise;
    });
    return pending;
  }
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); unmounted = false;
    vi.clearAllMocks(); providerState.current = "jev";
    selection.mockImplementation((provider: string) => { providerState.current = provider; });
    subscribe.mockReturnValue(unsubscribe);
    vi.stubGlobal("fetch", forbiddenFetch);
    budget.get.mockResolvedValue(null);
    models.listModels.mockResolvedValue([{ state: { status: "not_downloaded" } }]);
    models.pauseDownload.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    try {
      if (!unmounted) await act(async () => root.unmount());
      expect(forbiddenFetch).not.toHaveBeenCalled();
      expect(forbiddenInvoke).not.toHaveBeenCalled();
      expect(connection).not.toHaveBeenCalled();
    } finally { container.remove(); vi.unstubAllGlobals(); }
  });
  it("selects Kev without a key or download", async () => {
    await act(async () => root.render(<JevSettingsSection />));
    await choose("kev");
    expect(selection).toHaveBeenCalledWith("kev");
    expect(models.downloadModel).not.toHaveBeenCalled();
    expect(text()).toContain("No API key, paid usage, or cloud fallback");
    expect(text()).not.toContain("Jev key input");
    await act(async () => button("Check local Kev").click());
    expect(text()).toContain("Local Kev ready: jaredpalmer/kev-4b@v1.0");
    expect(connection).not.toHaveBeenCalled();
  });
  it("keeps Jev available and automatically downloads explicit local selection", async () => {
    models.downloadModel.mockImplementation(async (_id, progress) => { progress({ downloadedBytes: 1024 }); return [{ state: { status: "available" } }]; });
    await act(async () => root.render(<JevSettingsSection />));
    expect(text()).toContain("Jev key input");
    await chooseLocal();
    expect(models.downloadModel).toHaveBeenCalledWith("gliclass-base", expect.any(Function));
    expect(text()).toContain("Local model ready. Works offline.");
    expect(text()).not.toContain("Jev key input");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Remove model and release memory")!.click(); });
    expect(models.removeModel).toHaveBeenCalled();
    expect(container.querySelector("option[value=jev]")).toBeTruthy();
  });
  it("shows integrity failures without claiming offline readiness", async () => {
    models.downloadModel.mockResolvedValue([{ state: { status: "error", lastError: "Integrity check failed." } }]);
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    expect(text()).toContain("Integrity check failed.");
    expect(text()).not.toContain("Local model ready. Works offline.");
  });
  it("cancels a partial download and resumes it without claiming readiness early", async () => {
    let finish!: (models: unknown) => void;
    models.downloadModel.mockImplementationOnce((_id, progress) => {
      progress({ downloadedBytes: 4096 });
      return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValueOnce([{ state: { status: "available" } }]);
    models.pauseDownload.mockImplementation(async () => { finish([{ state: { status: "paused" } }]); });
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    expect(text()).toContain("Downloading 4,096");
    expect(text()).not.toContain("Local model ready.");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Cancel download")!.click(); });
    expect(text()).toContain("Download paused. Resume to continue.");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Download or resume")!.click(); });
    expect(models.downloadModel).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Local model ready. Works offline.");
  });
  it("reuses an installed local model without downloading and exposes removal failure", async () => {
    models.listModels.mockResolvedValue([{ state: { status: "available" } }]);
    models.removeModel.mockRejectedValueOnce(new Error("GLiClass is busy. Stop classification first."));
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    expect(models.downloadModel).not.toHaveBeenCalled();
    expect(text()).toContain("Local model ready. Works offline.");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Remove model and release memory")!.click(); });
    expect(text()).toContain("Stop classification first.");
    expect(text()).toContain("Local model ready. Works offline.");
  });

  it("keeps the local classifier usable when paid Jev allowance is exhausted", async () => {
    budget.get.mockResolvedValue({ limits: { dailyNanoUsd: 1_000_000_000, monthlyNanoUsd: 10_000_000_000, totalNanoUsd: null }, dailyReservedNanoUsd: 1_000_000_000, monthlyReservedNanoUsd: 10_000_000_000, totalReservedNanoUsd: 10_000_000_000 });
    models.listModels.mockResolvedValue([{ state: { status: "available" } }]);
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    expect(text()).toContain("Local model ready. Works offline.");
    expect(text()).not.toContain("Jev key input");
    expect(models.downloadModel).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
    expect(budget.set).not.toHaveBeenCalled();
  });

  it("reports a rejected cancel, keeps the download pending, and permits a successful retry", async () => {
    const pending = partialDownload();
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    const pause = deferred<unknown>();
    models.pauseDownload.mockReturnValueOnce(pause.promise);
    await act(async () => button("Cancel download").click());
    await act(async () => pause.reject(new Error("Could not pause GLiClass.")));
    expect(text()).toContain("Could not pause GLiClass.");
    expect(text()).toContain("Downloading 4,096");
    expect(text()).not.toContain("Download paused. Resume to continue.");
    expect(text()).not.toContain("Local model ready.");
    expect(button("Download or resume")).toBeUndefined();
    expect(providerState.current).toBe("gliclass-base");
    expect(models.downloadModel).toHaveBeenCalledTimes(1);

    models.pauseDownload.mockImplementationOnce(async () => { pending.resolve([{ state: { status: "paused" } }]); });
    await act(async () => button("Cancel download").click());
    expect(text()).toContain("Download paused. Resume to continue.");
    expect(text()).not.toContain("Could not pause GLiClass.");
    models.downloadModel.mockResolvedValueOnce([{ state: { status: "available" } }]);
    await act(async () => button("Download or resume").click());
    expect(models.downloadModel).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Local model ready. Works offline.");
    expect(providerState.current).toBe("gliclass-base");
  });

  it("retains the local provider after a rejected pause while switching and recovers on retry", async () => {
    const pending = partialDownload();
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    const pause = deferred<unknown>();
    models.pauseDownload.mockReturnValueOnce(pause.promise);
    await choose("jev");
    await act(async () => pause.reject(new Error("The download could not be paused.")));
    expect(text()).toContain("The download could not be paused.");
    expect(providerState.current).toBe("gliclass-base");
    expect(container.querySelector("select")!.value).toBe("gliclass-base");
    expect(selection).not.toHaveBeenCalledWith("jev");
    expect(models.downloadModel).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Jev key input");

    models.pauseDownload.mockImplementationOnce(async () => { pending.resolve([{ state: { status: "paused" } }]); });
    await choose("jev");
    expect(providerState.current).toBe("jev");
    expect(container.querySelector("select")!.value).toBe("jev");
    expect(text()).toContain("Jev key input");
    expect(models.downloadModel).toHaveBeenCalledTimes(1);
  });

  it("settles a rejected pause after unmount without an unhandled rejection", async () => {
    const pending = partialDownload();
    await act(async () => root.render(<JevSettingsSection />));
    await chooseLocal();
    const pause = deferred<unknown>();
    models.pauseDownload.mockReturnValueOnce(pause.promise);
    await act(async () => { root.unmount(); unmounted = true; });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      pause.reject(new Error("Could not pause during cleanup."));
      pending.resolve([{ state: { status: "paused" } }]);
    });
    expect(models.pauseDownload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("");
    expect(models.downloadModel).toHaveBeenCalledTimes(1);
  });

});
