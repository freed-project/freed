import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { LocationMarkerSummary } from "@freed/shared";
import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "@freed/shared/themes";
import { createMarkerElement } from "./MarkerElement.js";
import { createFriendAvatarPalette } from "../../lib/friend-avatar-style.js";
import { buildThemedMapStyle } from "../../lib/map-style.js";

type PopupInstance = {
  remove: () => void;
  setDOMContent: (node: HTMLElement) => PopupInstance;
  setLngLat: (coordinates: [number, number]) => PopupInstance;
  addTo: (map: MapInstance) => PopupInstance;
};

type MarkerInstance = {
  setLngLat: (coordinates: [number, number]) => MarkerInstance;
  setPopup: (popup: PopupInstance) => MarkerInstance;
  addTo: (map: MapInstance) => MarkerInstance;
  remove: () => void;
  getElement: () => HTMLElement;
  togglePopup: () => void;
};

type MapInstance = {
  remove: () => void;
  resize: () => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: unknown) => void;
  flyTo: (options: { center: [number, number]; zoom?: number; duration?: number }) => void;
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
};

type MapLibreModule = {
  Map: new (options: unknown) => MapInstance;
  Marker: new (options: { element: HTMLElement }) => MarkerInstance;
  Popup: new (options?: unknown) => PopupInstance;
};

interface MapSurfaceProps {
  markers: LocationMarkerSummary[];
  focusedMarkerKey?: string | null;
  interactive?: boolean;
  themeId?: ThemeId;
  onOpenFriend?: (marker: LocationMarkerSummary) => void;
  onPromoteAccount?: (marker: LocationMarkerSummary) => void;
  onLinkAccount?: (marker: LocationMarkerSummary) => void;
  onOpenPost?: (marker: LocationMarkerSummary) => void;
  emptyTitle?: string;
  emptyBody?: string;
}

const MAPLIBRE_MODULE_PATH =
  new URL(
    "../../../../../node_modules/maplibre-gl/dist/maplibre-gl.js",
    import.meta.url
  ).href;
const MAPLIBRE_CSS_PATH =
  new URL(
    "../../../../../node_modules/maplibre-gl/dist/maplibre-gl.css",
    import.meta.url
  ).href;

let mapLibreLoader: Promise<MapLibreModule> | null = null;
let mapLibreCssLoaded = false;
const popupDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MAP_POPUP_MAX_WIDTH = 560;
const MAP_POPUP_VIEWPORT_MARGIN = 40;

function shouldForceMapFallback() {
  if (typeof window === "undefined") return false;
  return (
    (
      window as Window & {
        __FREED_E2E_FORCE_MAP_FALLBACK__?: boolean;
      }
    ).__FREED_E2E_FORCE_MAP_FALLBACK__ === true
  );
}

function popupRelativeTime(seenAt: number): string {
  return formatDistanceToNow(seenAt, { addSuffix: true });
}

function popupAbsoluteTime(seenAt: number): string {
  return popupDateFormatter.format(seenAt);
}

function popupSnippet(text?: string | null): string | null {
  if (!text) return null;
  return text.length > 132 ? `${text.slice(0, 132)}...` : text;
}

function popupKicker(marker: LocationMarkerSummary): string {
  if (marker.friend) return "Linked Friend";
  return marker.item.contentType === "story" ? "Story Update" : "Location Update";
}

function popupTitle(marker: LocationMarkerSummary): string {
  return marker.friend?.name ?? marker.item.author.displayName;
}

function popupMeta(marker: LocationMarkerSummary): string {
  return `${popupRelativeTime(marker.seenAt)} · ${popupAbsoluteTime(marker.seenAt)}`;
}

