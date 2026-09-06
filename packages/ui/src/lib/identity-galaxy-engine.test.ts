import { describe, expect, it, vi } from "vitest";
import { galaxyLabelVisibilityPolicy, IdentityGalaxyEngine } from "./identity-galaxy-engine.js";
import { createGalaxyLabFixture } from "../../labs/friends-galaxy/scene-fixture.js";

describe("galaxy label visibility", () => {
  it("draws only supplied decoded portraits in the canvas fallback without rebuilding during camera frames", () => {
    const drawImage = vi.fn();
    const context = new Proxy({ drawImage, globalAlpha: 1 }, {
      get(target, key) { return key in target ? Reflect.get(target, key) : () => undefined; },
    });
    const canvas = { clientWidth: 800, clientHeight: 600, width: 800, height: 600,
      getContext: (kind: string) => kind === "2d" ? context : null } as unknown as HTMLCanvasElement;
    const createElement = vi.fn(() => ({ width: 1, height: 1, getContext: () => context }));
    vi.stubGlobal("document", { documentElement: {}, createElement });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "", fontFamily: "sans-serif" }));
    vi.stubGlobal("window", { devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
    const fixture = createGalaxyLabFixture({ personCount: 2, accountCount: 2, backgroundStarCount: 0 });
    const engine = new IdentityGalaxyEngine(canvas, null);
    try {
      engine.syncScene({ ...fixture.atlas, labels: [], regions: [] }, fixture.scene,
        { variation: "nebula", quality: "settled", decorativeStarCount: 0 });
      const nodeId = fixture.scene.nodeIds.find((_, index) => fixture.scene.personIds[index])!;
      engine.setAvatarImages(new Map([[nodeId, { width: 64, height: 64 } as CanvasImageSource]]));
      engine.render({ x: 400, y: 300, scale: 1 }, 100);
      expect(engine.rendererType).toBe("canvas-starfield-fallback");
      expect(engine.avatarCount).toBe(1);
      expect(drawImage).toHaveBeenCalled();
      const atlasBuilds = createElement.mock.calls.length;
      engine.render({ x: 410, y: 305, scale: 1.1 }, 116);
      expect(createElement).toHaveBeenCalledTimes(atlasBuilds);
      expect(context.globalAlpha).toBe(1);
      engine.setAvatarImages(new Map());
      engine.render({ x: 410, y: 305, scale: 1.1 }, 132);
      expect(engine.avatarCount).toBe(0);
      expect(engine.hasActivePresentationTransition).toBe(false);
    } finally { engine.dispose(); vi.unstubAllGlobals(); }
  });
  it.each(["three-starfield", "canvas-starfield-fallback"] as const)(
    "keeps every detail label without selection in %s",
    (renderer) => {
      for (const width of [390, 1280]) {
        expect(galaxyLabelVisibilityPolicy("detail", width, renderer)).toEqual({
          cap: Infinity,
          suppressOverlaps: false,
        });
      }
    },
  );

  it("preserves distant-cloud caps and collision suppression", () => {
    for (const lod of ["overview", "middle"] as const) {
      expect(galaxyLabelVisibilityPolicy(lod, 390, "three-starfield")).toEqual({ cap: 24, suppressOverlaps: true });
      expect(galaxyLabelVisibilityPolicy(lod, 1280, "three-starfield")).toEqual({ cap: 96, suppressOverlaps: true });
      expect(galaxyLabelVisibilityPolicy(lod, 1280, "canvas-starfield-fallback")).toEqual({ cap: 72, suppressOverlaps: true });
    }
  });
});
