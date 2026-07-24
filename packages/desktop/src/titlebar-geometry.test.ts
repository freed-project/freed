import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOP_TOOLBAR_HEIGHT_PX } from "../../ui/src/components/layout/layoutConstants";

type TauriWindowConfig = {
  app?: {
    windows?: Array<{
      titleBarStyle?: string;
      decorations?: boolean;
      trafficLightPosition?: {
        x?: number;
        y?: number;
      };
    }>;
  };
};

const TAURI_TRAFFIC_LIGHT_CENTER_ADJUSTMENT_PX = 2;

describe("macOS titlebar geometry", () => {
  it("centers the native stoplight row in the shared top toolbar", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
    ) as TauriWindowConfig;
    const mainWindow = config.app?.windows?.[0];

    expect(mainWindow?.titleBarStyle).toBe("Overlay");
    expect(mainWindow?.decorations).toBe(true);
    // Tauri 2.9 uses this y value to size AppKit's titlebar container, not as
    // the row's center coordinate. A real Retina capture puts y 28 at the
    // 26 px centerline of Freed's 52 px toolbar.
    expect(mainWindow?.trafficLightPosition?.y).toBe(
      TOP_TOOLBAR_HEIGHT_PX / 2 + TAURI_TRAFFIC_LIGHT_CENTER_ADJUSTMENT_PX,
    );
  });
});
