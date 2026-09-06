import { afterEach, describe, expect, it, vi } from "vitest";
import { cropDecodedGalaxyAvatar } from "./friends-galaxy-avatar-crop.js";

// Tier 1: deterministic source geometry and bounded decoded-avatar residency.
// Inputs: source dimensions, reviewed focal metadata and the fixed output size.
describe("decoded galaxy avatar crop", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fixture() {
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }) };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    return { canvas, drawImage, createElement, image: {} as CanvasImageSource };
  }

  it("covers landscape and portrait sources without stretching, at a fixed bound", () => {
    const { canvas, drawImage, image } = fixture();
    expect(cropDecodedGalaxyAvatar(image, 1200, 800)).toBe(canvas);
    expect(drawImage).toHaveBeenLastCalledWith(image, 200, 0, 800, 800, 0, 0, 256, 256);
    cropDecodedGalaxyAvatar(image, 800, 1200);
    expect(drawImage).toHaveBeenLastCalledWith(image, 0, 200, 800, 800, 0, 0, 256, 256);
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
  });

  it("keeps Ada's reviewed starfish crop left of the neighboring urchin", () => {
    const { drawImage, image } = fixture();
    cropDecodedGalaxyAvatar(image, 1280, 853, { x: 0.27, y: 0.5, zoom: 1.3 });
    const [, left, top, width, height] = drawImage.mock.calls[0]!;
    expect(left).toBeCloseTo(17.5230769);
    expect(top).toBeCloseTo(98.4230769);
    expect(width).toBeCloseTo(656.1538462);
    expect(height).toBe(width);
  });

  it("defaults invalid metadata, clamps edges and rejects invalid source dimensions", () => {
    const { drawImage, image, createElement } = fixture();
    cropDecodedGalaxyAvatar(image, 1000, 500, { x: NaN, y: Infinity, zoom: NaN });
    expect(drawImage).toHaveBeenLastCalledWith(image, 250, 0, 500, 500, 0, 0, 256, 256);
    cropDecodedGalaxyAvatar(image, 1000, 500, { x: -1, y: 2, zoom: 100 });
    expect(drawImage).toHaveBeenLastCalledWith(image, 0, 375, 125, 125, 0, 0, 256, 256);
    expect(() => cropDecodedGalaxyAvatar(image, 0, 500)).toThrow("invalid dimensions");
    expect(createElement).toHaveBeenCalledTimes(2);
  });
});