function ensureMapLibreCss() {
  if (typeof document === "undefined" || mapLibreCssLoaded) return;
  const existing = document.querySelector(`link[data-freed-maplibre="true"]`);
  if (existing) {
    mapLibreCssLoaded = true;
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_CSS_PATH;
  link.dataset.freedMaplibre = "true";
  document.head.appendChild(link);
  mapLibreCssLoaded = true;
}

function loadMapLibre(): Promise<MapLibreModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is unavailable"));
  }

  const globalModule = (
    window as Window & { maplibregl?: MapLibreModule }
  ).maplibregl;
  if (globalModule) {
    return Promise.resolve(globalModule);
  }

  if (mapLibreLoader) return mapLibreLoader;

  mapLibreLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MAPLIBRE_MODULE_PATH;
    script.async = true;
    script.onload = () => {
      const loadedModule = (
        window as Window & { maplibregl?: MapLibreModule }
      ).maplibregl;
      if (loadedModule) {
        resolve(loadedModule);
        return;
      }
      reject(new Error("maplibregl global was not initialized"));
    };
    script.onerror = () => reject(new Error("Failed to load maplibre-gl"));
    document.head.appendChild(script);
  });

  return mapLibreLoader;
}

function buildPopupContent(
  marker: LocationMarkerSummary,
  onOpenFriend?: (marker: LocationMarkerSummary) => void,
  onPromoteAccount?: (marker: LocationMarkerSummary) => void,
  onLinkAccount?: (marker: LocationMarkerSummary) => void,
  onOpenPost?: (marker: LocationMarkerSummary) => void
): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:16px",
    `width:min(${MAP_POPUP_MAX_WIDTH}px,calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px))`,
    `min-width:min(420px,calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px))`,
    "max-width:100%",
    "padding:20px",
    "color:var(--theme-text-primary)",
    "font-family:system-ui,sans-serif",
    "box-sizing:border-box",
  ].join(";");

  const badgeRow = document.createElement("div");
  badgeRow.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:14px;";

  const eyebrow = document.createElement("div");
  eyebrow.textContent = popupKicker(marker);
  eyebrow.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "padding:5px 9px",
    "border-radius:999px",
    "border:1px solid var(--theme-border-strong)",
    "background:color-mix(in oklab,var(--theme-accent-secondary) 16%,var(--theme-bg-surface))",
    "font-size:10px",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.14em",
    "color:var(--theme-text-primary)",
  ].join(";");
  badgeRow.appendChild(eyebrow);

  const meta = document.createElement("div");
  meta.textContent = popupMeta(marker);
  meta.style.cssText = "font-size:11px;color:var(--theme-text-muted);white-space:nowrap;text-align:right;padding-top:6px;";
  badgeRow.appendChild(meta);
  root.appendChild(badgeRow);

  const header = document.createElement("div");
  header.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const title = document.createElement("div");
  title.textContent = popupTitle(marker);
  title.style.cssText = "font-size:22px;font-weight:700;color:var(--theme-text-primary);letter-spacing:-0.03em;line-height:1.08;";
  header.appendChild(title);

  if (marker.label) {
    const location = document.createElement("div");
    location.textContent = marker.label;
    location.style.cssText = "font-size:14px;font-weight:600;color:var(--theme-accent-secondary);line-height:1.5;max-width:34ch;";
    header.appendChild(location);
  }
  root.appendChild(header);

  const snippetText = popupSnippet(marker.item.content.text);
  if (snippetText) {
    const snippetCard = document.createElement("div");
    snippetCard.style.cssText = [
      "padding:12px 14px",
      "border-radius:16px",
      "border:1px solid var(--theme-border-subtle)",
      "background:var(--theme-bg-card)",
      "box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.04)",
    ].join(";");

    const snippet = document.createElement("p");
    snippet.textContent = snippetText;
    snippet.style.cssText = "margin:0;font-size:14px;line-height:1.65;color:var(--theme-text-secondary);";
    snippetCard.appendChild(snippet);
    root.appendChild(snippetCard);
  }

  const facts = document.createElement("div");
  facts.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;";

  const updateFact = document.createElement("div");
  updateFact.style.cssText = "padding:10px 12px;border-radius:14px;background:var(--theme-bg-card);border:1px solid var(--theme-border-subtle);";
  updateFact.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:var(--theme-text-muted);margin-bottom:6px;">Seen</div><div style="font-size:13px;font-weight:600;color:var(--theme-text-primary);">${popupRelativeTime(marker.seenAt)}</div>`;
  facts.appendChild(updateFact);

  const sourceFact = document.createElement("div");
  sourceFact.style.cssText = "padding:10px 12px;border-radius:14px;background:var(--theme-bg-card);border:1px solid var(--theme-border-subtle);";
  sourceFact.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:var(--theme-text-muted);margin-bottom:6px;">Source</div><div style="font-size:13px;font-weight:600;color:var(--theme-text-primary);text-transform:capitalize;">${marker.item.platform}</div>`;
  facts.appendChild(sourceFact);
  root.appendChild(facts);

  if (marker.groupCount > 1) {
    const more = document.createElement("div");
    more.textContent = `${marker.groupCount.toLocaleString()} updates from this spot`;
    more.style.cssText = "font-size:11px;color:var(--theme-accent-secondary);";
    root.appendChild(more);
  }

  const actions = document.createElement("div");
  actions.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;";

  if (marker.friend && onOpenFriend) {
    const friendButton = document.createElement("button");
    friendButton.type = "button";
    friendButton.textContent = "Open Friend";
    friendButton.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "border:1px solid var(--theme-border-strong)",
      "background:var(--theme-button-primary-background)",
      "color:var(--theme-button-primary-text)",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "outline:none",
      "width:100%",
      "white-space:nowrap",
      "box-shadow:var(--theme-button-primary-shadow)",
    ].join(";");
    friendButton.addEventListener("click", () => onOpenFriend(marker));
    actions.appendChild(friendButton);
  }

  if (!marker.friend && onPromoteAccount) {
    const promoteButton = document.createElement("button");
    promoteButton.type = "button";
    promoteButton.textContent = "Promote to friend";
    promoteButton.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "border:1px solid var(--theme-border-strong)",
      "background:var(--theme-button-primary-background)",
      "color:var(--theme-button-primary-text)",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "outline:none",
      "width:100%",
      "white-space:nowrap",
      "box-shadow:var(--theme-button-primary-shadow)",
    ].join(";");
    promoteButton.addEventListener("click", () => onPromoteAccount(marker));
    actions.appendChild(promoteButton);
  }

  if (!marker.friend && onLinkAccount) {
    const linkButton = document.createElement("button");
    linkButton.type = "button";
    linkButton.textContent = "Link to existing friend";
    linkButton.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "border:1px solid var(--theme-border-subtle)",
      "background:var(--theme-button-secondary-background)",
      "color:var(--theme-text-primary)",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "outline:none",
      "width:100%",
      "white-space:nowrap",
    ].join(";");
    linkButton.addEventListener("click", () => onLinkAccount(marker));
    actions.appendChild(linkButton);
  }

  if (onOpenPost) {
    const postButton = document.createElement("button");
    postButton.type = "button";
    postButton.textContent = "Open Post";
    postButton.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "border:1px solid var(--theme-border-subtle)",
      "background:var(--theme-button-secondary-background)",
      "color:var(--theme-text-primary)",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "outline:none",
      "width:100%",
      "white-space:nowrap",
    ].join(";");
    postButton.addEventListener("click", () => onOpenPost(marker));
    actions.appendChild(postButton);
  }

  if (actions.childElementCount > 0) {
    root.appendChild(actions);
  }

  return root;
}

