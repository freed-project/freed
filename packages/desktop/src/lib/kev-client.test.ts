import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, listeners } = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./jev-provider", () => ({ onJevClassifierProviderChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } }));
import { kevConnectionStatus, requestLocalKev } from "./kev-client";
import { classifierEvalItem } from "./classifier-evaluation";
import { JEV_SIGNAL_KEYS } from "./jev-classification";
const response = { model: "kev-latest", answers: Object.fromEntries(JEV_SIGNAL_KEYS.map(key => [key, { type: "noul", noul: 0.95 }])), usage: { input_tokens: 1, output_tokens: 1 } };
describe("Kev native client", () => {
  beforeEach(() => { vi.clearAllMocks(); listeners.clear(); });
  it("uses only local IPC and never substitutes Jev on failure", async () => {
    invoke.mockRejectedValue("Server offline");
    await expect(requestLocalKev(classifierEvalItem(0), new AbortController().signal)).rejects.toThrow("Server offline");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("request_kev", expect.objectContaining({ payload: expect.objectContaining({ model: "kev-latest" }) }));
  });
  it("checks metadata without inference and rejects a truncating server", async () => {
    invoke.mockResolvedValue({ models: [{ name: "kev-latest", run: "jaredpalmer/kev-4b@v1.0", truncate_states: false }] });
    expect((await kevConnectionStatus()).configured).toBe(true);
    expect(invoke).toHaveBeenCalledWith("get_kev_models");
    invoke.mockResolvedValue({ models: [{ name: "kev-latest", run: "test", truncate_states: true }] });
    await expect(kevConnectionStatus()).rejects.toThrow();
  });
  it("discards late responses after a provider switch", async () => {
    let complete!: (value: unknown) => void;
    invoke.mockImplementation((command: string) => command === "request_kev" ? new Promise(resolve => { complete = resolve; }) : Promise.resolve());
    const pending = requestLocalKev(classifierEvalItem(0), new AbortController().signal);
    for (const listener of listeners) listener();
    complete(response);
    await expect(pending).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith("cancel_kev_request", expect.any(Object));
    expect(listeners.size).toBe(0);
  });
});
