import type { FeedItem, Person, LocationMarkerSummary } from "@freed/shared";
import {
  channelInitialForName,
  personInitialsForName,
  resolveFriendAvatarUrl,
} from "../../lib/friend-avatar.js";
import type { FriendAvatarPalette } from "../../lib/friend-avatar-style.js";

export type MarkerSize = "large" | "medium" | "small";

interface MarkerElementOptions {
  showAvatar?: boolean;
  simplified?: boolean;
}

const SIZE_PX: Record<MarkerSize, number> = {
  large: 40,
  medium: 32,
  small: 24,
};

function markerSize(publishedAt: number): MarkerSize {
  const hoursAgo = (Date.now() - publishedAt) / (1000 * 60 * 60);
  if (hoursAgo < 24) return "large";
  if (hoursAgo < 24 * 7) return "medium";
  return "small";
}

function displayName(item: FeedItem, friend: Person | null): string {
  return friend?.name ?? item.author.displayName;
}

function markerInitials(item: FeedItem, friend: Person | null): string {
  return friend
    ? personInitialsForName(friend.name)
    : channelInitialForName(item.author.displayName);
}

function appendFallbackLabel(
  body: HTMLElement,
  initials: string,
  avatarPalette: FriendAvatarPalette,
): void {
  const fallbackLabel = document.createElement("span");
  fallbackLabel.textContent = initials;
  fallbackLabel.setAttribute("data-avatar-fallback", "true");
  fallbackLabel.style.cssText = `position:relative;z-index:3;text-shadow:0 0 14px ${avatarPalette.initialsShadow};`;
  body.appendChild(fallbackLabel);
}

export function createMarkerElement(
  marker: LocationMarkerSummary,
  avatarPalette: FriendAvatarPalette,
  options: MarkerElementOptions = {},
): HTMLElement {
  const size = markerSize(marker.seenAt);
  const px = SIZE_PX[size];
  const friend = marker.friend;
  const item = marker.item;
  const simplified = options.simplified === true;
  const avatarUrl = options.showAvatar === false
    ? null
    : resolveFriendAvatarUrl(friend, item.author.avatarUrl);

  const el = document.createElement("div");
  el.className = `freed-map-marker freed-map-marker--${size}`;
  el.title = displayName(item, friend);
  el.setAttribute("aria-label", displayName(item, friend));
  el.setAttribute("data-avatar-url", avatarUrl ?? "");
  el.setAttribute("data-avatar-name", displayName(item, friend));
  if (simplified) {
    el.setAttribute("data-map-marker-simplified", "true");
  }
  el.style.cssText = [
    "position:absolute",
    "transform-origin:center center",
  ].join(";");

  const body = document.createElement("div");
  body.className = "freed-map-marker-body";
  body.style.cssText = [
    `width:${px}px`,
    `height:${px}px`,
    "position:relative",
    "border-radius:999px",
    `border:1px solid ${avatarPalette.borderStrong}`,
    simplified
      ? `box-shadow:0 0 0 1px ${avatarPalette.borderSoft}`
      : `box-shadow:0 0 0 1px ${avatarPalette.borderSoft},0 0 18px ${avatarPalette.glow},var(--theme-marker-shadow)`,
    "overflow:hidden",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:pointer",
    simplified
      ? `background:${avatarPalette.gradientMid}`
      : `background:radial-gradient(circle at 30% 28%,${avatarPalette.gradientStart},${avatarPalette.gradientMid} 34%,${avatarPalette.gradientEnd} 100%)`,
    `font-size:${Math.max(8, px * 0.35)}px`,
    "font-weight:700",
    `color:${avatarPalette.text}`,
    "font-family:system-ui,sans-serif",
    "letter-spacing:0.04em",
  ].join(";");
  el.appendChild(body);

  if (!simplified) {
    const glowRing = document.createElement("div");
    glowRing.className = "freed-map-marker-glow";
    glowRing.style.cssText = [
      "position:absolute",
      "inset:-6px",
      "border-radius:999px",
      `border:1px solid ${avatarPalette.ring}`,
      `background:radial-gradient(circle,${avatarPalette.glowSoft},transparent 72%)`,
      "pointer-events:none",
      "z-index:0",
    ].join(";");
    body.appendChild(glowRing);
  }

  const initials = markerInitials(item, friend);

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "freed-map-marker-image";
    img.src = avatarUrl;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;position:relative;z-index:1;opacity:0.94;filter:saturate(0.9) contrast(1.02) brightness(0.92);";
    img.onerror = () => {
      img.remove();
      appendFallbackLabel(body, initials, avatarPalette);
    };
    body.appendChild(img);

    if (!simplified) {
      const tintOverlay = document.createElement("div");
      tintOverlay.className = "freed-map-marker-tint";
      tintOverlay.style.cssText = [
        "position:absolute",
        "inset:0",
        "border-radius:999px",
        `background:${avatarPalette.imageOverlay}`,
        "pointer-events:none",
        "z-index:2",
      ].join(";");
      body.appendChild(tintOverlay);

      const halo = document.createElement("div");
      halo.className = "freed-map-marker-halo";
      halo.style.cssText = [
        "position:absolute",
        "inset:4px",
        "border-radius:999px",
        `border:1px solid ${avatarPalette.ring}`,
        `background:radial-gradient(circle at 30% 30%, ${avatarPalette.imageHighlight}, transparent 65%)`,
        "pointer-events:none",
        "z-index:3",
      ].join(";");
      body.appendChild(halo);
    }
  } else {
    appendFallbackLabel(body, initials, avatarPalette);
  }

  if (marker.groupCount > 1 && !simplified) {
    const badge = document.createElement("div");
    badge.className = "freed-map-marker-badge";
    badge.textContent = marker.groupCount.toLocaleString();
    badge.style.cssText = [
      "position:absolute",
      "right:-4px",
      "bottom:-2px",
      "min-width:18px",
      "height:18px",
      "padding:0 4px",
      "border-radius:999px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:10px",
      "font-weight:700",
      `color:${avatarPalette.text}`,
      "background:var(--theme-button-primary-background)",
      `border:1px solid ${avatarPalette.borderSoft}`,
      "box-shadow:var(--theme-marker-badge-shadow)",
    ].join(";");
    body.appendChild(badge);
  }

  return el;
}