function mapStyles(interactive: boolean) {
  return `
    .freed-map-shell {
      position: relative;
      background: transparent;
    }

    .freed-map-shell .maplibregl-map {
      font-family: system-ui, sans-serif;
    }

    .freed-map-shell .maplibregl-control-container,
    .freed-map-shell .maplibregl-ctrl-logo,
    .freed-map-shell .maplibregl-ctrl-attrib {
      display: none !important;
    }

    .freed-map-shell .maplibregl-popup-content {
      width: min(${MAP_POPUP_MAX_WIDTH}px, calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px));
      min-width: min(420px, calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px));
      max-width: none;
      padding: 0;
      background:
        color-mix(in oklab, var(--theme-bg-elevated) 96%, transparent);
      border: 1px solid var(--theme-border-strong);
      border-radius: 24px;
      box-shadow:
        var(--theme-map-popup-shadow),
        0 0 0 1px var(--theme-border-subtle);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .freed-map-shell .maplibregl-popup {
      max-width: min(${MAP_POPUP_MAX_WIDTH}px, calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px)) !important;
    }

    .freed-map-shell .maplibregl-popup-tip {
      display: none !important;
    }

    .freed-map-shell .freed-map-marker {
      ${interactive ? "cursor:pointer;" : "cursor:default;"}
    }

    .freed-map-shell .freed-map-marker-body {
      transition: box-shadow 160ms ease, border-color 160ms ease, filter 160ms ease, scale 160ms ease;
    }

    .freed-map-shell .freed-map-marker:hover .freed-map-marker-body {
      scale: 1.06;
      filter: brightness(1.06);
      box-shadow:
        0 0 0 1px var(--theme-border-strong),
        var(--theme-map-marker-hover-shadow);
    }

    .freed-map-fallback-scan {
      background: var(--theme-shell-background);
    }
  `;
}

