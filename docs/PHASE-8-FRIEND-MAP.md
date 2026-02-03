# Phase 8: Location & Friend Map

> **Status:** Not Started  
> **Dependencies:** Phase 7 (Instagram provides most geo-tagged content)

---

## Overview

Friend Map view showing where friends have posted from. Extracts location data from geo-tagged posts (primarily Instagram) and displays on an interactive map.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Location Pipeline                            │
│                                                                 │
│  FeedItems ──► Location ──► Geocoding ──► Cache ──► Map View   │
│               Extraction     (Nominatim)                        │
│                                                                 │
│  Sources:                                                       │
│  • Instagram geo-tags (most common)                             │
│  • Facebook check-ins                                           │
│  • Text pattern extraction ("Posted from Paris")                │
│  • X geo-tags (rare)                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Location Extraction

### From Geo-Tags

```typescript
// packages/shared/src/location.ts
export interface GeoLocation {
  latitude: number;
  longitude: number;
  name?: string;
  city?: string;
  country?: string;
}

export function extractLocationFromItem(item: FeedItem): GeoLocation | null {
  // Instagram/Facebook geo-tags
  if (item.location?.latitude && item.location?.longitude) {
    return item.location;
  }

  // Text pattern extraction
  return extractLocationFromText(item.content.text);
}
```

### From Text Patterns

```typescript
// packages/pwa/src/lib/location-extract.ts
const LOCATION_PATTERNS = [
  /(?:in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g, // "in Paris"
  /📍\s*([^,\n]+)/g, // 📍 New York
  /🌍\s*([^,\n]+)/g, // 🌍 London
];

export function extractLocationFromText(text: string): string | null {
  for (const pattern of LOCATION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}
```

---

## Geocoding

### Nominatim Integration

```typescript
// packages/pwa/src/lib/geocoding.ts
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export async function geocode(query: string): Promise<GeoLocation | null> {
  // Check cache first
  const cached = await getFromCache(query);
  if (cached) return cached;

  const response = await fetch(
    `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { "User-Agent": "Freed/1.0" } }
  );

  const results = await response.json();
  if (results.length === 0) return null;

  const location: GeoLocation = {
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon),
    name: results[0].display_name,
  };

  // Cache for future use
  await saveToCache(query, location);
  return location;
}
```

### Geocoding Cache

```typescript
// packages/pwa/src/lib/geocoding-cache.ts
interface CachedLocation {
  query: string;
  location: GeoLocation;
  cachedAt: number;
}

// Store in IndexedDB
export async function getFromCache(query: string): Promise<GeoLocation | null> {
  const db = await openDB("freed-geocache");
  const cached = await db.get("locations", query);

  // Expire after 30 days
  if (cached && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) {
    return cached.location;
  }

  return null;
}
```

---

## Map UI

### MapLibre Integration

```tsx
// packages/pwa/src/components/map/FriendMap.tsx
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useFeedWithLocations } from "../../hooks/useFeedWithLocations";

export function FriendMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { items } = useFeedWithLocations();

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 20],
      zoom: 2,
    });

    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    if (!map.current) return;

    // Add markers for each item with location
    items.forEach((item) => {
      if (!item.location) return;

      new maplibregl.Marker({
        element: createMarkerElement(item),
      })
        .setLngLat([item.location.longitude, item.location.latitude])
        .addTo(map.current!);
    });
  }, [items]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
```

### Recency Indicators

```tsx
// packages/pwa/src/components/map/MarkerElement.tsx
export function createMarkerElement(item: FeedItem): HTMLElement {
  const el = document.createElement("div");
  el.className = "friend-marker";

  // Size based on recency
  const hoursAgo = (Date.now() - item.publishedAt) / (1000 * 60 * 60);
  const size = hoursAgo < 24 ? "large" : hoursAgo < 168 ? "medium" : "small";
  el.classList.add(`marker-${size}`);

  // Avatar
  if (item.author.avatarUrl) {
    el.style.backgroundImage = `url(${item.author.avatarUrl})`;
  }

  return el;
}
```

---

## Tasks

| Task | Description                            | Complexity |
| ---- | -------------------------------------- | ---------- |
| 8.1  | Location extraction from geo-tags      | Low        |
| 8.2  | Location extraction from text patterns | Medium     |
| 8.3  | Nominatim geocoding integration        | Medium     |
| 8.4  | Geocoding cache layer                  | Low        |
| 8.5  | MapLibre GL JS integration             | High       |
| 8.6  | Friend markers with avatars            | Medium     |
| 8.7  | Recency indicators (size/opacity)      | Low        |
| 8.8  | Marker clustering for dense areas      | Medium     |
| 8.9  | Click marker to see post               | Low        |

---

## Success Criteria

- [ ] Location extracted from Instagram geo-tags
- [ ] Text patterns extract locations ("in Paris", 📍)
- [ ] Nominatim geocodes location names to coordinates
- [ ] Geocoding results cached for performance
- [ ] MapLibre displays world map
- [ ] Friend markers show on map with avatars
- [ ] Recent posts have larger markers
- [ ] Clicking marker shows the post

---

## Privacy Considerations

- All location data stays local
- User controls which sources contribute to map
- No location data synced to cloud (only local display)

---

## Deliverable

Friend Map view in PWA/Desktop showing where friends have posted from, with recency indicators.
