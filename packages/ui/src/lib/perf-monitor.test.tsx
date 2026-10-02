// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFpsMonitor } from "./perf-monitor";

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("./debug-store.js", () => ({
  useDebugStore: (select: (state: unknown) => unknown) =>
    select({ setPerfSnapshot: publish, perfResetGeneration: 0 }),
}));

let root: Root;
let visibility: DocumentVisibilityState;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
function Monitor() { useFpsMonitor(true); return null; }
async function frame(ts: number) {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => { pending.forEach((callback) => callback(ts)); });
}
async function visible(state: DocumentVisibilityState) {
  visibility = state;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  visibility = "visible";
  frames = new Map(); nextId = 0;
  publish.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback); return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("PerformanceObserver", undefined);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe("foreground performance sampling", () => {
  it("stops hidden work and excludes the hidden gap while retaining foreground stalls", async () => {
    await act(async () => root.render(<Monitor />));
    await frame(0); await frame(300);
    expect(publish.mock.lastCall?.[0].droppedFrames).toBe(1);
    await visible("hidden");
    expect(frames.size).toBe(0);
    await visible("visible");
    expect(frames.size).toBe(1);
    await frame(60_000); await frame(60_016);
    expect(publish.mock.lastCall?.[0].frameTimes).toEqual([300, 16]);
    expect(publish.mock.lastCall?.[0].droppedFrames).toBe(1);
    await frame(60_316);
    expect(publish.mock.lastCall?.[0].droppedFrames).toBe(2);
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
  });
  it("does not interpret a minute in the background as a foreground stall", async () => {
    await act(async () => root.render(<Monitor />));
    await frame(0); await frame(16);
    await visible("hidden");
    await visible("visible");
    await frame(60_000); await frame(60_016);
    expect(publish.mock.lastCall?.[0].frameTimes).toEqual([16, 16]);
    expect(publish.mock.lastCall?.[0].droppedFrames).toBe(0);
  });
  it("does not schedule sampling when mounted hidden", async () => {
    visibility = "hidden";
    await act(async () => root.render(<Monitor />));
    expect(frames.size).toBe(0);
    await visible("visible");
    expect(frames.size).toBe(1);
  });
});
