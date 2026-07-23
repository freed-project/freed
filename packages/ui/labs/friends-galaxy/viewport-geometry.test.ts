import { describe, expect, it } from "vitest";
import {
  friendsGalaxyViewportGeometry,
  reanchorFriendsGalaxyTransformToInteraction,
  writeFriendsGalaxyCanvasPoint,
} from "../../src/lib/friends-galaxy-viewport.js";

describe("Friends Galaxy full-canvas viewport geometry", () => {
  it("derives bounded interaction insets inside a larger canvas", () => {
    const geometry = friendsGalaxyViewportGeometry(
      { left: 40, top: 80, width: 1_440, height: 900 },
      { left: 360, top: 124, width: 840, height: 736 },
    );

    expect(geometry).toEqual({
      canvasClientLeft: 40,
      canvasClientTop: 80,
      canvasWidth: 1_440,
      canvasHeight: 900,
      interactionLeft: 320,
      interactionTop: 44,
      interactionWidth: 840,
      interactionHeight: 736,
      interactionCenterX: 740,
      interactionCenterY: 412,
      insets: { top: 44, right: 280, bottom: 120, left: 320 },
    });
  });

  it("keeps client input in full-canvas coordinates", () => {
    const geometry = friendsGalaxyViewportGeometry(
      { left: 40, top: 80, width: 1_440, height: 900 },
      { left: 360, top: 124, width: 840, height: 736 },
    );
    const point = writeFriendsGalaxyCanvasPoint({ x: 0, y: 0 }, geometry, 560, 324);

    expect(point).toEqual({ x: 520, y: 244 });
    expect(point.x - geometry.interactionLeft).toBe(200);
    expect(point.y - geometry.interactionTop).toBe(200);
  });

  it("clips an interaction rectangle to the renderable canvas", () => {
    const geometry = friendsGalaxyViewportGeometry(
      { left: 100, top: 50, width: 800, height: 600 },
      { left: 40, top: 20, width: 940, height: 700 },
    );

    expect(geometry.interactionLeft).toBe(0);
    expect(geometry.interactionTop).toBe(0);
    expect(geometry.interactionWidth).toBe(800);
    expect(geometry.interactionHeight).toBe(600);
    expect(geometry.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("keeps the same world point under a changed interaction center", () => {
    const desktop = friendsGalaxyViewportGeometry(
      { left: 0, top: 0, width: 1_280, height: 720 },
      { left: 356, top: 0, width: 924, height: 720 },
    );
    const compact = friendsGalaxyViewportGeometry(
      { left: 0, top: 0, width: 390, height: 844 },
      { left: 0, top: 0, width: 390, height: 844 },
    );
    const transform = { x: 218, y: -120, scale: 0.6 };
    const worldX = (desktop.interactionCenterX - transform.x) / transform.scale;
    const worldY = (desktop.interactionCenterY - transform.y) / transform.scale;

    reanchorFriendsGalaxyTransformToInteraction(transform, desktop, compact);

    expect(worldX * transform.scale + transform.x).toBeCloseTo(
      compact.interactionCenterX,
      12,
    );
    expect(worldY * transform.scale + transform.y).toBeCloseTo(
      compact.interactionCenterY,
      12,
    );
  });

  it("uses zero insets when canvas and interaction lanes match", () => {
    const geometry = friendsGalaxyViewportGeometry(
      { left: 0, top: 0, width: 390, height: 844 },
      { left: 0, top: 0, width: 390, height: 844 },
    );

    expect(geometry.interactionWidth).toBe(390);
    expect(geometry.interactionHeight).toBe(844);
    expect(geometry.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
