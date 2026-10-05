/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationMarkerSummary } from "@freed/shared";

const lifecycle = vi.hoisted(() => ({ construct: vi.fn(), style: vi.fn() }));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "synthetic-worker" }));
vi.mock("maplibre-gl", () => ({
  Map: class { constructor(options: unknown) { return lifecycle.construct(options); } },
  Marker: class {
    element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) { this.element = element; }
    setLngLat() { return this; }
    addTo(map: any) { map.getCanvasContainer().append(this.element); return this; }
    remove = vi.fn(() => this.element.remove());
  },
  GPUInitializationError: class GPUInitializationError extends Error {},
  setWorkerUrl: vi.fn(), setWorkerCount: vi.fn(),
}));
vi.mock("../../lib/map-style.js", () => ({ buildThemedMapStyle: () => lifecycle.style() }));
vi.mock("../../context/PlatformContext.js", () => ({
  usePlatform: () => ({ geographicMapMode: "online", interactionMode: "read-only" }),
}));
import { MapSurface } from "./MapSurface";

const markers: LocationMarkerSummary[] = [{
  key: "location:paris", authorKey: "author:ada", lat: 48.85, lng: 2.35,
  label: "Paris", groupCount: 1, seenAt: 1,
  item: {
    globalId: "rss:1", platform: "rss", contentType: "post", capturedAt: 1,
    author: { id: "ada", handle: "ada", displayName: "Ada" },
    content: { text: "At the observatory.", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] }, topics: [],
  },
}];

