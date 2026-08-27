import { useEffect, useLayoutEffect, useRef } from "react";
import {
  canonicalizeNavigationState,
  navigationStatesEqual,
  parseNavigationState,
  serializeNavigationState,
  type NavigationState,
} from "@freed/shared";
import { useSelectedLibraryItemValidity } from "@freed/ui/hooks/useSelectedLibraryItemValidity";
import { readPwaLibraryCoreItemDetail } from "./library-core-runtime";
import { useAppStore } from "./store";

function currentPathWithSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function snapshotNavigationState(): NavigationState {
  const state = useAppStore.getState();
  return {
    activeView: state.activeView,
    activeFilter: state.activeFilter,
    selectedItemId: state.selectedItemId,
  };
}

export function useBrowserNavigationHistory(enabled: boolean): void {
  const activeView = useAppStore((state) => state.activeView);
  const activeFilter = useAppStore((state) => state.activeFilter);
  const selectedItemId = useAppStore((state) => state.selectedItemId);
  const setSelectedItem = useAppStore((state) => state.setSelectedItem);
  const isInitialized = useAppStore((state) => state.isInitialized);
  useSelectedLibraryItemValidity({
    enabled,
    isInitialized,
    readLibraryItemDetail: readPwaLibraryCoreItemDetail,
    selectedItemId,
    setSelectedItem,
  });

  const bootstrappedRef = useRef(false);
  const skipWriteRef = useRef(false);
  const writeTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled || bootstrappedRef.current) return;

    const parsed = parseNavigationState(window.location);
    useAppStore.setState({
      activeView: parsed.activeView,
      activeFilter: parsed.activeFilter,
      selectedItemId: parsed.selectedItemId,
      selectedFriendId: null,
    });
    window.history.replaceState(window.history.state, "", serializeNavigationState(parsed));
    bootstrappedRef.current = true;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !bootstrappedRef.current) return;

    const onPopState = () => {
      const parsed = parseNavigationState(window.location);
      skipWriteRef.current = true;
      useAppStore.setState({
        activeView: parsed.activeView,
        activeFilter: parsed.activeFilter,
        selectedItemId: parsed.selectedItemId,
        selectedFriendId: null,
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !bootstrappedRef.current) return;

    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
    }

    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = null;

      const rawState = snapshotNavigationState();
      const canonicalState = canonicalizeNavigationState(rawState);
      const nextUrl = serializeNavigationState(canonicalState);
      const currentUrl = currentPathWithSearch();

      if (skipWriteRef.current) {
        skipWriteRef.current = false;
        if (nextUrl !== currentUrl) {
          window.history.replaceState(window.history.state, "", nextUrl);
        }
        return;
      }

      if (nextUrl === currentUrl) return;

      const shouldReplace = !navigationStatesEqual(rawState, canonicalState);
      window.history[shouldReplace ? "replaceState" : "pushState"](window.history.state, "", nextUrl);
    }, 0);

    return () => {
      if (writeTimerRef.current !== null) {
        window.clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
  }, [activeFilter, activeView, enabled, isInitialized, selectedItemId]);
}
