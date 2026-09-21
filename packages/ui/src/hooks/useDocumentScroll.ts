import { useIsMobile } from "./useIsMobile.js";
import { useIsMobileDevice } from "./useIsMobileDevice.js";

/** Keep phone scrolling across rotation, but contain wide tablet layouts. */
export function useDocumentScroll(): boolean {
  const isMobileViewport = useIsMobile();
  const isMobileDevice = useIsMobileDevice();
  const phoneScreen = typeof window !== "undefined" &&
    Math.min(window.screen.width, window.screen.height) > 0 &&
    Math.min(window.screen.width, window.screen.height) < 768;

  return isMobileViewport || (isMobileDevice && phoneScreen);
}