function liveMap(container: HTMLElement) {
  const canvasContainer = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.className = "maplibregl-canvas";
  canvasContainer.append(canvas);
  container.append(canvasContainer);
  const loseContext = vi.fn();
  vi.spyOn(canvas, "getContext").mockReturnValue({
    getExtension: () => ({ loseContext }),
  } as unknown as WebGL2RenderingContext);
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  return {
    painter: {},
    getContainer: () => ({ clientWidth: 900, clientHeight: 560 }),
    getCenter: () => ({ lng: 0 }),
    project: vi.fn(() => ({ x: 450, y: 280 })), fitBounds: vi.fn(),
    on: vi.fn((event: string, listener: (event?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    off: vi.fn((event: string, listener: (event?: unknown) => void) => { listeners.get(event)?.delete(listener); }),
    emit: (event: string, value?: unknown) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(value);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
    getCanvas: () => canvas, getCanvasContainer: () => canvasContainer,
    stop: vi.fn(), remove: vi.fn(() => canvasContainer.remove()),
    resize: vi.fn(), panBy: vi.fn(), flyTo: vi.fn(), loaded: () => true, loseContext,
  };
}

describe("MapSurface initialization ownership", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let map: ReturnType<typeof liveMap>;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    lifecycle.style.mockReset().mockResolvedValue({ version: 8, sources: {}, layers: [] });
    lifecycle.construct.mockReset().mockImplementation(({ container }) => {
      map = liveMap(container); return map;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove(); vi.useRealTimers(); vi.restoreAllMocks();
  });
  async function mount() {
    await act(async () => { root!.render(<MapSurface markers={markers} />); });
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  async function unmount() { await act(async () => root!.unmount()); root = null; }

  it("retains the selected popup and pin when an adjacent marker changes", async () => {
    const adjacent = { ...markers[0], key: "location:rome", authorKey: "author:b", lat: 41.9, lng: 12.5, label: "Rome", item: { ...markers[0].item, globalId: "rss:2" } };
    await mount();
    await act(async () => root!.render(<MapSurface markers={[markers[0], adjacent]} />));
    const pin = container.querySelector('.freed-map-marker') as HTMLElement;
    await act(async () => pin.click());
    const popup = document.querySelector('[data-testid="map-floating-panel"]'); expect(popup).not.toBeNull();
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0] }, { ...adjacent, label: "Updated Rome" }]} />));
    expect(document.querySelector('[data-testid="map-floating-panel"]')).toBe(popup);
    expect(container.querySelector('.freed-map-marker')).toBe(pin);
  });

  it("updates a selected pin in place through repeated refreshes and closes it for replacement/removal/context change", async () => {
    await mount();
    const pin = container.querySelector('.freed-map-marker') as HTMLElement;
    await act(async () => pin.click()); const popup = document.querySelector('[data-testid="map-floating-panel"]');
    for (let version = 0; version < 12; version++) {
      await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], item: { ...markers[0].item, content: { ...markers[0].item.content, text: `Synthetic revision ${version}` } } }]} />));
      expect(document.querySelector('[data-testid="map-floating-panel"]')).toBe(popup); expect(pin.isConnected).toBe(true);
      expect(popup?.textContent).toContain(`Synthetic revision ${version}`);
    }
    expect(map.remove).not.toHaveBeenCalled(); expect(map.flyTo).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], item: { ...markers[0].item, globalId: "replacement" } }]} />));
    expect(document.querySelector('[data-testid="map-floating-panel"]')).toBeNull();
    await act(async () => (container.querySelector('.freed-map-marker') as HTMLElement).click());
    await act(async () => root!.render(<MapSurface markers={[]} />)); expect(document.querySelector('[data-testid="map-floating-panel"]')).toBeNull();
    await act(async () => root!.render(<MapSurface markers={markers} />));
    await act(async () => (container.querySelector('.freed-map-marker') as HTMLElement).click());
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentKey="new-filter" />));
    expect(document.querySelector('[data-testid="map-floating-panel"]')).toBeNull();
    await act(async () => (container.querySelector('.freed-map-marker') as HTMLElement).click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-testid="map-floating-panel"]')).toBeNull();
  });

  it("preserves manual camera through inset and visible content updates", async () => {
    await mount();
    await act(async () => { map.emit("movestart", { originalEvent: new Event("mousedown") }); map.emit("moveend"); });
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], label: "updated" }]}
      viewportInsets={{ top: 10, right: 20, bottom: 30, left: 40 }} />));
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 49 }]} cameraContentKey="friends" />));
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });
  it("animates changed offscreen content once, but never a manual empty pan", async () => {
    await mount();
    map.project.mockReturnValue({ x: -100, y: -100 });
    await act(async () => { map.emit("movestart", { originalEvent: new Event("wheel") }); map.emit("moveend"); });
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentKey="friends" />));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 600 }));
    for (const next of [markers, [], []]) await act(async () => root!.render(<MapSurface markers={[...next]} cameraContentKey="friends" />));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });
  it("lets interaction own the camera before progressive initial locations settle", async () => {
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentSettled={false} />));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(map.flyTo).not.toHaveBeenCalled();
    map.getCanvasContainer().dispatchEvent(new WheelEvent("wheel", { deltaY: 4 }));
    map.project.mockReturnValue({ x: -100, y: -100 });
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 49 }]} cameraContentSettled={false} />));
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 50 }]} cameraContentSettled />));
    expect(map.flyTo).not.toHaveBeenCalled();
  });
  it("fits once after initial resolution and preserves intentional focus", async () => {
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentSettled={false} />));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(map.flyTo).not.toHaveBeenCalled();
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentSettled />));
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<MapSurface markers={markers} focusedMarkerKey={markers[0].key} />));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 7.5 }));
  });
  it("checks nearest longitude world copy and preserves partially visible content", async () => {
    await mount(); map.getCenter = () => ({ lng: 181 });
    map.project.mockReturnValue({ x: 0, y: 280 });
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lng: -179 }]} />));
    expect(map.project).toHaveBeenLastCalledWith([181, markers[0].lat]);
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });

  it("defers offscreen filter updates until a trackpad gesture ends", async () => {
    await mount(); map.project.mockReturnValue({ x: -100, y: -100 });
    map.getCanvasContainer().dispatchEvent(new WheelEvent("wheel", { deltaY: 4 }));
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentKey="friends" />));
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    await act(async () => map.emit("moveend"));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    await act(async () => map.emit("moveend"));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });
  it("defers later progressive content updates until their batch settles", async () => {
    await mount(); map.project.mockReturnValue({ x: -100, y: -100 });
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 49 }]} cameraContentSettled={false} />));
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 50 }]} cameraContentSettled={false} />));
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<MapSurface markers={[{ ...markers[0], lat: 50 }]} cameraContentSettled />));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });
  it("ignores a stale movement handler after map remount", async () => {
    await mount();
    const staleMove = map.on.mock.calls.find(([event]) => event === "movestart")![1];
    await act(async () => root!.render(<MapSurface markers={markers} interactive={false} />));
    await act(async () => root!.render(<MapSurface markers={markers} interactive />));
    map.project.mockReturnValue({ x: -100, y: -100 });
    await act(async () => staleMove({ originalEvent: new Event("wheel") }));
    await act(async () => root!.render(<MapSurface markers={markers} cameraContentKey="friends" />));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });

  it("preserves the map through recoverable errors and removes its handlers on unmount", async () => {
    await mount();
    await act(async () => { vi.runOnlyPendingTimers(); map.emit("idle"); });
    const canvas = map.getCanvas();
    await act(async () => {
      map.emit("error", { error: new Error("tile unavailable"), sourceId: "openmaptiles" });
      map.emit("error", { error: new Error("glyph unavailable") });
      map.emit("webglcontextlost"); map.emit("webglcontextrestored");
    });
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(container.querySelector(".freed-map-fallback-scan")).toBeNull();
    expect(map.remove).not.toHaveBeenCalled();
    map.getCanvasContainer().dispatchEvent(new WheelEvent("wheel", { deltaX: 4, deltaY: 2 }));
    expect(map.panBy).toHaveBeenCalledOnce();
    await unmount();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.loseContext).toHaveBeenCalledOnce();
    expect(map.listenerCount()).toBe(0);
    map.getCanvasContainer().dispatchEvent(new WheelEvent("wheel", { deltaY: 3 }));
    expect(map.panBy).toHaveBeenCalledOnce();
  });
  it("activates the location grid when style preparation rejects", async () => {
    lifecycle.style.mockRejectedValue(new Error("style unavailable"));
    await mount();
    expect(lifecycle.construct).not.toHaveBeenCalled();
    expect(container.querySelector(".freed-map-fallback-scan button")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("activates fallback on a constructor exception", async () => {
    lifecycle.construct.mockImplementation(({ container }) => {
      container.append(document.createElement("canvas"));
      throw new Error("renderer construction failed");
    });
    await mount();
    expect(container.querySelector(".freed-map-fallback-scan button")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("clears a partial renderer even when its teardown throws", async () => {
    lifecycle.construct.mockImplementation(({ container }) => {
      map = liveMap(container);
      map.remove.mockImplementation(() => { throw new Error("partial teardown"); });
      return { ...map, painter: undefined };
    });
    await mount();
    expect(container.querySelector(".freed-map-fallback-scan button")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    await unmount();
    expect(map.remove).toHaveBeenCalledOnce();
  });
  it("cancels resize and listeners after explicit GPU initialization failure", async () => {
    const { GPUInitializationError } = await import("maplibre-gl");
    await mount();
    await act(async () => {
      map.emit("error", { error: new GPUInitializationError({}, null) });
      vi.runOnlyPendingTimers();
    });
    expect(container.querySelector(".freed-map-fallback-scan button")).not.toBeNull();
    expect(map.resize).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
    await unmount();
    expect(map.remove).toHaveBeenCalledOnce();
  });
  it("cancels the queued initial resize on ordinary unmount", async () => {
    await mount(); await unmount();
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(map.resize).not.toHaveBeenCalled();
    expect(map.remove).toHaveBeenCalledOnce();
  });
  it("ignores obsolete preparation failures after a new lifecycle mounts", async () => {
    let reject!: (reason: Error) => void;
    lifecycle.style.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await mount();
    await act(async () => { root!.render(<MapSurface markers={markers} interactive={false} />); });
    await act(async () => { reject(new Error("obsolete style request")); });
    expect(container.querySelector("canvas")).toBe(map.getCanvas());
    expect(container.querySelector(".freed-map-fallback-scan")).toBeNull();
    expect(map.remove).not.toHaveBeenCalled();
  });
});
