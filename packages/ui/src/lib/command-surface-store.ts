import { retainRenderedAnnotationSnapshot, type LibraryCoreHydratedAnnotations } from "@freed/shared/library-core";
import { toast } from "../components/Toast.js";
import { create } from "zustand";
import type { FeedItem } from "@freed/shared";

export type LibraryDialogTab = "import" | "export";

interface CommandSurfaceStore {
  searchPaletteRequestId: number;
  copyFriendsDiagnosticsRequestId: number;
  addFeedOpen: boolean;
  savedContentOpen: boolean;
  savedContentInitialUrl: string;
  savedContentEditItem: FeedItem | null;
  savedContentAnnotations: LibraryCoreHydratedAnnotations | null;
  libraryDialogOpen: boolean;
  libraryDialogTab: LibraryDialogTab;
  requestSearchPalette: () => void;
  requestCopyFriendsDiagnostics: () => void;
  openAddFeedDialog: () => void;
  closeAddFeedDialog: () => void;
  openSavedContentDialog: (initialUrl?: string) => void;
  openSavedContentEditor: (item: FeedItem, annotations?: LibraryCoreHydratedAnnotations | null) => void;
  closeSavedContentDialog: () => void;
  openLibraryDialog: (tab?: LibraryDialogTab) => void;
  closeLibraryDialog: () => void;
}

export const useCommandSurfaceStore = create<CommandSurfaceStore>((set) => ({
  searchPaletteRequestId: 0,
  copyFriendsDiagnosticsRequestId: 0,
  addFeedOpen: false,
  savedContentOpen: false,
  savedContentInitialUrl: "",
  savedContentEditItem: null,
  savedContentAnnotations: null,
  libraryDialogOpen: false,
  libraryDialogTab: "import",
  requestSearchPalette: () =>
    set((state) => ({ searchPaletteRequestId: state.searchPaletteRequestId + 1 })),
  requestCopyFriendsDiagnostics: () =>
    set((state) => ({
      copyFriendsDiagnosticsRequestId: state.copyFriendsDiagnosticsRequestId + 1,
    })),
  openAddFeedDialog: () => set({ addFeedOpen: true }),
  closeAddFeedDialog: () => set({ addFeedOpen: false }),
  openSavedContentDialog: (initialUrl = "") =>
    set({
      savedContentOpen: true,
      savedContentInitialUrl: initialUrl,
      savedContentEditItem: null,
      savedContentAnnotations: null,
    }),
  openSavedContentEditor: (item, annotations) => {
    try {
      const snapshot = retainRenderedAnnotationSnapshot(annotations, item.globalId);
      if (JSON.stringify(item.userState.highlights ?? []) !== JSON.stringify(snapshot.highlights) ||
          JSON.stringify(item.userState.tags) !== JSON.stringify(snapshot.originals.tags)) {
        throw new Error("Annotations changed. Reopen the item before editing.");
      }
      set({ savedContentOpen: true,
        savedContentInitialUrl: item.sourceUrl ?? item.content.linkPreview?.url ?? "",
        savedContentEditItem: item, savedContentAnnotations: snapshot });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Annotations are unavailable for editing");
    }
  },
  closeSavedContentDialog: () =>
    set({
      savedContentOpen: false,
      savedContentInitialUrl: "",
      savedContentEditItem: null,
      savedContentAnnotations: null,
    }),
  openLibraryDialog: (tab = "import") =>
    set({ libraryDialogOpen: true, libraryDialogTab: tab }),
  closeLibraryDialog: () => set({ libraryDialogOpen: false }),
}));
