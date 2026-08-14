import {
  getThemeDefinition,
  type ThemeId,
  type ThemeMapPalette,
} from "@freed/shared/themes";
import type { StyleSpecification } from "maplibre-gl";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAP_VECTOR_SOURCE_URL = "https://tiles.openfreemap.org/planet";
const MAP_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

type MapStyleLayer = StyleSpecification["layers"][number] & {
  paint?: Record<string, unknown>;
};

type MapStyle = StyleSpecification;

let baseStyleLoader: Promise<MapStyle> | null = null;
const themedStyleCache = new Map<ThemeId, Promise<MapStyle>>();

function cloneStyle(style: MapStyle): MapStyle {
  if (typeof structuredClone === "function") {
    return structuredClone(style);
  }

  return JSON.parse(JSON.stringify(style)) as MapStyle;
}

function setPaint(layer: MapStyleLayer, property: string, value: unknown) {
  layer.paint = {
    ...(layer.paint ?? {}),
    [property]: value,
  };
}

function applyLabelPaint(
  layer: MapStyleLayer,
  textColor: string,
  haloColor: string,
) {
  setPaint(layer, "text-color", textColor);
  setPaint(layer, "text-halo-color", haloColor);
}

function isMajorRoadLayer(id: string): boolean {
  return (
    id.includes("motorway") ||
    id.includes("highway_major") ||
    id.includes("major")
  );
}

function isMinorRoadLayer(id: string): boolean {
  return (
    id.includes("highway_minor") ||
    id.includes("highway_path") ||
    id.includes("railway") ||
    id.includes("tunnel") ||
    id.includes("aeroway") ||
    id.includes("road") ||
    id.includes("pier")
  );
}

function rethemeLayer(layer: MapStyleLayer, palette: ThemeMapPalette) {
  const id = layer.id.toLowerCase();

  if (layer.type === "background" && id === "background") {
    setPaint(layer, "background-color", palette.background);
    return;
  }

  if (layer.type === "symbol") {
    if (id.startsWith("water_name") || id === "waterway_line_label") {
      applyLabelPaint(layer, palette.labelWater, palette.labelHalo);
      return;
    }

    if (
      id.startsWith("label_country") ||
      id.startsWith("label_city") ||
      id === "airport"
    ) {
      applyLabelPaint(layer, palette.labelStrong, palette.labelHalo);
      return;
    }

    if (id.startsWith("label_") || id.startsWith("highway-name")) {
      applyLabelPaint(layer, palette.labelSoft, palette.labelHalo);
    }
    return;
  }

  if (layer.type === "fill" && id === "water") {
    setPaint(layer, "fill-color", palette.water);
    return;
  }

  if (layer.type === "fill" && id === "park") {
    setPaint(layer, "fill-color", palette.park);
    return;
  }

  if (layer.type === "fill" && id.includes("wood")) {
    setPaint(layer, "fill-color", palette.wood);
    return;
  }

  if (layer.type === "fill" && id.includes("residential")) {
    setPaint(layer, "fill-color", palette.residential);
    return;
  }

  if (
    layer.type === "fill" &&
    (id.includes("ice_shelf") || id.includes("glacier"))
  ) {
    setPaint(layer, "fill-color", palette.residential);
    return;
  }

  if (layer.type === "fill" && id.startsWith("building")) {
    setPaint(layer, "fill-color", palette.building);
    setPaint(layer, "fill-outline-color", palette.building);
    return;
  }

  if (layer.type === "line" && id.startsWith("boundary_")) {
    setPaint(layer, "line-color", palette.boundary);
    return;
  }

  if (layer.type === "line" && id.startsWith("waterway")) {
    setPaint(layer, "line-color", palette.labelWater);
    return;
  }

  if (isMajorRoadLayer(id)) {
    if (layer.type === "fill") {
      setPaint(layer, "fill-color", palette.roadsMajor);
      return;
    }

    if (layer.type !== "line") {
      return;
    }

    setPaint(layer, "line-color", palette.roadsMajor);
    return;
  }

  if (isMinorRoadLayer(id)) {
    if (layer.type === "fill") {
      setPaint(layer, "fill-color", palette.roadsMinor);
      return;
    }

    if (layer.type !== "line") {
      return;
    }

    setPaint(layer, "line-color", palette.roadsMinor);
    return;
  }
}

function applyPaletteToStyle(
  style: MapStyle,
  palette: ThemeMapPalette,
): MapStyle {
  const themedStyle = cloneStyle(style);

  themedStyle.layers = themedStyle.layers.map((layer) => {
    rethemeLayer(layer, palette);
    return layer;
  });

  return themedStyle;
}

/**
 * A small bundled style keeps the geographic map functional when the remote
 * style document is temporarily unavailable. It deliberately references the
 * same vector source and glyph service as the preferred OpenFreeMap style, so
 * it is a startup fallback rather than a second map provider.
 */
function createBundledMapStyle(): MapStyle {
  return {
    version: 8,
    glyphs: MAP_GLYPHS_URL,
    sources: {
      openmaptiles: {
        type: "vector",
        url: MAP_VECTOR_SOURCE_URL,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f2f3f0" },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": "#e6e9e5" },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": "#c2c8ca" },
      },
      {
        id: "boundary_2",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["==", ["get", "admin_level"], 2],
        paint: { "line-color": "#b3b3b3", "line-width": 1 },
      },
      {
        id: "highway_major_inner",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary", "secondary", "tertiary"],
          true,
          false,
        ],
        paint: { "line-color": "#ffffff", "line-width": 1.5 },
      },
      {
        id: "label_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "city"],
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#333333",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      },
    ],
  };
}

async function loadBaseMapStyle(): Promise<MapStyle> {
  if (baseStyleLoader) return baseStyleLoader;

  baseStyleLoader = fetch(MAP_STYLE_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Map style request failed with ${response.status}`);
      }

      return (await response.json()) as MapStyle;
    })
    .catch((error) => {
      console.warn(
        "[MapSurface] Remote map style unavailable; using bundled geographic style",
        error,
      );
      return createBundledMapStyle();
    });

  return baseStyleLoader;
}

export async function buildThemedMapStyle(themeId: ThemeId): Promise<MapStyle> {
  const existing = themedStyleCache.get(themeId);
  if (existing) {
    return await existing.then((style) => cloneStyle(style));
  }

  const palette = getThemeDefinition(themeId).map;
  const themedStyle = loadBaseMapStyle()
    .then((style) => applyPaletteToStyle(style, palette))
    .catch((error) => {
      themedStyleCache.delete(themeId);
      throw error;
    });

  themedStyleCache.set(themeId, themedStyle);
  return await themedStyle.then((style) => cloneStyle(style));
}
