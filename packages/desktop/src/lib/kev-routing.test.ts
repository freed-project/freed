import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ provider: "kev", jev: vi.fn(), kev: vi.fn(), current: vi.fn() }));
vi.mock("./jev-provider", () => ({ getJevClassifierProvider: () => state.provider, onJevClassifierProviderChange: () => () => {} }));
vi.mock("./jev-client", () => ({ isJevNative: true, requestNativeJev: state.jev, jevPreviewHeaders: vi.fn() }));
vi.mock("./kev-client", () => ({ requestLocalKev: state.kev }));
vi.mock("./jev-library", () => ({ assertJevSourceCurrent: state.current }));
import { postJevPreviewRequest } from "./jev-preview-run";
import { classifierEvalItem } from "./classifier-evaluation";
beforeEach(() => { vi.clearAllMocks(); state.provider = "kev"; state.current.mockResolvedValue(undefined); });
it("routes Kev exclusively after source validation and stops locally on failure", async () => {
  state.kev.mockRejectedValue(new Error("Local server offline"));
  await expect(postJevPreviewRequest("/api/jev-preview/classify", { item: classifierEvalItem(0) }, new AbortController().signal)).rejects.toThrow("offline");
  expect(state.current).toHaveBeenCalledTimes(1); expect(state.kev).toHaveBeenCalledTimes(1); expect(state.jev).not.toHaveBeenCalled();
});
it("requires explicit Jev selection for capability matching", async () => {
  await expect(postJevPreviewRequest("/api/jev-preview/match", { item: classifierEvalItem(0) }, new AbortController().signal)).rejects.toThrow("explicit switch");
  expect(state.kev).not.toHaveBeenCalled(); expect(state.jev).not.toHaveBeenCalled();
  state.provider = "jev"; state.jev.mockResolvedValue({ ok: true });
  await postJevPreviewRequest("/api/jev-preview/classify", { item: classifierEvalItem(0) }, new AbortController().signal);
  expect(state.jev).toHaveBeenCalledTimes(1);
});
