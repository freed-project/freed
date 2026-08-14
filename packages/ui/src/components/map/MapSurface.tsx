import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  arrow,
  computePosition,
  offset,
  shift,
  type Placement,
} from "@floating-ui/dom";
import type { LocationMarkerSummary } from "@freed/shared";
import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "@freed/shared/themes";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { createMarkerElement } from "./MarkerElement.js";
import { createFriendAvatarPalette } from "../../lib/friend-avatar-style.js";
import { buildThemedMapStyle } from "../../lib/map-style.js";
import { CANVAS_CONTROL_BUTTON_CLASS } from "../layout/layoutConstants.js";

type PopupInstance = HTMLElement;
type MarkerInstance = MapLibreMarker;
type MapInstance = MapLibreMap;
type DisposableMapInstance = Pick<MapInstance, "getCanvas" | "remove" | "stop">;
type MapMarkerMovingPriority = "primary" | "deferred";
interface MapMarkerRecord {
  marker: MarkerInstance;
  priority: MapMarkerMovingPriority;
  attached: boolean;
}

type MapLibreModule = typeof import("maplibre-gl");

interface MapSurfaceProps {
  markers: LocationMarkerSummary[];
  focusedMarkerKey?: string | null;
  interactive?: boolean;
  themeId?: ThemeId;
  viewportInsets?: MapViewportInsets;
  onOpenFriend?: (marker: LocationMarkerSummary) => void;
  onPromoteAccount?: (marker: LocationMarkerSummary) => void;
  onLinkAccount?: (marker: LocationMarkerSummary) => void;
  onOpenPost?: (marker: LocationMarkerSummary) => void;
  emptyTitle?: string;
  emptyBody?: string;
  showFitAllControl?: boolean;
}

type MapViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type MapSurfaceSize = {
  width: number;
  height: number;
};

let mapLibreLoader: Promise<MapLibreModule> | null = null;
const popupDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MAP_POPUP_MAX_WIDTH = 560;
const MAP_POPUP_VIEWPORT_MARGIN = 40;
const MAP_FLOATING_PANEL_GAP_PX = 12;
const MAP_POPUP_ARROW_ALIGNMENT_TOLERANCE_PX = 1;
const MAP_FLOATING_CONTROL_SELECTOR = "[data-map-floating-control]";
const MAP_DOM_MARKER_LIMIT = 160;
const MAP_MOVING_MARKER_PAINT_LIMIT = 24;
const MAP_DENSE_MARKER_RESTORE_DELAY_MS = 420;
const MAP_CAMERA_PADDING_PX = 72;
const MAP_CLUSTER_MAX_ZOOM = 7.5;
const MAP_MAX_PIXEL_RATIO = 1.5;
const MAP_MAX_TILE_CACHE_SIZE = 24;

type FloatingLayoutRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function layoutRect(rect: DOMRect): FloatingLayoutRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function floatingRectsIntersect(
  panel: FloatingLayoutRect,
  control: FloatingLayoutRect,
  gap = 0,
): boolean {
  return (
    panel.left < control.right + gap &&
    panel.right > control.left - gap &&
    panel.top < control.bottom + gap &&
    panel.bottom > control.top - gap
  );
}

