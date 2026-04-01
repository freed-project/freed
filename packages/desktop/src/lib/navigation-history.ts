import { useEffect, useRef } from "react";
import {
  canonicalizeNavigationState,
  navigationStatesEqual,
  parseNavigationState,
  serializeNavigationState,
  type NavigationState,
} from "@freed/shared";
import { useAppStore } from "./store";

function snapshotNavigationState(): NavigationState {
  const state = useAppStore.getState();
  return {
    activeView: state.activeView,
    activeFilter: state.activeFilter,
    selectedItemId: state.selectedItemId,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    target.isContentEditable
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
  );
}

export function useDesktopNavigationHistory(enabled: boolean): void {
  const activeView = useAppStore((state) => state.activeView);
  const activeFilter = useAppStore((state) => state.activeFilter);
  const selectedItemId = useAppStore((state) => state.selectedItemId);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const items = useAppStore((state) => state.items);

  const historyStackRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const skipRecordRef = useRef(false);
  const recordTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.code === "BracketLeft" || event.key === "[") {
        if (historyIndexRef.current <= 0) return;
        event.preventDefault();
        skipRecordRef.current = true;
        historyIndexRef.current -= 1;
        const nextState = parseNavigationState(historyStackRef.current[historyIndexRef.current]);
        useAppStore.setState({
          activeView: nextState.activeView,
          activeFilter: nextState.activeFilter,
          selectedItemId: nextState.selectedItemId,
          selectedFriendId: null,
        });
      } else if (event.code === "BracketRight" || event.key === "]") {
        if (historyIndexRef.current >= historyStackRef.current.length - 1) return;
        event.preventDefault();
        skipRecordRef.current = true;
        historyIndexRef.current += 1;
        const nextState = parseNavigationState(historyStackRef.current[historyIndexRef.current]);
        useAppStore.setState({
          activeView: nextState.activeView,
          activeFilter: nextState.activeFilter,
          selectedItemId: nextState.selectedItemId,
          selectedFriendId: null,
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isInitialized || !selectedItemId) return;
    if (items.some((item) => item.globalId === selectedItemId)) return;

    useAppStore.setState({ selectedItemId: null });
  }, [enabled, isInitialized, items, selectedItemId]);

  useEffect(() => {
    if (!enabled) return;

    if (recordTimerRef.current !== null) {
      window.clearTimeout(recordTimerRef.current);
    }

    recordTimerRef.current = window.setTimeout(() => {
      recordTimerRef.current = null;

      if (skipRecordRef.current) {
        skipRecordRef.current = false;
        return;
      }

      const rawState = snapshotNavigationState();
      const knownItemIds = isInitialized ? new Set(items.map((item) => item.globalId)) : null;
      const canonicalState = canonicalizeNavigationState(rawState, { knownItemIds });
      const serialized = serializeNavigationState(canonicalState);

      if (!navigationStatesEqual(rawState, canonicalState)) {
        useAppStore.setState({
          activeView: canonicalState.activeView,
          activeFilter: canonicalState.activeFilter,
          selectedItemId: canonicalState.selectedItemId,
        });
      }

      const currentSerialized = historyStackRef.current[historyIndexRef.current];
      if (currentSerialized === serialized) return;

      if (historyIndexRef.current < historyStackRef.current.length - 1) {
        historyStackRef.current = historyStackRef.current.slice(0, historyIndexRef.current + 1);
      }

      historyStackRef.current.push(serialized);
      historyIndexRef.current = historyStackRef.current.length - 1;
    }, 0);

    return () => {
      if (recordTimerRef.current !== null) {
        window.clearTimeout(recordTimerRef.current);
        recordTimerRef.current = null;
      }
    };
  }, [activeFilter, activeView, enabled, isInitialized, items, selectedItemId]);
}
