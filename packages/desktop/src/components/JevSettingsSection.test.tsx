// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { models, selection, budget, connection } = vi.hoisted(() => ({ budget: { get: vi.fn(), set: vi.fn() }, connection: vi.fn(), models: { listModels: vi.fn(), downloadModel: vi.fn(), pauseDownload: vi.fn(), removeModel: vi.fn() }, selection: vi.fn() }));
vi.mock("@freed/ui/components/settings/AISection", () => ({ ApiKeyInput: () => <div>Jev key input</div> }));
vi.mock("../lib/jev-client", () => ({ isJevNative: true, jevCredentials: {}, testJevConnection: connection, getJevBudget: budget.get, setJevBudget: budget.set, onJevBudgetChange: () => () => {} }));
vi.mock("../lib/jev-provider", () => ({ getJevClassifierProvider: () => "jev", setJevClassifierProvider: selection }));
vi.mock("../lib/gliclass-client", () => ({ gliclassModels: models, GLICLASS_MANIFEST: { estimatedDownloadBytes: 754861034 }, removeLocalGliclass: models.removeModel }));
vi.mock("./JevClassificationPreview", () => ({ JevClassificationPreview: () => <div>Classifier evaluation</div> }));
import { JevSettingsSection } from "./JevSettingsSection";
// Tier 1: selecting the optional model downloads it without a key and exposes
// integrity failure/cancel/storage controls instead of claiming readiness.
describe("classifier settings", () => {
  let container: HTMLDivElement; let root: Root;
  const text = () => container.textContent ?? "";
  async function chooseLocal() { await act(async () => { const select = container.querySelector("select")!; select.value = "gliclass-base"; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container=document.createElement("div"); document.body.append(container); root=createRoot(container); vi.clearAllMocks(); budget.get.mockResolvedValue(null); models.listModels.mockResolvedValue([{ state: { status: "not_downloaded" } }]); models.pauseDownload.mockResolvedValue(undefined); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
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

});
