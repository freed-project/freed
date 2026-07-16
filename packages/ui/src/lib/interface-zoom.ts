import { useEffect, useState } from "react";

export const INTERFACE_ZOOM_MIN = 75;
export const INTERFACE_ZOOM_MAX = 200;
export const INTERFACE_ZOOM_STEP = 5;
export const INTERFACE_ZOOM_DEFAULT = 100;

const STORAGE_KEY = "freed-interface-zoom";
const CHANGE_EVENT = "freed-interface-zoom-change";

export function normalizeInterfaceZoom(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return INTERFACE_ZOOM_DEFAULT;
  }
  const rounded = Math.round(parsed / INTERFACE_ZOOM_STEP) * INTERFACE_ZOOM_STEP;
  return Math.min(INTERFACE_ZOOM_MAX, Math.max(INTERFACE_ZOOM_MIN, rounded));
}

export function formatInterfaceZoom(value: number): string {
  return `${normalizeInterfaceZoom(value).toLocaleString()}%`;
}

export function getInterfaceChromeScale(value: number): number {
  return Math.max(1, normalizeInterfaceZoom(value) / INTERFACE_ZOOM_DEFAULT);
}

export function scaleInterfaceChromePx(value: number, zoom: number): number {
  return Math.round(value * getInterfaceChromeScale(zoom));
}

export function getInterfaceZoom(): number {
  if (typeof window === "undefined") {
    return INTERFACE_ZOOM_DEFAULT;
  }
  return normalizeInterfaceZoom(window.localStorage.getItem(STORAGE_KEY));
}

export function applyInterfaceZoomToDocument(nextZoom = getInterfaceZoom()): void {
  if (typeof document === "undefined") {
    return;
  }

  const zoom = normalizeInterfaceZoom(nextZoom);
  document.documentElement.style.fontSize =
    zoom === INTERFACE_ZOOM_DEFAULT ? "" : `${zoom}%`;
  document.documentElement.dataset.interfaceZoom = String(zoom);
}

export function setInterfaceZoom(nextZoom: number): void {
  if (typeof window === "undefined") {
    return;
  }

  const zoom = normalizeInterfaceZoom(nextZoom);
  window.localStorage.setItem(STORAGE_KEY, String(zoom));
  applyInterfaceZoomToDocument(zoom);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: zoom }));
}

export function resetInterfaceZoom(): void {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(STORAGE_KEY);
  applyInterfaceZoomToDocument(INTERFACE_ZOOM_DEFAULT);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: INTERFACE_ZOOM_DEFAULT }));
}

export function useInterfaceZoom(): [number, (nextZoom: number) => void] {
  const [zoom, setZoomState] = useState<number>(() => getInterfaceZoom());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        const nextZoom = normalizeInterfaceZoom(event.detail as number);
        applyInterfaceZoomToDocument(nextZoom);
        setZoomState(nextZoom);
        return;
      }

      const nextZoom = getInterfaceZoom();
      applyInterfaceZoomToDocument(nextZoom);
      setZoomState(nextZoom);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }

      const nextZoom = normalizeInterfaceZoom(event.newValue);
      applyInterfaceZoomToDocument(nextZoom);
      setZoomState(nextZoom);
    };

    applyInterfaceZoomToDocument(getInterfaceZoom());
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateZoom = (nextZoom: number) => {
    setInterfaceZoom(nextZoom);
    setZoomState(normalizeInterfaceZoom(nextZoom));
  };

  return [zoom, updateZoom];
}
