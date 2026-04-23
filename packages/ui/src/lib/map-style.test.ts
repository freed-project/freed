import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThemeDefinition, type ThemeId } from "@freed/shared/themes";

const STYLE_FIXTURE = {
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#fff" } },
    { id: "water", type: "fill", paint: { "fill-color": "#fff" } },
    { id: "park", type: "fill", paint: { "fill-color": "#fff" } },
    { id: "landcover_wood", type: "fill", paint: { "fill-color": "#fff" } },
    { id: "landuse_residential", type: "fill", paint: { "fill-color": "#fff" } },
    { id: "building", type: "fill", paint: { "fill-color": "#fff", "fill-outline-color": "#fff" } },
    { id: "highway_minor", type: "line", paint: { "line-color": "#fff" } },
    { id: "highway_major_inner", type: "line", paint: { "line-color": "#fff" } },
    { id: "boundary_2", type: "line", paint: { "line-color": "#fff" } },
    { id: "waterway", type: "line", paint: { "line-color": "#fff" } },
    { id: "waterway_line_label", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "water_name_line_label", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "highway-name-major", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "road_shield_us", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "label_city", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "label_state", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
    { id: "airport", type: "symbol", paint: { "text-color": "#fff", "text-halo-color": "#000" } },
  ],
};

function responseWithStyle(style = STYLE_FIXTURE): Response {
  return {
    ok: true,
    json: async () => structuredClone(style),
  } as Response;
}

async function loadBuilder() {
  vi.resetModules();
  return await import("./map-style.js");
}

function layerPaint(style: { layers: Array<{ id: string; paint?: Record<string, unknown> }> }, layerId: string) {
  const layer = style.layers.find((entry) => entry.id === layerId);
  return layer?.paint ?? {};
}

describe("buildThemedMapStyle", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites core map layers for every theme palette", async () => {
    const fetchMock = vi.fn(async () => responseWithStyle());
    vi.stubGlobal("fetch", fetchMock);

    const { buildThemedMapStyle } = await loadBuilder();
    const themeIds: ThemeId[] = ["neon", "ember", "midas", "scriptorium"];

    for (const themeId of themeIds) {
      const style = await buildThemedMapStyle(themeId);
      const palette = getThemeDefinition(themeId).map;

      expect(layerPaint(style, "background")["background-color"]).toBe(palette.background);
      expect(layerPaint(style, "water")["fill-color"]).toBe(palette.water);
      expect(layerPaint(style, "park")["fill-color"]).toBe(palette.park);
      expect(layerPaint(style, "landcover_wood")["fill-color"]).toBe(palette.wood);
      expect(layerPaint(style, "landuse_residential")["fill-color"]).toBe(palette.residential);
      expect(layerPaint(style, "building")["fill-color"]).toBe(palette.building);
      expect(layerPaint(style, "building")["fill-outline-color"]).toBe(palette.building);
      expect(layerPaint(style, "highway_minor")["line-color"]).toBe(palette.roadsMinor);
      expect(layerPaint(style, "highway_major_inner")["line-color"]).toBe(palette.roadsMajor);
      expect(layerPaint(style, "boundary_2")["line-color"]).toBe(palette.boundary);
      expect(layerPaint(style, "waterway")["line-color"]).toBe(palette.labelWater);
      expect(layerPaint(style, "waterway_line_label")["text-color"]).toBe(palette.labelWater);
      expect(layerPaint(style, "water_name_line_label")["text-color"]).toBe(palette.labelWater);
      expect(layerPaint(style, "highway-name-major")["text-color"]).toBe(palette.labelSoft);
      expect(layerPaint(style, "road_shield_us")["line-color"]).toBeUndefined();
      expect(layerPaint(style, "label_city")["text-color"]).toBe(palette.labelStrong);
      expect(layerPaint(style, "label_state")["text-color"]).toBe(palette.labelSoft);
      expect(layerPaint(style, "airport")["text-color"]).toBe(palette.labelStrong);
      expect(layerPaint(style, "label_city")["text-halo-color"]).toBe(palette.labelHalo);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not attach line paint to symbol layers that only share road-like ids", async () => {
    const fetchMock = vi.fn(async () => responseWithStyle());
    vi.stubGlobal("fetch", fetchMock);

    const { buildThemedMapStyle } = await loadBuilder();
    const style = await buildThemedMapStyle("neon");

    expect(layerPaint(style, "waterway_line_label")["line-color"]).toBeUndefined();
    expect(layerPaint(style, "highway-name-major")["line-color"]).toBeUndefined();
    expect(layerPaint(style, "road_shield_us")["line-color"]).toBeUndefined();
  });
});
