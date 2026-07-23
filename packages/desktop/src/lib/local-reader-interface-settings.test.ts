import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_CARD_DENSITY,
  getFeedCardDensity,
  resetFeedCardDensity,
  setFeedCardDensity,
} from "@freed/ui/lib/feed-card-density";
import {
  getInterfaceZoom,
  INTERFACE_ZOOM_DEFAULT,
  resetInterfaceZoom,
  setInterfaceZoom,
} from "@freed/ui/lib/interface-zoom";
describe("local reader and interface settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.fontSize = "";
    delete document.documentElement.dataset.interfaceZoom;
  });

  it("removes device-specific interface choices during a reset", () => {
    setFeedCardDensity("compact");
    setInterfaceZoom(150);

    resetFeedCardDensity();
    resetInterfaceZoom();

    expect(getFeedCardDensity()).toBe(DEFAULT_FEED_CARD_DENSITY);
    expect(getInterfaceZoom()).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(window.localStorage).toHaveLength(0);
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement.dataset.interfaceZoom).toBe(
      String(INTERFACE_ZOOM_DEFAULT),
    );
  });
});
