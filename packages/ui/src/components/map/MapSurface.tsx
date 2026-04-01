import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { LocationMarkerSummary } from "@freed/shared";
import { createMarkerElement } from "./MarkerElement.js";
import { createFriendAvatarPalette } from "../../lib/friend-avatar-style.js";

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
  avatarTint?: string;
  onOpenFriend?: (marker: LocationMarkerSummary) => void;
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
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAP_CANVAS_FILTER =
  "brightness(0.26) contrast(1.24) saturate(0.24)";

let mapLibreLoader: Promise<MapLibreModule> | null = null;
let mapLibreCssLoaded = false;
const popupDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
  onOpenPost?: (marker: LocationMarkerSummary) => void
): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:16px",
    "width:min(460px,calc(100vw - 40px))",
    "min-width:420px",
    "padding:20px",
    "color:#f5f3ff",
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
    "border:1px solid rgba(168,85,247,0.24)",
    "background:linear-gradient(135deg,rgba(91,33,182,0.22),rgba(31,18,53,0.78))",
    "font-size:10px",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.14em",
    "color:rgba(233,213,255,0.84)",
  ].join(";");
  badgeRow.appendChild(eyebrow);

  const meta = document.createElement("div");
  meta.textContent = popupMeta(marker);
  meta.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);white-space:nowrap;text-align:right;padding-top:6px;";
  badgeRow.appendChild(meta);
  root.appendChild(badgeRow);

  const header = document.createElement("div");
  header.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const title = document.createElement("div");
  title.textContent = popupTitle(marker);
  title.style.cssText = "font-size:22px;font-weight:700;color:#faf5ff;letter-spacing:-0.03em;line-height:1.08;";
  header.appendChild(title);

  if (marker.label) {
    const location = document.createElement("div");
    location.textContent = marker.label;
    location.style.cssText = "font-size:14px;font-weight:600;color:rgba(216,180,254,0.94);line-height:1.5;max-width:34ch;";
    header.appendChild(location);
  }
  root.appendChild(header);

  const snippetText = popupSnippet(marker.item.content.text);
  if (snippetText) {
    const snippetCard = document.createElement("div");
    snippetCard.style.cssText = [
      "padding:12px 14px",
      "border-radius:16px",
      "border:1px solid rgba(139,92,246,0.12)",
      "background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))",
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.04)",
    ].join(";");

    const snippet = document.createElement("p");
    snippet.textContent = snippetText;
    snippet.style.cssText = "margin:0;font-size:14px;line-height:1.65;color:rgba(255,255,255,0.82);";
    snippetCard.appendChild(snippet);
    root.appendChild(snippetCard);
  }

  const facts = document.createElement("div");
  facts.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;";

  const updateFact = document.createElement("div");
  updateFact.style.cssText = "padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);";
  updateFact.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.42);margin-bottom:6px;">Seen</div><div style="font-size:13px;font-weight:600;color:#faf5ff;">${popupRelativeTime(marker.seenAt)}</div>`;
  facts.appendChild(updateFact);

  const sourceFact = document.createElement("div");
  sourceFact.style.cssText = "padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);";
  sourceFact.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.42);margin-bottom:6px;">Source</div><div style="font-size:13px;font-weight:600;color:#faf5ff;text-transform:capitalize;">${marker.item.platform}</div>`;
  facts.appendChild(sourceFact);
  root.appendChild(facts);

  if (marker.groupCount > 1) {
    const more = document.createElement("div");
    more.textContent = `${marker.groupCount.toLocaleString()} updates from this spot`;
    more.style.cssText = "font-size:11px;color:rgba(216,180,254,0.76);";
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
      "border:1px solid rgba(192,132,252,0.26)",
      "background:linear-gradient(135deg,rgba(91,33,182,0.58),rgba(45,15,78,0.98))",
      "color:#faf5ff",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "outline:none",
      "width:100%",
      "white-space:nowrap",
      "box-shadow:0 12px 26px rgba(17,17,24,0.34)",
    ].join(";");
    friendButton.addEventListener("click", () => onOpenFriend(marker));
    actions.appendChild(friendButton);
  }

  if (onOpenPost) {
    const postButton = document.createElement("button");
    postButton.type = "button";
    postButton.textContent = "Open Post";
    postButton.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "border:1px solid rgba(255,255,255,0.1)",
      "background:rgba(255,255,255,0.04)",
      "color:#f5f3ff",
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
      background:
        radial-gradient(circle at top, rgba(91, 33, 182, 0.18), rgba(91, 33, 182, 0) 34%),
        linear-gradient(180deg, rgba(8, 7, 13, 0.98), rgba(10, 9, 16, 0.98));
    }

    .freed-map-shell .maplibregl-map {
      font-family: system-ui, sans-serif;
    }

    .freed-map-shell .maplibregl-canvas {
      filter: ${MAP_CANVAS_FILTER};
    }

    .freed-map-shell .maplibregl-control-container,
    .freed-map-shell .maplibregl-ctrl-logo,
    .freed-map-shell .maplibregl-ctrl-attrib {
      display: none !important;
    }

    .freed-map-shell .maplibregl-popup-content {
      min-width: 420px;
      max-width: min(460px, calc(100vw - 40px));
      padding: 0;
      background:
        linear-gradient(180deg, rgba(18, 18, 28, 0.98), rgba(10, 10, 16, 0.98));
      border: 1px solid rgba(139, 92, 246, 0.18);
      border-radius: 24px;
      box-shadow:
        0 20px 48px rgba(2, 6, 23, 0.74),
        0 0 0 1px rgba(139, 92, 246, 0.06);
      backdrop-filter: blur(18px);
      overflow: hidden;
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
        0 0 0 1px rgba(216, 180, 254, 0.24),
        0 0 24px rgba(168, 85, 247, 0.28),
        0 20px 42px rgba(2, 6, 23, 0.76);
    }

    .freed-map-fallback-scan {
      background:
        radial-gradient(circle at top, rgba(91, 33, 182, 0.18), rgba(91, 33, 182, 0) 30%),
        linear-gradient(180deg, rgba(8, 7, 13, 0.98), rgba(10, 9, 16, 0.98));
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
  avatarTint,
  onOpenFriend,
  onOpenPost,
  emptyTitle = "No geo-tagged posts yet.",
  emptyBody = "Posts with location data will show up here.",
}: MapSurfaceProps) {
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
    () => createFriendAvatarPalette(avatarTint),
    [avatarTint]
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
    ensureMapLibreCss();

    void loadMapLibre().then((module) => {
      if (cancelled || !containerRef.current) return;

      const maplibre = module as unknown as MapLibreModule;
      mapModuleRef.current = maplibre;
      try {
        const map = new maplibre.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
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
      console.error("[MapSurface] Failed to load maplibre-gl", error);
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
  }, [closeActivePopup, interactive]);

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
          className: "freed-map-popup",
        })
          .setLngLat([markerData.lng, markerData.lat])
          .setDOMContent(buildPopupContent(markerData, onOpenFriend, onOpenPost));
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
  }, [avatarPalette, closeActivePopup, focusedMarkerKey, interactive, mapReady, onOpenFriend, onOpenPost, stableMarkers]);

  return (
    <div className="freed-map-shell relative h-full w-full overflow-hidden bg-[#08070d]">
      <style>{mapStyles(interactive)}</style>
      <div
        ref={containerRef}
        className={`h-full w-full ${showFallback ? "invisible" : "visible"}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.16),rgba(8,7,13,0)_34%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(167,139,250,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(167,139,250,0.06)_1px,transparent_1px)] [background-size:84px_84px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#8b5cf6]/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#08070d] via-[#08070d]/20 to-transparent" />

      {showFallback && stableMarkers.length > 0 && (
        <div className="freed-map-fallback-scan absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-24 [background-image:linear-gradient(rgba(167,139,250,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(167,139,250,0.1)_1px,transparent_1px)] [background-size:72px_72px]" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#8b5cf6]/20 to-transparent" />
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-[#8b5cf6]/16 to-transparent" />
          {stableMarkers.map((marker) => {
            const position = fallbackPosition(marker);
            return (
              <button
                key={marker.key}
                type="button"
                className="freed-map-marker absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#8b5cf6]/24 bg-[linear-gradient(135deg,rgba(76,29,149,0.82),rgba(16,16,24,0.94))] px-2.5 py-1.5 text-[11px] text-[#f5f3ff] shadow-[0_14px_28px_rgba(2,6,23,0.38)] backdrop-blur-md"
                style={position}
                onClick={() => setSelectedFallbackMarkerKey((current) => current === marker.key ? null : marker.key)}
                aria-label={fallbackLabel(marker)}
              >
                {fallbackLabel(marker)}
              </button>
            );
          })}

          {interactive && selectedFallbackMarker && (
            <div data-testid="map-fallback-popup" className="absolute bottom-4 left-4 w-[min(480px,calc(100%-2rem))] rounded-[24px] border border-[#8b5cf6]/16 bg-[linear-gradient(180deg,rgba(18,18,28,0.98),rgba(10,10,16,0.98))] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.72)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[#8b5cf6]/24 bg-[linear-gradient(135deg,rgba(91,33,182,0.22),rgba(31,18,53,0.78))] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e9d5ff]">
                      {popupKicker(selectedFallbackMarker)}
                    </span>
                    <span className="text-[11px] text-white/45">
                      {popupMeta(selectedFallbackMarker)}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">
                    {fallbackLabel(selectedFallbackMarker)}
                  </p>
                  {selectedFallbackMarker.label && (
                    <p className="mt-1 text-sm font-medium text-[#d8b4fe]">
                      {selectedFallbackMarker.label}
                    </p>
                  )}
                  {popupSnippet(selectedFallbackMarker.item.content.text) && (
                    <div className="mt-4 rounded-2xl border border-[#8b5cf6]/12 bg-white/[0.03] p-3">
                      <p className="text-sm leading-6 text-white/80">
                        {popupSnippet(selectedFallbackMarker.item.content.text)}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 px-2.5 py-1.5 text-[11px] text-white/55 transition-colors hover:border-[#8b5cf6]/28 hover:text-white"
                  onClick={() => setSelectedFallbackMarkerKey(null)}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">Seen</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {popupRelativeTime(selectedFallbackMarker.seenAt)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">Source</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-white">
                    {selectedFallbackMarker.item.platform}
                  </p>
                </div>
              </div>

              {selectedFallbackMarker.groupCount > 1 && (
                <p className="mt-3 text-xs text-[#d8b4fe]/76">
                  {selectedFallbackMarker.groupCount.toLocaleString()} updates from this spot
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {selectedFallbackMarker.friend && onOpenFriend && (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-[#8b5cf6]/24 bg-[linear-gradient(135deg,rgba(91,33,182,0.58),rgba(45,15,78,0.98))] px-3.5 py-2 text-xs font-medium text-[#faf5ff]"
                    onClick={() => onOpenFriend(selectedFallbackMarker)}
                  >
                    Open Friend
                  </button>
                )}
                {onOpenPost && (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs text-white"
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
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] px-6 text-center">
          <div>
            <p className="text-sm font-medium text-white">
              {loadFailed ? "Map failed to load" : emptyTitle}
            </p>
            <p className="mt-1 text-xs text-white/60">
              {loadFailed
                ? "This browser could not initialize the live map, so a simplified view is shown instead."
                : emptyBody}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