function fallbackPosition(marker: LocationMarkerSummary) {
  const left = ((marker.lng + 180) / 360) * 100;
  const top = ((90 - marker.lat) / 180) * 100;
  return {
    left: `${Math.min(96, Math.max(4, left)).toFixed(2)}%`,
    top: `${Math.min(94, Math.max(6, top)).toFixed(2)}%`,
  };
}

function fallbackLabel(marker: LocationMarkerSummary) {
  return marker.friend?.name ?? marker.item.author.displayName;
}

function mapGridBackground(boundary: string) {
  return `
    linear-gradient(
      color-mix(in oklab, ${boundary} 18%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in oklab, ${boundary} 14%, transparent) 1px,
      transparent 1px
    )
  `;
}

function fallbackScanBackground(background: string, water: string) {
  return `
    radial-gradient(
      circle at 18% 14%,
      color-mix(in oklab, ${water} 72%, transparent) 0%,
      transparent 34%
    ),
    radial-gradient(
      circle at 78% 82%,
      color-mix(in oklab, ${water} 28%, transparent) 0%,
      transparent 28%
    ),
    linear-gradient(
      180deg,
      color-mix(in oklab, ${background} 92%, black 8%) 0%,
      ${background} 100%
    )
  `;
}

function fitMarkers(map: MapInstance, markers: LocationMarkerSummary[], focusedMarkerKey?: string | null) {
  if (markers.length === 0) return;

  const focusedMarker = focusedMarkerKey
    ? markers.find((marker) => marker.key === focusedMarkerKey)
    : null;

  if (focusedMarker) {
    map.flyTo({
      center: [focusedMarker.lng, focusedMarker.lat],
      zoom: 7.5,
      duration: 600,
    });
    return;
  }

  if (markers.length === 1) {
    const marker = markers[0];
    map.flyTo({
      center: [marker.lng, marker.lat],
      zoom: 4.5,
      duration: 600,
    });
    return;
  }

  const lats = markers.map((marker) => marker.lat);
  const lngs = markers.map((marker) => marker.lng);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 72, duration: 600 }
  );
}

