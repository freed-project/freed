import { useCallback, useSyncExternalStore } from "react";
import { useAppStore, usePlatformCapabilities } from "../context/PlatformContext.js";

type ArchiveMutation = (id: string) => Promise<void>;

// Each platform store owns its presentation state. Nothing here is a Library
// edit or an authority receipt; the original mutation still owns both.
function createPendingArchives() {
  const counts = new Map<string, number>();
  let snapshot: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    change(id: string, delta: number) {
      const count = (counts.get(id) ?? 0) + delta;
      if (count > 0) counts.set(id, count);
      else counts.delete(id);
      snapshot = new Set(counts.keys());
      for (const listener of listeners) listener();
    },
  };
}
const pendingByMutation = new WeakMap<ArchiveMutation, ReturnType<typeof createPendingArchives>>();

/** Share pending archive visibility across header, keyboard, reader and cards. */
export function useArchiveAction() {
  const mutate = useAppStore((state) => state.toggleArchived);
  const { libraryEdits } = usePlatformCapabilities();
  let pending = pendingByMutation.get(mutate);
  if (!pending) {
    pending = createPendingArchives();
    pendingByMutation.set(mutate, pending);
  }
  const state = pending;
  const pendingArchiveIds = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  const toggleArchived = useCallback(async (id: string, wasArchived = false) => {
    if (!libraryEdits) throw new Error("This Library is read-only.");
    if (!wasArchived) state.change(id, 1);
    try {
      await mutate(id);
    } finally {
      if (!wasArchived) state.change(id, -1);
    }
  }, [libraryEdits, mutate, state]);
  return { toggleArchived, pendingArchiveIds };
}
