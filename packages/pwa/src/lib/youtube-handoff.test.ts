import { describe, expect, it, vi } from "vitest";

import { openPwaUrl } from "./youtube-handoff";

function navigation() {
  return { assign: vi.fn(), open: vi.fn() };
}

describe("PWA YouTube handoff", () => {
  it("keeps exact YouTube watch and playlist links in the user navigation", () => {
    const watchNavigation = navigation();
    openPwaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", watchNavigation);
    expect(watchNavigation.assign).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(watchNavigation.open).not.toHaveBeenCalled();

    const playlistNavigation = navigation();
    openPwaUrl("https://www.youtube.com/playlist?list=playlist-1", playlistNavigation);
    expect(playlistNavigation.assign).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=playlist-1",
    );
  });

  it("does not treat deceptive YouTube subdomains as an app handoff", () => {
    const browserNavigation = navigation();
    openPwaUrl("https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ", browserNavigation);
    expect(browserNavigation.assign).not.toHaveBeenCalled();
    expect(browserNavigation.open).toHaveBeenCalledWith(
      "https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ",
      "_blank",
      "noopener,noreferrer",
    );

    const insecureNavigation = navigation();
    openPwaUrl("http://youtube.com/watch?v=dQw4w9WgXcQ", insecureNavigation);
    expect(insecureNavigation.assign).not.toHaveBeenCalled();
  });
});
