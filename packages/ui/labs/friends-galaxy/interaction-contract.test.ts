import { describe, expect, it } from "vitest";
import {
  GalaxyLabLongPressTracker,
  galaxyLabContextTarget,
  galaxyLabKeyboardCommand,
} from "./interaction-contract.js";
import { galaxyLabViewportGeometry } from "./viewport-geometry.js";

describe("Friends Galaxy engine-to-overlay interaction contract", () => {
  const geometry = galaxyLabViewportGeometry(
    { left: 0, top: 0, width: 1_280, height: 720 },
    { left: 356, top: 0, width: 924, height: 720 },
  );

  it("returns bounded interaction anchors and unmodified plane coordinates", () => {
    const target = galaxyLabContextTarget(
      "person:lab-person-4999",
      "pointer",
      1_400,
      -40,
      { x: 218, y: -120, scale: 0.6 },
      geometry,
    );

    expect(target).toEqual({
      nodeId: "person:lab-person-4999",
      source: "pointer",
      canvasX: 1_270,
      canvasY: 10,
      interactionX: 914,
      interactionY: 10,
      worldX: 1_970,
      worldY: 133.33333333333334,
    });
    expect(
      galaxyLabContextTarget(
        "",
        "pointer",
        0,
        0,
        { x: 0, y: 0, scale: 1 },
        geometry,
      ),
    ).toBeNull();
  });

  it("maps camera and selection keys to bounded engine commands", () => {
    expect(galaxyLabKeyboardCommand({ key: "ArrowLeft" })).toEqual({
      type: "pan",
      deltaX: 56,
      deltaY: 0,
    });
    expect(
      galaxyLabKeyboardCommand({ key: "ArrowDown", shiftKey: true }),
    ).toEqual({ type: "pan", deltaX: 0, deltaY: -120 });
    expect(galaxyLabKeyboardCommand({ key: "+" })).toEqual({
      type: "zoom",
      ratio: 1.18,
    });
    expect(galaxyLabKeyboardCommand({ key: "Home" })).toEqual({ type: "fit" });
    expect(galaxyLabKeyboardCommand({ key: "Escape" })).toEqual({
      type: "clear",
    });
  });

  it("resolves details and both keyboard context-menu gestures", () => {
    expect(galaxyLabKeyboardCommand({ key: "Enter" })).toEqual({
      type: "details",
    });
    expect(galaxyLabKeyboardCommand({ key: "F10", shiftKey: true })).toEqual({
      type: "context-menu",
    });
    expect(galaxyLabKeyboardCommand({ key: "ContextMenu" })).toEqual({
      type: "context-menu",
    });
    expect(galaxyLabKeyboardCommand({ key: "F10" })).toBeNull();
    expect(
      galaxyLabKeyboardCommand({ key: "Enter", metaKey: true }),
    ).toBeNull();
  });

  it("activates one stationary long press exactly once", () => {
    const tracker = new GalaxyLabLongPressTracker();
    tracker.begin(7, 420, 240, 1_000);

    expect(tracker.activate(1_479)).toBeNull();
    expect(tracker.activate(1_480)).toEqual({
      pointerId: 7,
      x: 420,
      y: 240,
    });
    expect(tracker.activate(2_000)).toBeNull();
    expect(tracker.isPending).toBe(false);
    expect(tracker.isActivated).toBe(true);
    tracker.release(7);
    expect(tracker.isActivated).toBe(false);
  });

  it("cancels long press after movement beyond the touch threshold", () => {
    const tracker = new GalaxyLabLongPressTracker();
    tracker.begin(4, 100, 100, 0);

    expect(tracker.move(4, 102, 103)).toBe(true);
    expect(tracker.move(4, 105, 100)).toBe(false);
    expect(tracker.activate(1_000)).toBeNull();
  });

  it("cancels a pending press on release or explicit multi-touch cancellation", () => {
    const tracker = new GalaxyLabLongPressTracker();
    tracker.begin(9, 200, 300, 0);
    expect(tracker.move(8, 900, 900)).toBe(false);
    expect(tracker.isPending).toBe(true);
    tracker.release(8);
    expect(tracker.isPending).toBe(true);
    tracker.release(9);
    expect(tracker.isPending).toBe(false);

    tracker.begin(10, 200, 300, 0);
    tracker.cancel();
    expect(tracker.activate(1_000)).toBeNull();
  });
});
