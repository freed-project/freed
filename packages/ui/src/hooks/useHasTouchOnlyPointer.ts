import { useEffect, useState } from "react";

function detectTouchOnlyPointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  const coarsePointerMedia = window.matchMedia("(pointer: coarse)");
  const hoverCapableMedia = window.matchMedia("(any-hover: hover)");
  return coarsePointerMedia.matches && !hoverCapableMedia.matches;
}

export function useHasTouchOnlyPointer(): boolean {
  const [hasTouchOnlyPointer, setHasTouchOnlyPointer] = useState(detectTouchOnlyPointer);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const coarsePointerMedia = window.matchMedia("(pointer: coarse)");
    const hoverCapableMedia = window.matchMedia("(any-hover: hover)");
    const updatePointerMode = () => {
      setHasTouchOnlyPointer(coarsePointerMedia.matches && !hoverCapableMedia.matches);
    };

    updatePointerMode();
    coarsePointerMedia.addEventListener?.("change", updatePointerMode);
    hoverCapableMedia.addEventListener?.("change", updatePointerMode);
    return () => {
      coarsePointerMedia.removeEventListener?.("change", updatePointerMode);
      hoverCapableMedia.removeEventListener?.("change", updatePointerMode);
    };
  }, []);

  return hasTouchOnlyPointer;
}
