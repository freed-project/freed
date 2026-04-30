/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAnimationIntensityToDocument } from "./animation-preferences.js";
import { runFeedLayoutTransition } from "./view-transitions.js";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

afterEach(() => {
  applyAnimationIntensityToDocument("detailed");
  document.documentElement.classList.remove("feed-layout-transition");
  delete (document as ViewTransitionDocument).startViewTransition;
});

describe("runFeedLayoutTransition", () => {
  it("runs a view transition for detailed animation", () => {
    applyAnimationIntensityToDocument("detailed");
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    (document as ViewTransitionDocument).startViewTransition = startViewTransition;

    runFeedLayoutTransition(update);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("feed-layout-transition")).toBe(true);
  });

  it("runs a shorter view transition for light animation", () => {
    applyAnimationIntensityToDocument("light");
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    (document as ViewTransitionDocument).startViewTransition = startViewTransition;

    runFeedLayoutTransition(update);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.animation).toBe("light");
  });

  it("bypasses view transitions when animation is none", () => {
    applyAnimationIntensityToDocument("none");
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    (document as ViewTransitionDocument).startViewTransition = startViewTransition;

    runFeedLayoutTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("feed-layout-transition")).toBe(false);
  });
});
