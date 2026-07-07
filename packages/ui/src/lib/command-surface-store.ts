import { create } from "zustand";

export type LibraryDialogTab = "import" | "export";

interface CommandSurfaceStore {
  searchPaletteRequestId: number;
  addFeedOpen: boolean;
  savedContentOpen: boolean;
  savedContentInitialUrl: string;
  libraryDialogOpen: boolean;
  libraryDialogTab: LibraryDialogTab;
  requestSearchPalette: () => void;
  openAddFeedDialog: () => void;
  closeAddFeedDialog: () => void;
  openSavedContentDialog: (initialUrl?: string) => void;
  closeSavedContentDialog: () => void;
  openLibraryDialog: (tab?: LibraryDialogTab) => void;
  closeLibraryDialog: () => void;
}

export const useCommandSurfaceStore = create<CommandSurfaceStore>((set) => ({
  searchPaletteRequestId: 0,
  addFeedOpen: false,
  savedContentOpen: false,
  savedContentInitialUrl: "",
  libraryDialogOpen: false,
  libraryDialogTab: "import",
  requestSearchPalette: () =>
    set((state) => ({ searchPaletteRequestId: state.searchPaletteRequestId + 1 })),
  openAddFeedDialog: () => set({ addFeedOpen: true }),
  closeAddFeedDialog: () => set({ addFeedOpen: false }),
  openSavedContentDialog: (initialUrl = "") =>
    set({ savedContentOpen: true, savedContentInitialUrl: initialUrl }),
  closeSavedContentDialog: () =>
    set({ savedContentOpen: false, savedContentInitialUrl: "" }),
  openLibraryDialog: (tab = "import") =>
    set({ libraryDialogOpen: true, libraryDialogTab: tab }),
  closeLibraryDialog: () => set({ libraryDialogOpen: false }),
}));