function setupMapFloatingPanelLayout({
  panel,
  anchor,
  shell,
  map,
  getViewportInsets,
}: {
  panel: HTMLElement;
  anchor: HTMLElement;
  shell: HTMLElement;
  map?: MapInstance;
  getViewportInsets: () => MapViewportInsets | undefined;
}): () => void {
  let frame = 0;
  let updateGeneration = 0;
  let disposed = false;
  const resizeObserver = new ResizeObserver(() => schedule());

  const update = async () => {
    frame = 0;
    const generation = updateGeneration + 1;
    updateGeneration = generation;
    const shellRect = shell.getBoundingClientRect();
    const insets = getViewportInsets();
    const controls = [...document.querySelectorAll<HTMLElement>(MAP_FLOATING_CONTROL_SELECTOR)]
      .filter((control) => !panel.contains(control))
      .map((control) => ({ element: control, rect: layoutRect(control.getBoundingClientRect()) }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    for (const { element } of controls) resizeObserver.observe(element);

    const baseBounds = {
      left: shellRect.left + (insets?.left ?? 0) + MAP_FLOATING_PANEL_GAP_PX,
      top: shellRect.top + (insets?.top ?? 0) + MAP_FLOATING_PANEL_GAP_PX,
      right: shellRect.right - (insets?.right ?? 0) - MAP_FLOATING_PANEL_GAP_PX,
      bottom: shellRect.bottom - (insets?.bottom ?? 0) - MAP_FLOATING_PANEL_GAP_PX,
    };
    const topControlBottom = controls
      .filter(({ element, rect }) =>
        element.dataset.mapFloatingControlEdge === "top" &&
        rect.right > baseBounds.left &&
        rect.left < baseBounds.right,
      )
      .reduce(
        (bottom, { rect }) => Math.max(bottom, rect.bottom + MAP_FLOATING_PANEL_GAP_PX),
        baseBounds.top,
      );
    const bottomControlTop = controls
      .filter(({ element, rect }) =>
        element.dataset.mapFloatingControlEdge === "bottom" &&
        rect.right > baseBounds.left &&
        rect.left < baseBounds.right,
      )
      .reduce((top, { rect }) => Math.min(top, rect.top - MAP_FLOATING_PANEL_GAP_PX), baseBounds.bottom);
    const bounds = {
      left: baseBounds.left,
      top: Math.min(topControlBottom, bottomControlTop - 1),
      right: baseBounds.right,
      bottom: Math.max(topControlBottom + 1, bottomControlTop),
      width: Math.max(1, baseBounds.right - baseBounds.left),
      height: Math.max(1, bottomControlTop - topControlBottom),
    };
    const floatingBoundary = {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };

    const content = panel.querySelector<HTMLElement>(".maplibregl-popup-content") ?? panel;
    const popupArrow = panel.querySelector<HTMLElement>("[data-map-popup-arrow]");
    if (popupArrow) popupArrow.style.display = "";
    const maxPanelWidth = Math.max(1, Math.min(MAP_POPUP_MAX_WIDTH, bounds.width));
    content.style.width = `${maxPanelWidth}px`;
    content.style.minWidth = `${Math.min(420, maxPanelWidth)}px`;
    content.style.maxWidth = `${maxPanelWidth}px`;
    content.style.maxHeight = "none";
    content.style.overflowY = "auto";
    panel.style.maxWidth = `${maxPanelWidth}px`;
    panel.style.position = "fixed";
    panel.style.visibility = "hidden";

    const anchorRect = anchor.getBoundingClientRect();
    const naturalWidth = Math.min(maxPanelWidth, Math.max(1, content.scrollWidth));
    const naturalHeight = Math.max(1, content.scrollHeight);
    const placements: Placement[] = ["top", "bottom", "right", "left"];
    const candidates: Array<{
      placement: Placement;
      x: number;
      y: number;
      width: number;
      height: number;
      maxWidth: number;
      maxHeight: number;
      score: number;
    }> = [];

    for (const [placementIndex, placement] of placements.entries()) {
      const side = placement.split("-")[0];
      const availableMain = side === "top"
        ? anchorRect.top - MAP_FLOATING_PANEL_GAP_PX - bounds.top
        : side === "bottom"
          ? bounds.bottom - anchorRect.bottom - MAP_FLOATING_PANEL_GAP_PX
          : side === "left"
            ? anchorRect.left - MAP_FLOATING_PANEL_GAP_PX - bounds.left
            : bounds.right - anchorRect.right - MAP_FLOATING_PANEL_GAP_PX;
      const candidateMaxWidth = Math.max(
        1,
        Math.min(maxPanelWidth, side === "left" || side === "right" ? availableMain : bounds.width),
      );
      const candidateMaxHeight = Math.max(
        1,
        Math.min(bounds.height, side === "top" || side === "bottom" ? availableMain : bounds.height),
      );
      content.style.width = `${candidateMaxWidth}px`;
      content.style.minWidth = `${Math.min(420, candidateMaxWidth)}px`;
      content.style.maxWidth = `${candidateMaxWidth}px`;
      content.style.maxHeight = `${candidateMaxHeight}px`;

      const result = await computePosition(anchor, panel, {
        strategy: "fixed",
        placement,
        middleware: [
          offset(MAP_FLOATING_PANEL_GAP_PX),
          shift({ boundary: floatingBoundary, crossAxis: false }),
        ],
      });
      if (disposed || generation !== updateGeneration || !panel.isConnected) return;

      const measuredRect = panel.getBoundingClientRect();
      const candidateRect: FloatingLayoutRect = {
        left: result.x,
        top: result.y,
        right: result.x + measuredRect.width,
        bottom: result.y + measuredRect.height,
        width: measuredRect.width,
        height: measuredRect.height,
      };
      const overflow =
        Math.max(0, bounds.left - candidateRect.left) +
        Math.max(0, candidateRect.right - bounds.right) +
        Math.max(0, bounds.top - candidateRect.top) +
        Math.max(0, candidateRect.bottom - bounds.bottom);
      const controlCollision = controls.some(({ rect }) =>
        floatingRectsIntersect(candidateRect, rect, MAP_FLOATING_PANEL_GAP_PX),
      );
      const constraint =
        Math.max(0, naturalWidth - measuredRect.width) +
        Math.max(0, naturalHeight - measuredRect.height);
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const anchorCenterY = anchorRect.top + anchorRect.height / 2;
      const arrowInset = 24;
      const anchorAlignmentError = side === "top" || side === "bottom"
        ? Math.max(
            0,
            candidateRect.left + arrowInset - anchorCenterX,
            anchorCenterX - (candidateRect.right - arrowInset),
          )
        : Math.max(
            0,
            candidateRect.top + arrowInset - anchorCenterY,
            anchorCenterY - (candidateRect.bottom - arrowInset),
          );
      candidates.push({
        placement,
        x: result.x,
        y: result.y,
        width: measuredRect.width,
        height: measuredRect.height,
        maxWidth: candidateMaxWidth,
        maxHeight: candidateMaxHeight,
        score:
          overflow * 1_000_000 +
          (controlCollision ? 100_000_000 : 0) +
          anchorAlignmentError * 10_000 +
          constraint * 100 +
          placementIndex,
      });
    }

    const selected = candidates.reduce(
      (best, candidate) => !best || candidate.score < best.score ? candidate : best,
      null as (typeof candidates)[number] | null,
    );
    if (!selected) return;

    content.style.width = `${selected.maxWidth}px`;
    content.style.minWidth = `${Math.min(420, selected.maxWidth)}px`;
    content.style.maxWidth = `${selected.maxWidth}px`;
    content.style.maxHeight = `${selected.maxHeight}px`;
    const result = await computePosition(anchor, panel, {
      strategy: "fixed",
      placement: selected.placement,
      middleware: [
        offset(MAP_FLOATING_PANEL_GAP_PX),
        shift({ boundary: floatingBoundary, crossAxis: false }),
        popupArrow ? arrow({ element: popupArrow, padding: 24 }) : null,
      ],
    });
    if (disposed || generation !== updateGeneration || !panel.isConnected) return;

    panel.style.left = `${Math.round(result.x)}px`;
    panel.style.top = `${Math.round(result.y)}px`;
    panel.style.visibility = "visible";
    panel.dataset.placement = result.placement.split("-")[0];

    if (popupArrow) {
      const arrowData = result.middlewareData.arrow;
      const side = result.placement.split("-")[0] as "top" | "right" | "bottom" | "left";
      const staticSide = {
        top: "bottom",
        right: "left",
        bottom: "top",
        left: "right",
      }[side];
      popupArrow.style.left = arrowData?.x == null ? "" : `${Math.round(arrowData.x)}px`;
      popupArrow.style.top = arrowData?.y == null ? "" : `${Math.round(arrowData.y)}px`;
      popupArrow.style.right = "";
      popupArrow.style.bottom = "";
      popupArrow.style.setProperty(staticSide, "-5px");

      const finalAnchorRect = anchor.getBoundingClientRect();
      const anchorOccluded = controls.some(({ rect }) =>
        floatingRectsIntersect(layoutRect(finalAnchorRect), rect),
      );
      const anchorOutsideSafeBounds =
        finalAnchorRect.left < bounds.left ||
        finalAnchorRect.right > bounds.right ||
        finalAnchorRect.top < bounds.top ||
        finalAnchorRect.bottom > bounds.bottom;
      const arrowCenterX = result.x + (arrowData?.x ?? 0) + popupArrow.offsetWidth / 2;
      const arrowCenterY = result.y + (arrowData?.y ?? 0) + popupArrow.offsetHeight / 2;
      const anchorCenterX = finalAnchorRect.left + finalAnchorRect.width / 2;
      const anchorCenterY = finalAnchorRect.top + finalAnchorRect.height / 2;
      const arrowAlignmentError = side === "top" || side === "bottom"
        ? Math.abs(arrowCenterX - anchorCenterX)
        : Math.abs(arrowCenterY - anchorCenterY);
      const tailVisible =
        arrowData != null &&
        !anchorOccluded &&
        !anchorOutsideSafeBounds &&
        arrowAlignmentError <= MAP_POPUP_ARROW_ALIGNMENT_TOLERANCE_PX;
      popupArrow.style.display = tailVisible ? "" : "none";
      panel.dataset.mapPopupTail = tailVisible ? "visible" : "hidden";
    }
  };

  function schedule() {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      void update();
    });
  }

  const mutationObserver = new MutationObserver(schedule);
  resizeObserver.observe(shell);
  resizeObserver.observe(panel);
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  map?.on("move", schedule);
  map?.on("resize", schedule);
  schedule();

  return () => {
    disposed = true;
    updateGeneration += 1;
    if (frame !== 0) window.cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    map?.off("move", schedule);
    map?.off("resize", schedule);
    panel.style.left = "";
    panel.style.top = "";
    panel.style.visibility = "";
  };
}

