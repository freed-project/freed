/**
 * FriendMap — MapLibre GL JS world map showing where friends have posted from.
 *
 * Status: Scaffolded. Shown in the "coming soon" slot; gated by sidebar.
 *
 * Location pipeline:
 *   FeedItems → extractLocationFromItem → geocode (Nominatim) → cache → MapLibre markers
 *
 * Friend identity: markers are clustered per Friend (using friendForAuthor),
 * so Instagram and Facebook posts from the same person share a pin.
 *
 * Privacy: all location data stays local. No coordinates are sent to Freed servers.
 * Nominatim queries only go to openstreetmap.org.
 */

import { useEffect, useRef, useState } from "react";
import type { FeedItem, Friend } from "@freed/shared";
import { extractLocationFromItem, friendForAuthor } from "@freed/shared";
import { geocode } from "../../lib/geocoding.js";
import { createMarkerElement } from "./MarkerElement.js";

// MapLibre is a large dependency — lazy-imported so the main bundle stays lean.
// The `maplibre-gl` npm package must be added to packages/pwa when this view goes live.
// See: https://maplibre.org/maplibre-gl-js/docs/
type MapLibreMap = {
  remove: () => void;
  addControl: (ctrl: unknown, pos?: string) => void;
};
type MapLibreMarker = { setLngLat: (c: [number, number]) => MapLibreMarker; setPopup: (p: unknown) => MapLibreMarker; addTo: (map: unknown) => MapLibreMarker; remove: () => void };
type MapLibreModule = {
  Map: new (opts: unknown) => MapLibreMap;
  Marker: new (opts: { element: HTMLElement }) => MapLibreMarker;
  Popup: new (opts?: unknown) => { setHTML: (h: string) => unknown };
  NavigationControl: new () => unknown;
};

// ---------------------------------------------------------------------------
// Location-resolved item
// ---------------------------------------------------------------------------

interface ResolvedItem {
  item: FeedItem;
  friend: Friend | null;
  lat: number;
  lng: number;
}

interface FriendMapProps {
  friends: Record<string, Friend>;
  feedItems: FeedItem[];
}

export function FriendMap({ friends, feedItems }: FriendMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const [resolvedItems, setResolvedItems] = useState<ResolvedItem[]>([]);
  const [geocodingCount, setGeocodingCount] = useState(0);

  // Resolve locations for all items that have location signals
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const pending: Promise<ResolvedItem | null>[] = [];
      let geocoding = 0;

      for (const item of feedItems) {
        const signal = extractLocationFromItem(item);
        if (!signal) continue;

        const friend = friendForAuthor(friends, item.platform, item.author.id);

        if ("coordinates" in signal) {
          // Already have lat/lng — no geocoding needed
          pending.push(
            Promise.resolve({
              item,
              friend,
              lat: signal.coordinates.lat,
              lng: signal.coordinates.lng,
            })
          );
        } else if ("name" in signal) {
          // Needs geocoding
          geocoding++;
          pending.push(
            geocode(signal.name).then((geo) => {
              if (!geo) return null;
              return { item, friend, lat: geo.latitude, lng: geo.longitude };
            })
          );
        }
      }

      setGeocodingCount(geocoding);

      const results = await Promise.all(pending);
      if (!cancelled) {
        setResolvedItems(results.filter((r): r is ResolvedItem => r !== null));
        setGeocodingCount(0);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [feedItems, friends]);

  // Initialize MapLibre map
  useEffect(() => {
    if (!containerRef.current) return;

    let maplibregl: MapLibreModule | null = null;

    // Lazy-import maplibre-gl — the package must be installed first.
    // Until then, we catch the import error and render a placeholder.
    import("maplibre-gl" as never as string)
      .then((mod) => {
        maplibregl = mod as unknown as MapLibreModule;
        if (!containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [0, 20],
          zoom: 2,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");
        mapRef.current = map;
      })
      .catch(() => {
        // maplibre-gl not installed yet — FriendMap is coming-soon scaffolding
        console.info(
          "[FriendMap] maplibre-gl not installed. Run `npm install maplibre-gl` in packages/pwa to enable the map view."
        );
      });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Add/update markers when resolved items change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    // Dynamically import to avoid a crash if maplibre-gl isn't installed yet
    import("maplibre-gl" as never as string)
      .then((mod) => {
        const maplibregl = mod as unknown as MapLibreModule;
        for (const resolved of resolvedItems) {
          const el = createMarkerElement(resolved.item, resolved.friend);
          const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
            `<div style="font-size:13px;max-width:200px;">
              <strong>${resolved.friend?.name ?? resolved.item.author.displayName}</strong>
              ${resolved.item.content.text ? `<p style="margin:4px 0 0;">${resolved.item.content.text.slice(0, 120)}${resolved.item.content.text.length > 120 ? "…" : ""}</p>` : ""}
            </div>`
          );
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([resolved.lng, resolved.lat])
            .setPopup(popup)
            .addTo(map);
          markersRef.current.push(marker);
        }
      })
      .catch(() => {
        // maplibre-gl not yet installed
      });
  }, [resolvedItems]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {geocodingCount > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-xs text-white/70">
          Resolving {geocodingCount.toLocaleString()} location{geocodingCount !== 1 ? "s" : ""}...
        </div>
      )}

      {resolvedItems.length === 0 && geocodingCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="text-center px-6">
            <p className="text-white/70 text-sm">No geo-tagged posts yet.</p>
            <p className="text-white/40 text-xs mt-1">
              Posts from Instagram and Facebook with location data will appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