export function MapSurface({
  markers,
  focusedMarkerKey,
  interactive = true,
  themeId,
  onOpenFriend,
  onPromoteAccount,
  onLinkAccount,
  onOpenPost,
  emptyTitle = "No geo-tagged posts yet.",
  emptyBody = "Posts with location data will show up here.",
}: MapSurfaceProps) {
  const resolvedThemeId = themeId ?? DEFAULT_THEME_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mapModuleRef = useRef<MapLibreModule | null>(null);
  const markersRef = useRef<MarkerInstance[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedFallbackMarkerKey, setSelectedFallbackMarkerKey] = useState<string | null>(null);
  const activePopupRef = useRef<PopupInstance | null>(null);
  const activePopupKeyRef = useRef<string | null>(null);

  const stableMarkers = useMemo(
    () => markers.map((marker) => ({ ...marker })),
    [markers]
  );
  const avatarPalette = useMemo(
    () => createFriendAvatarPalette(resolvedThemeId),
    [resolvedThemeId]
  );
  const mapPalette = useMemo(
    () => getThemeDefinition(resolvedThemeId).map,
    [resolvedThemeId]
  );
  const selectedFallbackMarker = useMemo(
    () => stableMarkers.find((marker) => marker.key === selectedFallbackMarkerKey) ?? null,
    [selectedFallbackMarkerKey, stableMarkers]
  );
  const showFallback = loadFailed || !mapReady;
  const closeActivePopup = useCallback(() => {
    activePopupRef.current?.remove();
    activePopupRef.current = null;
    activePopupKeyRef.current = null;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setMapReady(false);
    setLoadFailed(false);

    if (shouldForceMapFallback()) {
      setLoadFailed(true);
      return () => {
        cancelled = true;
        closeActivePopup();
        for (const marker of markersRef.current) marker.remove();
        markersRef.current = [];
        mapRef.current?.remove();
        mapRef.current = null;
      };
    }

    ensureMapLibreCss();

    void Promise.all([
      loadMapLibre(),
      buildThemedMapStyle(resolvedThemeId),
    ]).then(([module, mapStyle]) => {
      if (cancelled || !containerRef.current) return;

      const maplibre = module as unknown as MapLibreModule;
      mapModuleRef.current = maplibre;
      try {
        const map = new maplibre.Map({
          container: containerRef.current,
          style: mapStyle,
          center: [0, 20],
          zoom: 1.8,
          interactive,
          attributionControl: false,
        });
        mapRef.current = map;
        setMapReady(true);
        setTimeout(() => map.resize(), 0);
      } catch (error) {
        console.error("[MapSurface] Failed to initialize MapLibre", error);
        mapRef.current?.remove();
        mapRef.current = null;
        setLoadFailed(true);
      }
    }).catch((error) => {
      console.error("[MapSurface] Failed to load the themed map", error);
      setLoadFailed(true);
    });

    return () => {
      cancelled = true;
      closeActivePopup();
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [closeActivePopup, interactive, resolvedThemeId]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapModuleRef.current) return;

    closeActivePopup();
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const map = mapRef.current;
    const maplibre = mapModuleRef.current;
    const handleMapClick = () => closeActivePopup();
    map.on("click", handleMapClick);

    for (const markerData of stableMarkers) {
      const element = createMarkerElement(markerData, avatarPalette);
      const marker = new maplibre.Marker({ element }).setLngLat([
        markerData.lng,
        markerData.lat,
      ]);

      if (interactive) {
        const popup = new maplibre.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          maxWidth: `${MAP_POPUP_MAX_WIDTH}px`,
          className: "freed-map-popup",
        })
          .setLngLat([markerData.lng, markerData.lat])
          .setDOMContent(buildPopupContent(markerData, onOpenFriend, onPromoteAccount, onLinkAccount, onOpenPost));
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (activePopupKeyRef.current === markerData.key) {
            closeActivePopup();
            return;
          }
          closeActivePopup();
          popup.addTo(map);
          activePopupRef.current = popup;
          activePopupKeyRef.current = markerData.key;
        });
      }

      marker.addTo(map);
      markersRef.current.push(marker);
    }

    fitMarkers(map, stableMarkers, focusedMarkerKey);

    return () => {
      map.off("click", handleMapClick);
      closeActivePopup();
    };
  }, [avatarPalette, closeActivePopup, focusedMarkerKey, interactive, mapReady, onLinkAccount, onOpenFriend, onOpenPost, onPromoteAccount, stableMarkers]);

  return (
    <div
      data-testid="map-surface"
      data-map-theme={resolvedThemeId}
      className="freed-map-shell theme-soft-viewport relative h-full w-full"
    >
      <style>{mapStyles(interactive)}</style>
      <div className="theme-soft-viewport-content">
        <div
          ref={containerRef}
          className={`h-full w-full ${showFallback ? "invisible" : "visible"}`}
        />
        <div
          className="pointer-events-none absolute inset-0 [background-size:88px_88px]"
          style={{
            backgroundImage: mapGridBackground(mapPalette.boundary),
            opacity: mapPalette.gridOpacity,
          }}
        />

        {showFallback && stableMarkers.length > 0 && (
          <div
            className="freed-map-fallback-scan absolute inset-0 overflow-hidden"
            style={{ background: fallbackScanBackground(mapPalette.background, mapPalette.water) }}
          >
          <div
            className="absolute inset-0 [background-size:72px_72px]"
            style={{
              backgroundImage: mapGridBackground(mapPalette.boundary),
              opacity: mapPalette.gridOpacity + 0.03,
            }}
          />
          <div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
            style={{
              background: `linear-gradient(
                180deg,
                transparent,
                color-mix(in oklab, ${mapPalette.boundary} 34%, transparent),
                transparent
              )`,
            }}
          />
          <div
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
            style={{
              background: `linear-gradient(
                90deg,
                transparent,
                color-mix(in oklab, ${mapPalette.boundary} 28%, transparent),
                transparent
              )`,
            }}
          />
          {stableMarkers.map((marker) => {
            const position = fallbackPosition(marker);
            return (
              <button
                key={marker.key}
                type="button"
                className="freed-map-marker absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1.5 text-[11px] text-[color:var(--theme-text-primary)] backdrop-blur-xl"
                style={{
                  ...position,
                  border: "1px solid color-mix(in oklab, var(--theme-border-strong) 78%, transparent)",
                  background: "var(--theme-map-fallback-card-background)",
                  boxShadow: "var(--theme-map-fallback-card-shadow)",
                }}
                onClick={() => setSelectedFallbackMarkerKey((current) => current === marker.key ? null : marker.key)}
                aria-label={fallbackLabel(marker)}
              >
                {fallbackLabel(marker)}
              </button>
            );
          })}

          {interactive && selectedFallbackMarker && (
            <div data-testid="map-fallback-popup" className="theme-dialog-shell absolute bottom-4 left-4 w-[min(560px,calc(100%-2rem))] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="theme-card-soft rounded-full border-[color:var(--theme-border-strong)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--theme-text-primary)]">
                      {popupKicker(selectedFallbackMarker)}
                    </span>
                    <span className="text-[11px] text-[color:var(--theme-text-muted)]">
                      {popupMeta(selectedFallbackMarker)}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[color:var(--theme-text-primary)]">
                    {fallbackLabel(selectedFallbackMarker)}
                  </p>
                  {selectedFallbackMarker.label && (
                    <p className="mt-1 text-sm font-medium text-[color:var(--theme-accent-secondary)]">
                      {selectedFallbackMarker.label}
                    </p>
                  )}
                  {popupSnippet(selectedFallbackMarker.item.content.text) && (
                    <div className="theme-card-soft mt-4 rounded-2xl p-3">
                      <p className="text-sm leading-6 text-[color:var(--theme-text-secondary)]">
                        {popupSnippet(selectedFallbackMarker.item.content.text)}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary rounded-xl px-2.5 py-1.5 text-[11px]"
                  onClick={() => setSelectedFallbackMarkerKey(null)}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="theme-card-soft rounded-2xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">Seen</p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--theme-text-primary)]">
                    {popupRelativeTime(selectedFallbackMarker.seenAt)}
                  </p>
                </div>
                <div className="theme-card-soft rounded-2xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--theme-text-muted)]">Source</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-[color:var(--theme-text-primary)]">
                    {selectedFallbackMarker.item.platform}
                  </p>
                </div>
              </div>

              {selectedFallbackMarker.groupCount > 1 && (
                <p className="mt-3 text-xs text-[color:var(--theme-accent-secondary)]">
                  {selectedFallbackMarker.groupCount.toLocaleString()} updates from this spot
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {selectedFallbackMarker.friend && onOpenFriend && (
                  <button
                    type="button"
                    className="btn-primary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onOpenFriend(selectedFallbackMarker)}
                  >
                    Open Friend
                  </button>
                )}
                {!selectedFallbackMarker.friend && onPromoteAccount && (
                  <button
                    type="button"
                    className="btn-primary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onPromoteAccount(selectedFallbackMarker)}
                  >
                    Promote to friend
                  </button>
                )}
                {!selectedFallbackMarker.friend && onLinkAccount && (
                  <button
                    type="button"
                    className="btn-secondary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onLinkAccount(selectedFallbackMarker)}
                  >
                    Link to existing friend
                  </button>
                )}
                {onOpenPost && (
                  <button
                    type="button"
                    className="btn-secondary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onOpenPost(selectedFallbackMarker)}
                  >
                    Open Post
                  </button>
                )}
              </div>
            </div>
          )}
          </div>
        )}

        {showFallback && stableMarkers.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 text-center"
            style={{
              background: `color-mix(in oklab, ${mapPalette.background} 92%, transparent)`,
            }}
          >
            <div>
              <p className="text-sm font-medium text-[color:var(--theme-text-primary)]">
                {loadFailed ? "Map failed to load" : emptyTitle}
              </p>
              <p className="mt-1 text-xs text-[color:var(--theme-text-muted)]">
                {loadFailed
                  ? "This browser could not initialize the live map, so a simplified view is shown instead."
                  : emptyBody}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
