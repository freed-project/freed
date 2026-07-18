import { describe, expect, it } from "vitest";
import {
  galaxyLabGraphDescription,
  galaxyLabRecoveryAnnouncement,
  galaxyLabSelectionAnnouncement,
  galaxyLabUnavailableAnnouncement,
} from "./accessibility.js";

describe("Friends Galaxy accessibility copy", () => {
  it("describes the bounded camera controls without creating a star roster", () => {
    expect(galaxyLabGraphDescription(null, false)).toBe(
      "Interactive Friends Galaxy. Use arrow keys to pan, plus and minus to zoom, Home or zero to fit, Enter to open details, Shift plus F10 to open actions, and Escape to clear selection.",
    );
  });

  it("adds the selected label and reduced-motion state to the graph description", () => {
    expect(galaxyLabGraphDescription("Keira Davenport", true)).toBe(
      "Interactive Friends Galaxy. Selected Keira Davenport. Use arrow keys to pan, plus and minus to zoom, Home or zero to fit, Enter to open details, Shift plus F10 to open actions, and Escape to clear selection. Ambient animation is reduced.",
    );
  });

  it("keeps selection, focus, and clear announcements concise", () => {
    expect(galaxyLabSelectionAnnouncement("Keira Davenport", "selection")).toBe(
      "Keira Davenport selected.",
    );
    expect(galaxyLabSelectionAnnouncement("Keira Davenport", "focus")).toBe(
      "Keira Davenport focused and selected.",
    );
    expect(galaxyLabSelectionAnnouncement(null, "selection")).toBe(
      "Selection cleared.",
    );
  });

  it("announces bounded recovery state without renderer error text", () => {
    expect(galaxyLabRecoveryAnnouncement("WebGL2 fallback")).toBe(
      "Friends Galaxy recovered with WebGL2 fallback.",
    );
    expect(galaxyLabUnavailableAnnouncement()).toBe(
      "Friends Galaxy renderer unavailable.",
    );
  });

  it("normalizes empty and oversized labels", () => {
    expect(galaxyLabSelectionAnnouncement("   ", "selection")).toBe(
      "Galaxy item selected.",
    );
    expect(galaxyLabRecoveryAnnouncement("   ")).toBe(
      "Friends Galaxy recovered with the compatibility renderer.",
    );
    const oversizedAnnouncement = galaxyLabRecoveryAnnouncement(
      "R".repeat(240),
    );
    expect(oversizedAnnouncement).toMatch(
      /^Friends Galaxy recovered with R+\.$/,
    );
    expect(oversizedAnnouncement.length).toBeLessThan(200);
  });
});
