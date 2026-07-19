import { describe, expect, it } from "vitest";
import {
  friendsGalaxyGraphDescription,
  friendsGalaxyRecoveryAnnouncement,
  friendsGalaxySelectionAnnouncement,
  friendsGalaxyUnavailableAnnouncement,
} from "../../src/lib/friends-galaxy-accessibility.js";

describe("Friends Galaxy accessibility copy", () => {
  it("describes the bounded camera controls without creating a star roster", () => {
    expect(friendsGalaxyGraphDescription(null, false)).toBe(
      "Interactive Friends Galaxy. Use arrow keys to pan, plus and minus to zoom, Home or zero to fit, Enter to open details, Shift plus F10 to open actions, and Escape to clear selection.",
    );
  });

  it("adds the selected label and reduced-motion state to the graph description", () => {
    expect(friendsGalaxyGraphDescription("Keira Davenport", true)).toBe(
      "Interactive Friends Galaxy. Selected Keira Davenport. Use arrow keys to pan, plus and minus to zoom, Home or zero to fit, Enter to open details, Shift plus F10 to open actions, and Escape to clear selection. Ambient animation is reduced.",
    );
  });

  it("keeps selection, focus, and clear announcements concise", () => {
    expect(friendsGalaxySelectionAnnouncement("Keira Davenport", "selection")).toBe(
      "Keira Davenport selected.",
    );
    expect(friendsGalaxySelectionAnnouncement("Keira Davenport", "focus")).toBe(
      "Keira Davenport focused and selected.",
    );
    expect(friendsGalaxySelectionAnnouncement(null, "selection")).toBe(
      "Selection cleared.",
    );
  });

  it("announces bounded recovery state without renderer error text", () => {
    expect(friendsGalaxyRecoveryAnnouncement("WebGL2 fallback")).toBe(
      "Friends Galaxy recovered with WebGL2 fallback.",
    );
    expect(friendsGalaxyUnavailableAnnouncement()).toBe(
      "Friends Galaxy renderer unavailable.",
    );
  });

  it("normalizes empty and oversized labels", () => {
    expect(friendsGalaxySelectionAnnouncement("   ", "selection")).toBe(
      "Galaxy item selected.",
    );
    expect(friendsGalaxyRecoveryAnnouncement("   ")).toBe(
      "Friends Galaxy recovered with the compatibility renderer.",
    );
    const oversizedAnnouncement = friendsGalaxyRecoveryAnnouncement(
      "R".repeat(240),
    );
    expect(oversizedAnnouncement).toMatch(
      /^Friends Galaxy recovered with R+\.$/,
    );
    expect(oversizedAnnouncement.length).toBeLessThan(200);
  });
});