/**
 * MapLibre removes its DOM and workers, but WebKit can retain the detached
 * canvas backing store and GPU context for the rest of the renderer process.
 * Release that context after MapLibre has stopped using it so leaving Map
 * returns the browsing surface's memory to the system.
 */
export function disposeMapInstance(map: DisposableMapInstance): void {
  let canvas: HTMLCanvasElement | null = null;
  let loseContext: WEBGL_lose_context | null = null;

  try {
    try {
      map.stop();
      canvas = map.getCanvas();
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      loseContext = context?.getExtension("WEBGL_lose_context") ?? null;
    } finally {
      map.remove();
    }
  } finally {
    loseContext?.loseContext();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

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
  if (marker.friend?.relationshipStatus === "friend") return "Linked Friend";
  if (marker.friend) return "Linked Person";
  return marker.item.contentType === "story" ? "Story Update" : "Location Update";
}

function popupTitle(marker: LocationMarkerSummary): string {
  return marker.friend?.name ?? marker.item.author.displayName;
}

function hasConfirmedFriend(marker: LocationMarkerSummary): boolean {
  return marker.friend?.relationshipStatus === "friend";
}

function popupMeta(marker: LocationMarkerSummary): string {
  return `${popupRelativeTime(marker.seenAt)} · ${popupAbsoluteTime(marker.seenAt)}`;
}

function loadMapLibre(): Promise<MapLibreModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is unavailable"));
  }

  if (mapLibreLoader) return mapLibreLoader;

  // Let Vite own the asset URLs so parallel worktrees do not depend on raw
  // @fs paths into whichever checkout currently holds node_modules.
  mapLibreLoader = Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]).then(([module]) => {
    module.setWorkerUrl(mapLibreWorkerUrl);
    // Safari otherwise creates as many as three MapLibre workers. WebKit gives
    // each worker a large process allocation, which pushed the geographic map
    // above 2 GB on the 20,000-item Library even though tile caching and marker
    // counts were already bounded. One worker keeps the same map data and
    // rendering behavior without multiplying that fixed memory cost.
    module.setWorkerCount(1);
    return module;
  }).catch((error) => {
    mapLibreLoader = null;
    throw error;
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
  const confirmedFriend = hasConfirmedFriend(marker);
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

  if (confirmedFriend && onOpenFriend) {
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

  if (!confirmedFriend && onPromoteAccount) {
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

  if (!confirmedFriend && onLinkAccount) {
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

    .freed-map-popup {
      z-index: 70;
      max-width: min(${MAP_POPUP_MAX_WIDTH}px, calc(100vw - ${MAP_POPUP_VIEWPORT_MARGIN}px));
      pointer-events: none;
    }

    .freed-map-popup .maplibregl-popup-content {
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
      pointer-events: auto;
    }

    .freed-map-popup-arrow {
      position: absolute;
      z-index: 0;
      width: 10px;
      height: 10px;
      box-sizing: border-box;
      background: color-mix(in oklab, var(--theme-bg-elevated) 96%, transparent);
      border: 1px solid var(--theme-border-strong);
      transform: rotate(45deg);
      pointer-events: none;
    }

    .freed-map-popup[data-placement="top"] .freed-map-popup-arrow {
      border-top: 0;
      border-left: 0;
    }

    .freed-map-popup[data-placement="bottom"] .freed-map-popup-arrow {
      border-right: 0;
      border-bottom: 0;
    }

    .freed-map-popup[data-placement="right"] .freed-map-popup-arrow {
      border-top: 0;
      border-right: 0;
    }

    .freed-map-popup[data-placement="left"] .freed-map-popup-arrow {
      border-left: 0;
      border-bottom: 0;
    }

    .freed-map-shell .freed-map-marker {
      ${interactive ? "cursor:pointer;" : "cursor:default;"}
      contain: layout style;
    }

    .freed-map-shell .freed-map-marker-body {
      transition: box-shadow 160ms ease, border-color 160ms ease, filter 160ms ease, scale 160ms ease;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker-body {
      transition: none;
      box-shadow: 0 0 0 1px var(--theme-border-subtle);
      filter: none;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker[data-map-moving-priority="primary"] {
      will-change: transform;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker[data-map-moving-priority="deferred"] {
      display: none;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker[data-map-marker-simplified="true"] [data-avatar-fallback] {
      display: none;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker-glow,
    .freed-map-shell[data-map-moving="true"] .freed-map-marker-tint,
    .freed-map-shell[data-map-moving="true"] .freed-map-marker-halo,
    .freed-map-shell[data-map-moving="true"] .freed-map-marker-badge {
      display: none;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-marker-image {
      opacity: 0.72;
      filter: none;
    }

    .freed-map-shell[data-map-moving="true"] .freed-map-grid-overlay {
      display: none;
    }

    .freed-map-shell .freed-map-marker:hover,
    .freed-map-shell .freed-map-marker[data-map-marker-open="true"] {
      z-index: 1;
    }

    .freed-map-shell .freed-map-marker:hover .freed-map-marker-body,
    .freed-map-shell .freed-map-marker[data-map-marker-open="true"] .freed-map-marker-body {
      scale: 1.06;
      filter: brightness(1.06);
      box-shadow:
        0 0 0 1px var(--theme-border-strong),
        var(--theme-map-marker-hover-shadow);
    }

    .freed-map-fallback-scan {
      background: var(--theme-shell-background);
      contain: layout style;
    }
  `;
}

function fallbackPosition(
  marker: LocationMarkerSummary,
  viewportInsets: MapViewportInsets | undefined,
  surfaceSize: MapSurfaceSize,
) {
  const leftRatio = Math.min(0.96, Math.max(0.04, (marker.lng + 180) / 360));
  const topRatio = Math.min(0.94, Math.max(0.06, (90 - marker.lat) / 180));
  const leftInset = viewportInsets?.left ?? 0;
  const rightInset = viewportInsets?.right ?? 0;
  const topInset = viewportInsets?.top ?? 0;
  const bottomInset = viewportInsets?.bottom ?? 0;
  const availableWidth = Math.max(1, surfaceSize.width - leftInset - rightInset);
  const availableHeight = Math.max(1, surfaceSize.height - topInset - bottomInset);
  return {
    left: `${Math.round(leftInset + availableWidth * leftRatio)}px`,
    top: `${Math.round(topInset + availableHeight * topRatio)}px`,
  };
}

function fallbackLabel(marker: LocationMarkerSummary) {
  return marker.friend?.name ?? marker.item.author.displayName;
}

function mapMovingPriority(markerIndex: number, useDenseMarkers: boolean): MapMarkerMovingPriority {
  return useDenseMarkers && markerIndex >= MAP_MOVING_MARKER_PAINT_LIMIT
    ? "deferred"
    : "primary";
}

export function getRenderedMapMarkers(
  markers: LocationMarkerSummary[],
  focusedMarkerKey?: string | null,
): LocationMarkerSummary[] {
  const coincidentGroups = new Map<
    string,
    {
      newest: LocationMarkerSummary;
      focused: LocationMarkerSummary | null;
      updateCount: number;
      markerCount: number;
    }
  >();

  for (const marker of markers) {
    const coordinateKey = `${marker.lat}:${marker.lng}`;
    const group = coincidentGroups.get(coordinateKey);

    if (!group) {
      coincidentGroups.set(coordinateKey, {
        newest: marker,
        focused: marker.key === focusedMarkerKey ? marker : null,
        updateCount: marker.groupCount,
        markerCount: 1,
      });
      continue;
    }

    if (marker.seenAt > group.newest.seenAt) {
      group.newest = marker;
    }
    if (marker.key === focusedMarkerKey) {
      group.focused = marker;
    }
    group.updateCount += marker.groupCount;
    group.markerCount += 1;
  }

  const distinctLocationMarkers = Array.from(coincidentGroups.values(), (group) => {
    const representative = group.focused ?? group.newest;
    if (group.markerCount === 1) return representative;

    // City-level geocoding often gives many people the same exact coordinate.
    // Paint that location once instead of stacking dozens of translucent marker
    // shadows into concentric rings. The badge remains truthful by reporting the
    // total number of updates represented at this spot.
    return {
      ...representative,
      groupCount: group.updateCount,
    };
  });

  const baseRenderedMarkers = distinctLocationMarkers.length <= MAP_DOM_MARKER_LIMIT
    ? distinctLocationMarkers
    : distinctLocationMarkers.slice(0, MAP_DOM_MARKER_LIMIT);
  if (distinctLocationMarkers.length <= MAP_DOM_MARKER_LIMIT) return baseRenderedMarkers;
  if (!focusedMarkerKey || baseRenderedMarkers.some((marker) => marker.key === focusedMarkerKey)) {
    return baseRenderedMarkers;
  }

  const focusedMarker = distinctLocationMarkers.find((marker) => marker.key === focusedMarkerKey);
  if (!focusedMarker) return baseRenderedMarkers;
  return [...baseRenderedMarkers.slice(0, MAP_DOM_MARKER_LIMIT - 1), focusedMarker];
}

export function getMapMovingPriority(
  markerIndex: number,
  markerKey: string,
  useDenseMarkers: boolean,
  focusedMarkerKey?: string | null,
): MapMarkerMovingPriority {
  if (markerKey === focusedMarkerKey) return "primary";
  return mapMovingPriority(markerIndex, useDenseMarkers);
}

function areLocationMarkersRenderEquivalent(
  current: LocationMarkerSummary,
  next: LocationMarkerSummary,
): boolean {
  const currentFriend = current.friend;
  const nextFriend = next.friend;
  if (
    currentFriend?.id !== nextFriend?.id ||
    currentFriend?.name !== nextFriend?.name ||
    (currentFriend?.avatarUrl ?? null) !== (nextFriend?.avatarUrl ?? null) ||
    currentFriend?.relationshipStatus !== nextFriend?.relationshipStatus
  ) {
    return false;
  }

  const currentItem = current.item;
  const nextItem = next.item;
  return (
    current.key === next.key &&
    current.authorKey === next.authorKey &&
    current.lat === next.lat &&
    current.lng === next.lng &&
    current.label === next.label &&
    current.groupCount === next.groupCount &&
    current.seenAt === next.seenAt &&
    currentItem.globalId === nextItem.globalId &&
    currentItem.platform === nextItem.platform &&
    currentItem.contentType === nextItem.contentType &&
    currentItem.author.id === nextItem.author.id &&
    currentItem.author.displayName === nextItem.author.displayName &&
    (currentItem.author.avatarUrl ?? null) === (nextItem.author.avatarUrl ?? null) &&
    (currentItem.content.text ?? null) === (nextItem.content.text ?? null)
  );
}

export function areLocationMarkerListsRenderEquivalent(
  current: LocationMarkerSummary[],
  next: LocationMarkerSummary[],
): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let index = 0; index < current.length; index += 1) {
    if (!areLocationMarkersRenderEquivalent(current[index], next[index])) {
      return false;
    }
  }

  return true;
}

function useStableLocationMarkers(markers: LocationMarkerSummary[]): LocationMarkerSummary[] {
  const stableMarkersRef = useRef(markers);
  if (!areLocationMarkerListsRenderEquivalent(stableMarkersRef.current, markers)) {
    stableMarkersRef.current = markers;
  }
  return stableMarkersRef.current;
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

function mapCameraPadding(viewportInsets?: MapViewportInsets) {
  return {
    top: MAP_CAMERA_PADDING_PX + (viewportInsets?.top ?? 0),
    right: MAP_CAMERA_PADDING_PX + (viewportInsets?.right ?? 0),
    bottom: MAP_CAMERA_PADDING_PX + (viewportInsets?.bottom ?? 0),
    left: MAP_CAMERA_PADDING_PX + (viewportInsets?.left ?? 0),
  };
}

function mapCameraOffset(viewportInsets?: MapViewportInsets): [number, number] {
  return [
    ((viewportInsets?.left ?? 0) - (viewportInsets?.right ?? 0)) / 2,
    ((viewportInsets?.top ?? 0) - (viewportInsets?.bottom ?? 0)) / 2,
  ];
}

export function fitMapToMarkers(
  map: MapInstance,
  markers: LocationMarkerSummary[],
  focusedMarkerKey?: string | null,
  viewportInsets?: MapViewportInsets,
) {
  if (markers.length === 0) return;

  const focusedMarker = focusedMarkerKey
    ? markers.find((marker) => marker.key === focusedMarkerKey)
    : null;

  if (focusedMarker) {
    map.flyTo({
      center: [focusedMarker.lng, focusedMarker.lat],
      zoom: 7.5,
      duration: 600,
      offset: mapCameraOffset(viewportInsets),
    });
    return;
  }

  if (markers.length === 1) {
    const marker = markers[0];
    map.flyTo({
      center: [marker.lng, marker.lat],
      zoom: 4.5,
      duration: 600,
      offset: mapCameraOffset(viewportInsets),
    });
    return;
  }

  let minLat = markers[0].lat;
  let maxLat = markers[0].lat;
  let minLng = markers[0].lng;
  let maxLng = markers[0].lng;

  for (let index = 1; index < markers.length; index += 1) {
    const marker = markers[index];
    if (marker.lat < minLat) minLat = marker.lat;
    if (marker.lat > maxLat) maxLat = marker.lat;
    if (marker.lng < minLng) minLng = marker.lng;
    if (marker.lng > maxLng) maxLng = marker.lng;
  }

  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    {
      padding: mapCameraPadding(viewportInsets),
      duration: 600,
      // Closely clustered updates can otherwise drive fitBounds to building
      // level. At that scale the map looks like an empty canvas with a few
      // oversized road strokes, even though every tile loaded successfully.
      maxZoom: MAP_CLUSTER_MAX_ZOOM,
    }
  );
}

export function MapSurface({
  markers,
  focusedMarkerKey,
  interactive = true,
  themeId,
  viewportInsets,
  onOpenFriend,
  onPromoteAccount,
  onLinkAccount,
  onOpenPost,
  emptyTitle = "No geo-tagged posts yet.",
  emptyBody = "Posts with location data will show up here.",
  showFitAllControl = false,
}: MapSurfaceProps) {
  const resolvedThemeId = themeId ?? DEFAULT_THEME_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mapModuleRef = useRef<MapLibreModule | null>(null);
  const markersRef = useRef<MapMarkerRecord[]>([]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const fallbackMovingTimeoutRef = useRef<number | null>(null);
  const nativeMarkerRestoreTimeoutRef = useRef<number | null>(null);
  const mapLifecycleRef = useRef(0);
  const mapStyleRequestRef = useRef(0);
  const desiredMapThemeRef = useRef(resolvedThemeId);
  const appliedMapThemeRef = useRef<ThemeId | null>(null);
  const useDenseMarkersRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapGeneration, setMapGeneration] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fallbackMoving, setFallbackMoving] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState<MapSurfaceSize>({ width: 900, height: 560 });
  const [selectedFallbackMarkerKey, setSelectedFallbackMarkerKey] = useState<string | null>(null);
  const activePopupRef = useRef<PopupInstance | null>(null);
  const activePopupKeyRef = useRef<string | null>(null);
  const activePopupMarkerElementRef = useRef<HTMLElement | null>(null);
  const activePopupLayoutCleanupRef = useRef<(() => void) | null>(null);
  const fallbackPopupRef = useRef<HTMLDivElement | null>(null);
  const viewportInsetsRef = useRef(viewportInsets);
  viewportInsetsRef.current = viewportInsets;
  desiredMapThemeRef.current = resolvedThemeId;
  const actionHandlersRef = useRef({
    onOpenFriend,
    onPromoteAccount,
    onLinkAccount,
    onOpenPost,
  });

  const stableMarkers = useStableLocationMarkers(markers);
  const renderedMarkers = useMemo(() => {
    return getRenderedMapMarkers(stableMarkers, focusedMarkerKey);
  }, [focusedMarkerKey, stableMarkers]);
  const useDenseMarkers = stableMarkers.length > MAP_DOM_MARKER_LIMIT;
  const showMarkerAvatars = !useDenseMarkers;
  const avatarPalette = useMemo(
    () => createFriendAvatarPalette(resolvedThemeId),
    [resolvedThemeId]
  );
  const mapPalette = useMemo(
    () => getThemeDefinition(resolvedThemeId).map,
    [resolvedThemeId]
  );
  const selectedFallbackMarker = useMemo(
    () => renderedMarkers.find((marker) => marker.key === selectedFallbackMarkerKey) ?? null,
    [renderedMarkers, selectedFallbackMarkerKey]
  );
  const showFallback = loadFailed || !mapReady;
  const fallbackRenderedMarkers = useMemo(() => {
    if (!showFallback || !fallbackMoving || !useDenseMarkers) return renderedMarkers;
    return renderedMarkers.filter((marker, markerIndex) => {
      return getMapMovingPriority(
        markerIndex,
        marker.key,
        true,
        focusedMarkerKey,
      ) === "primary";
    });
  }, [fallbackMoving, focusedMarkerKey, renderedMarkers, showFallback, useDenseMarkers]);
  const closeActivePopup = useCallback(() => {
    activePopupLayoutCleanupRef.current?.();
    activePopupLayoutCleanupRef.current = null;
    activePopupRef.current?.remove();
    activePopupRef.current = null;
    activePopupKeyRef.current = null;
    activePopupMarkerElementRef.current?.removeAttribute("data-map-marker-open");
    activePopupMarkerElementRef.current = null;
  }, []);

  useEffect(() => {
    const panel = fallbackPopupRef.current;
    const shell = shellRef.current;
    if (!panel || !shell || !selectedFallbackMarker) return;
    const anchor = shell.querySelector<HTMLElement>(
      `[data-map-marker-key="${CSS.escape(selectedFallbackMarker.key)}"]`,
    );
    if (!anchor) return;

    return setupMapFloatingPanelLayout({
      panel,
      anchor,
      shell,
      getViewportInsets: () => viewportInsetsRef.current,
    });
  }, [selectedFallbackMarker, viewportInsets]);
  const clearFallbackMovingTimeout = useCallback(() => {
    if (fallbackMovingTimeoutRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(fallbackMovingTimeoutRef.current);
    fallbackMovingTimeoutRef.current = null;
  }, []);
  const clearNativeMarkerRestoreTimeout = useCallback(() => {
    if (nativeMarkerRestoreTimeoutRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(nativeMarkerRestoreTimeoutRef.current);
    nativeMarkerRestoreTimeoutRef.current = null;
  }, []);
  const syncNativeMarkerMotionLayer = useCallback((moving: boolean) => {
    const map = mapRef.current;
    if (!map) return;

    const shouldCullDeferredMarkers = moving && useDenseMarkersRef.current;
    for (const record of markersRef.current) {
      const shouldAttach = !shouldCullDeferredMarkers || record.priority === "primary";
      if (shouldAttach === record.attached) continue;

      if (shouldAttach) {
        try {
          record.marker.addTo(map);
          record.attached = true;
        } catch (error) {
          record.attached = false;
          console.error("[MapSurface] Failed to restore map marker", error);
        }
        continue;
      }

      record.marker.remove();
      record.attached = false;
    }
  }, []);
  const applyMapThemeStyle = useCallback((nextThemeId: ThemeId) => {
    const map = mapRef.current;
    if (!map || appliedMapThemeRef.current === nextThemeId) return;

    const requestId = mapStyleRequestRef.current + 1;
    mapStyleRequestRef.current = requestId;
    void buildThemedMapStyle(nextThemeId).then((mapStyle) => {
      if (
        mapStyleRequestRef.current !== requestId
        || mapRef.current !== map
        || desiredMapThemeRef.current !== nextThemeId
      ) return;

      try {
        // Replacing the style preserves the live MapLibre camera and canvas.
        // Recreating the map here made transient theme hovers reset and refit
        // the camera, while also churning a WebGL context for a palette change.
        map.setStyle(mapStyle);
        appliedMapThemeRef.current = nextThemeId;
      } catch (error) {
        console.error("[MapSurface] Failed to apply the themed map style", error);
      }
    }).catch((error) => {
      if (
        mapStyleRequestRef.current === requestId
        && mapRef.current === map
        && desiredMapThemeRef.current === nextThemeId
      ) {
        console.error("[MapSurface] Failed to load the themed map style", error);
      }
    });
  }, []);
  const setShellMoving = useCallback((moving: boolean) => {
    const shell = shellRef.current;
    if (!shell) return;
    shell.dataset.mapMoving = moving ? "true" : "false";
  }, []);
  const markFallbackMoving = useCallback(() => {
    if (!showFallback || typeof window === "undefined") return;
    setFallbackMoving(true);
    setShellMoving(true);
    clearFallbackMovingTimeout();
    fallbackMovingTimeoutRef.current = window.setTimeout(() => {
      fallbackMovingTimeoutRef.current = null;
      setFallbackMoving(false);
      setShellMoving(false);
    }, MAP_DENSE_MARKER_RESTORE_DELAY_MS);
  }, [clearFallbackMovingTimeout, setShellMoving, showFallback]);
  const handleFallbackWheel = useCallback((_event: WheelEvent<HTMLDivElement>) => {
    markFallbackMoving();
  }, [markFallbackMoving]);
  const handleFallbackPointerDown = useCallback((_event: PointerEvent<HTMLDivElement>) => {
    markFallbackMoving();
  }, [markFallbackMoving]);
  const handleFallbackPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0) return;
    markFallbackMoving();
  }, [markFallbackMoving]);

  useEffect(() => {
    useDenseMarkersRef.current = useDenseMarkers;
    if (!useDenseMarkers) {
      syncNativeMarkerMotionLayer(false);
    }
  }, [syncNativeMarkerMotionLayer, useDenseMarkers]);

  useEffect(() => () => {
    clearFallbackMovingTimeout();
    clearNativeMarkerRestoreTimeout();
    setShellMoving(false);
  }, [clearFallbackMovingTimeout, clearNativeMarkerRestoreTimeout, setShellMoving]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateSize = () => {
      const rect = shell.getBoundingClientRect();
      setSurfaceSize((current) => {
        const next = {
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (showFallback) return;
    clearFallbackMovingTimeout();
    setFallbackMoving(false);
  }, [clearFallbackMovingTimeout, showFallback]);

  useEffect(() => {
    actionHandlersRef.current = {
      onOpenFriend,
      onPromoteAccount,
      onLinkAccount,
      onOpenPost,
    };
  }, [onLinkAccount, onOpenFriend, onOpenPost, onPromoteAccount]);

  useEffect(() => {
    if (!containerRef.current) return;
    const lifecycleId = mapLifecycleRef.current + 1;
    mapLifecycleRef.current = lifecycleId;
    let cancelled = false;
    setShellMoving(false);
    setMapReady(false);
    setLoadFailed(false);

    if (shouldForceMapFallback()) {
      setLoadFailed(true);
      return () => {
        cancelled = true;
        closeActivePopup();
        clearNativeMarkerRestoreTimeout();
        for (const { marker } of markersRef.current) marker.remove();
        markersRef.current = [];
        if (mapRef.current) disposeMapInstance(mapRef.current);
        mapRef.current = null;
      };
    }

    const initialThemeId = desiredMapThemeRef.current;
    void Promise.all([
      loadMapLibre(),
      buildThemedMapStyle(initialThemeId),
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
          // A full device-pixel-ratio canvas and MapLibre's dynamically sized
          // tile cache retained hundreds of megabytes after visiting Map on a
          // Retina display. The map is a browsing surface, not a print canvas.
          // Bound both owners so one route cannot consume the memory saved by
          // moving the Library corpus into SQLite.
          pixelRatio: Math.min(window.devicePixelRatio || 1, MAP_MAX_PIXEL_RATIO),
          maxTileCacheSize: MAP_MAX_TILE_CACHE_SIZE,
          interactive,
          attributionControl: false,
        });
        mapRef.current = map;
        appliedMapThemeRef.current = initialThemeId;
        const setMoving = () => {
          clearNativeMarkerRestoreTimeout();
          syncNativeMarkerMotionLayer(true);
          setShellMoving(true);
        };
        const clearMoving = () => {
          clearNativeMarkerRestoreTimeout();
          nativeMarkerRestoreTimeoutRef.current = window.setTimeout(() => {
            nativeMarkerRestoreTimeoutRef.current = null;
            syncNativeMarkerMotionLayer(false);
            setShellMoving(false);
          }, MAP_DENSE_MARKER_RESTORE_DELAY_MS);
        };
        map.on("movestart", setMoving);
        map.on("zoomstart", setMoving);
        map.on("moveend", clearMoving);
        map.on("zoomend", clearMoving);
        setMapGeneration(lifecycleId);
        setMapReady(true);
        setTimeout(() => map.resize(), 0);
        if (desiredMapThemeRef.current !== initialThemeId) {
          applyMapThemeStyle(desiredMapThemeRef.current);
        }
      } catch (error) {
        console.error("[MapSurface] Failed to initialize MapLibre", error);
        if (mapRef.current) disposeMapInstance(mapRef.current);
        mapRef.current = null;
        setLoadFailed(true);
      }
    }).catch((error) => {
      console.error("[MapSurface] Failed to load the themed map", error);
      setLoadFailed(true);
    });

    return () => {
      cancelled = true;
      mapLifecycleRef.current += 1;
      mapStyleRequestRef.current += 1;
      appliedMapThemeRef.current = null;
      closeActivePopup();
      clearNativeMarkerRestoreTimeout();
      for (const { marker } of markersRef.current) marker.remove();
      markersRef.current = [];
      if (mapRef.current) disposeMapInstance(mapRef.current);
      mapRef.current = null;
      setShellMoving(false);
    };
  }, [applyMapThemeStyle, clearNativeMarkerRestoreTimeout, closeActivePopup, interactive, setShellMoving, syncNativeMarkerMotionLayer]);

  useEffect(() => {
    applyMapThemeStyle(resolvedThemeId);
  }, [applyMapThemeStyle, resolvedThemeId]);

  useEffect(() => {
    if (
      !mapReady
      || !mapRef.current
      || !mapModuleRef.current
      || mapGeneration !== mapLifecycleRef.current
    ) return;

    closeActivePopup();
    clearNativeMarkerRestoreTimeout();
    for (const { marker } of markersRef.current) marker.remove();
    markersRef.current = [];
    setShellMoving(false);

    const map = mapRef.current;
    const maplibre = mapModuleRef.current;
    const lifecycleId = mapLifecycleRef.current;
    const handleMapClick = () => closeActivePopup();
    map.on("click", handleMapClick);
    let stoppedEarly = false;

    for (const [markerIndex, markerData] of renderedMarkers.entries()) {
      if (stoppedEarly) break;
      const priority = getMapMovingPriority(
        markerIndex,
        markerData.key,
        useDenseMarkers,
        focusedMarkerKey,
      );
      const element = createMarkerElement(markerData, avatarPalette, {
        showAvatar: showMarkerAvatars,
        simplified: useDenseMarkers,
      });
      element.dataset.mapMovingPriority = priority;
      const marker = new maplibre.Marker({ element }).setLngLat([
        markerData.lng,
        markerData.lat,
      ]);

      if (interactive) {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (activePopupKeyRef.current === markerData.key) {
            closeActivePopup();
            return;
          }
          closeActivePopup();
          const currentHandlers = actionHandlersRef.current;
          const popupElement = document.createElement("div");
          popupElement.className = "freed-map-popup";
          popupElement.dataset.mapFloatingPanel = "popup";
          popupElement.setAttribute("data-testid", "map-floating-panel");
          const popupContent = buildPopupContent(
            markerData,
            currentHandlers.onOpenFriend
              ? (marker) => actionHandlersRef.current.onOpenFriend?.(marker)
              : undefined,
            currentHandlers.onPromoteAccount
              ? (marker) => actionHandlersRef.current.onPromoteAccount?.(marker)
              : undefined,
            currentHandlers.onLinkAccount
              ? (marker) => actionHandlersRef.current.onLinkAccount?.(marker)
              : undefined,
            currentHandlers.onOpenPost
              ? (marker) => actionHandlersRef.current.onOpenPost?.(marker)
              : undefined,
          );
          popupContent.classList.add("maplibregl-popup-content");
          const popupArrow = document.createElement("span");
          popupArrow.className = "freed-map-popup-arrow";
          popupArrow.dataset.mapPopupArrow = "true";
          popupElement.append(popupContent, popupArrow);
          document.body.appendChild(popupElement);
          activePopupLayoutCleanupRef.current = setupMapFloatingPanelLayout({
            panel: popupElement,
            anchor: element,
            shell: shellRef.current ?? map.getContainer(),
            map,
            getViewportInsets: () => viewportInsetsRef.current,
          });
          activePopupRef.current = popupElement;
          activePopupKeyRef.current = markerData.key;
          activePopupMarkerElementRef.current = element;
          element.dataset.mapMarkerOpen = "true";
        });
      }

      if (mapRef.current !== map || mapLifecycleRef.current !== lifecycleId) {
        marker.remove();
        stoppedEarly = true;
        break;
      }

      try {
        marker.addTo(map);
        markersRef.current.push({ marker, priority, attached: true });
      } catch (error) {
        marker.remove();
        if (mapRef.current === map && mapLifecycleRef.current === lifecycleId) {
          console.error("[MapSurface] Failed to attach map marker", error);
          setLoadFailed(true);
        }
        stoppedEarly = true;
      }
    }

    return () => {
      map.off("click", handleMapClick);
      closeActivePopup();
    };
  }, [
    avatarPalette,
    clearNativeMarkerRestoreTimeout,
    closeActivePopup,
    focusedMarkerKey,
    interactive,
    mapGeneration,
    mapReady,
    renderedMarkers,
    setShellMoving,
    showMarkerAvatars,
    useDenseMarkers,
  ]);

  useEffect(() => {
    if (
      !mapReady
      || !mapRef.current
      || mapGeneration !== mapLifecycleRef.current
    ) return;
    fitMapToMarkers(mapRef.current, stableMarkers, focusedMarkerKey, viewportInsets);
  }, [focusedMarkerKey, mapGeneration, mapReady, stableMarkers, viewportInsets]);

  const handleFitAll = useCallback(() => {
    closeActivePopup();
    setSelectedFallbackMarkerKey(null);
    if (!mapReady || loadFailed || !mapRef.current) return;
    fitMapToMarkers(mapRef.current, stableMarkers, null, viewportInsets);
  }, [closeActivePopup, loadFailed, mapReady, stableMarkers, viewportInsets]);

  return (
    <div
      ref={shellRef}
      data-testid="map-surface"
      data-map-theme={resolvedThemeId}
      data-map-rendered-markers={renderedMarkers.length}
      data-map-total-markers={stableMarkers.length}
      data-map-dense={useDenseMarkers ? "true" : "false"}
      data-map-ready={mapReady && !loadFailed ? "true" : "false"}
      data-map-moving="false"
      className="freed-map-shell relative h-full w-full overflow-hidden"
      onWheel={showFallback ? handleFallbackWheel : undefined}
      onPointerDown={showFallback ? handleFallbackPointerDown : undefined}
      onPointerMove={showFallback ? handleFallbackPointerMove : undefined}
    >
      <style>{mapStyles(interactive)}</style>
      {showFitAllControl && (
        <div
          data-testid="map-fit-all-control"
          data-map-floating-control="fit-all"
          data-map-floating-control-edge="top"
          className="pointer-events-none absolute z-20"
          style={{
            top: "max(var(--freed-canvas-viewport-inset-top, 0px), var(--feed-card-gap, 8px))",
            right: "max(var(--freed-canvas-viewport-inset-right, 0px), var(--feed-card-gap, 8px))",
          }}
        >
          <button
            type="button"
            className={`${CANVAS_CONTROL_BUTTON_CLASS} pointer-events-auto`}
            disabled={stableMarkers.length === 0}
            onClick={handleFitAll}
          >
            Fit all
          </button>
        </div>
      )}
      <div className="absolute inset-0 overflow-hidden">
        <div
          ref={containerRef}
          className={`h-full w-full ${showFallback ? "invisible" : "visible"}`}
        />
        <div
          className="freed-map-grid-overlay pointer-events-none absolute inset-0 [background-size:88px_88px]"
          style={{
            backgroundImage: mapGridBackground(mapPalette.boundary),
            opacity: mapPalette.gridOpacity,
          }}
        />
        {showFallback && renderedMarkers.length > 0 && (
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
          {fallbackRenderedMarkers.map((marker) => {
            const position = fallbackPosition(marker, viewportInsets, surfaceSize);
            const renderedMarkerIndex = renderedMarkers.findIndex((entry) => entry.key === marker.key);
            return (
              <button
                key={marker.key}
                type="button"
                data-map-marker-key={marker.key}
                data-map-moving-priority={getMapMovingPriority(
                  renderedMarkerIndex,
                  marker.key,
                  useDenseMarkers,
                  focusedMarkerKey,
                )}
                className="freed-map-marker absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1.5 text-[11px] text-[color:var(--theme-text-primary)]"
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
            <div
              ref={fallbackPopupRef}
              data-testid="map-fallback-popup"
              data-map-floating-panel="popup"
              className="freed-map-popup theme-dialog-shell fixed p-5"
            >
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
                {hasConfirmedFriend(selectedFallbackMarker) && onOpenFriend && (
                  <button
                    type="button"
                    className="btn-primary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onOpenFriend(selectedFallbackMarker)}
                  >
                    Open Friend
                  </button>
                )}
                {!hasConfirmedFriend(selectedFallbackMarker) && onPromoteAccount && (
                  <button
                    type="button"
                    className="btn-primary w-full rounded-xl px-3.5 py-2 text-xs"
                    onClick={() => onPromoteAccount(selectedFallbackMarker)}
                  >
                    Promote to friend
                  </button>
                )}
                {!hasConfirmedFriend(selectedFallbackMarker) && onLinkAccount && (
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
              <span
                className="freed-map-popup-arrow"
                data-map-popup-arrow="true"
              />
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
