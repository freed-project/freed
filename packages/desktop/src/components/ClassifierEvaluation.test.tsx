// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ provider: "kev", listeners: new Set<() => void>(), kev: vi.fn(), jev: vi.fn() }));
vi.mock("../lib/jev-provider", () => ({ getJevClassifierProvider: () => state.provider, onJevClassifierProviderChange: (fn: () => void) => { state.listeners.add(fn); return () => state.listeners.delete(fn); } }));
vi.mock("../lib/jev-client", () => ({ isJevNative: true, requestNativeJev: state.jev }));
vi.mock("../lib/kev-client", () => ({ requestLocalKev: state.kev, kevConnectionStatus: async () => ({ model: "kev-4b@v1.0" }) }));
import { ClassifierEvaluation } from "./ClassifierEvaluation";
import { parseKevResponse } from "../lib/kev-classification";
import { JEV_SIGNAL_KEYS } from "../lib/jev-classification";
let container: HTMLDivElement, root: Root;
const result = () => ({ ...parseKevResponse({ model: "kev-latest", answers: Object.fromEntries(JEV_SIGNAL_KEYS.map(key => [key, { type: "noul", noul: 0.5 }])), usage: { input_tokens: 1, output_tokens: 1 } }), cached: false, estimatedCostUsd: 0, elapsedMs: 10 });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.provider = "kev"; state.listeners.clear(); state.kev.mockResolvedValue(result());
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("runs six local synthetic examples and retains a completed report across explicit switches", async () => {
  await act(async () => root.render(<ClassifierEvaluation />));
  await act(async () => container.querySelector("button")!.click());
  expect(state.kev).toHaveBeenCalledTimes(6); expect(state.jev).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Accepted 0 / 24");
  expect(container.textContent).toContain("No accepted decisions");
  expect(state.kev.mock.calls[0][0].sampleDataFingerprint.batchId).toBe("freed-classifier-smoke-v1");
  await act(async () => { state.provider = "jev"; for (const listener of state.listeners) listener(); });
  expect(container.textContent).toContain("Six requests may incur API usage");
  expect(container.textContent).toContain("kev-4b@v1.0");
});
it("cancels on provider change without sending remaining requests or publishing a partial aggregate", async () => {
  let finish!: (value: unknown) => void;
  state.kev.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<ClassifierEvaluation />));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => { state.provider = "jev"; for (const listener of state.listeners) listener(); finish(result()); });
  expect(state.kev).toHaveBeenCalledTimes(1); expect(state.jev).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="kev evaluation result"]')).toBeNull();
});
