/**
 * Creates an avatar bubble HTMLElement for use as a MapLibre marker.
 *
 * Size encodes recency:
 *   - < 24h  → large (40px)
 *   - < 7d   → medium (32px)
 *   - older  → small (24px)
 *
 * Friends whose identity is known get their canonical avatar/name from
 * friendForAuthor(). Unmatched posts fall back to the item's author avatar.
 */

import type { FeedItem, Friend } from "@freed/shared";

export type MarkerSize = "large" | "medium" | "small";

function markerSize(publishedAt: number): MarkerSize {
  const hoursAgo = (Date.now() - publishedAt) / (1000 * 60 * 60);
  if (hoursAgo < 24) return "large";
  if (hoursAgo < 24 * 7) return "medium";
  return "small";
}

const SIZE_PX: Record<MarkerSize, number> = {
  large: 40,
  medium: 32,
  small: 24,
};

/**
 * Build an HTMLElement suitable for a MapLibre custom marker.
 *
 * @param item   - The FeedItem that provides the location pin anchor
 * @param friend - The unified Friend identity, if matched; null otherwise
 */
export function createMarkerElement(
  item: FeedItem,
  friend: Friend | null
): HTMLElement {
  const size = markerSize(item.publishedAt);
  const px = SIZE_PX[size];

  const avatarUrl = friend?.avatarUrl
    ?? friend?.sources[0]?.avatarUrl
    ?? item.author.avatarUrl;

  const displayName = friend?.name ?? item.author.displayName;
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const el = document.createElement("div");
  el.className = `freed-map-marker freed-map-marker--${size}`;
  el.title = displayName;
  el.setAttribute("aria-label", displayName);
  el.style.cssText = `
    width: ${px}px;
    height: ${px}px;
    border-radius: 50%;
    border: 2px solid rgba(139,92,246,0.8);
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    font-size: ${Math.max(8, px * 0.35)}px;
    font-weight: 700;
    color: white;
    font-family: system-ui, sans-serif;
    transition: transform 150ms ease;
  `;

  el.onmouseenter = () => (el.style.transform = "scale(1.15)");
  el.onmouseleave = () => (el.style.transform = "scale(1)");

  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    img.onerror = () => {
      img.remove();
      el.textContent = initials;
    };
    el.appendChild(img);
  } else {
    el.textContent = initials;
  }

  return el;
}
