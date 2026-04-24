import { create } from "zustand";

export type LibraryDialogTab = "import" | "export";

interface CommandSurfaceStore {
  searchPaletteRequestId: number;
  addFeedOpen: boolean;
  savedContentOpen: boolean;
  libraryDialogOpen: boolean;
  libraryDialogTab: LibraryDialogTab;
  requestSearchPalette: () => void;
  openAddFeedDialog: () => void;
  closeAddFeedDialog: () => void;
  openSavedContentDialog: () => void;
  closeSavedContentDialog: () => void;
  openLibraryDialog: (tab?: LibraryDialogTab) => void;
  closeLibraryDialog: () => void;
}

export const useCommandSurfaceStore = create<CommandSurfaceStore>((set) => ({
  searchPaletteRequestId: 0,
  addFeedOpen: false,
  savedContentOpen: false,
  libraryDialogOpen: false,
  libraryDialogTab: "import",
  requestSearchPalette: () =>
    set((state) => ({ searchPaletteRequestId: state.searchPaletteRequestId + 1 })),
  openAddFeedDialog: () => set({ addFeedOpen: true }),
  closeAddFeedDialog: () => set({ addFeedOpen: false }),
  openSavedContentDialog: () => set({ savedContentOpen: true }),
  closeSavedContentDialog: () => set({ savedContentOpen: false }),
  openLibraryDialog: (tab = "import") =>
    set({ libraryDialogOpen: true, libraryDialogTab: tab }),
  closeLibraryDialog: () => set({ libraryDialogOpen: false }),
}));
