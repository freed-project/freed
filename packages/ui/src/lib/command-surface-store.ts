import { create } from "zustand";

export type LibraryDialogTab = "import" | "export";

interface CommandSurfaceStore {
  paletteOpen: boolean;
  addFeedOpen: boolean;
  savedContentOpen: boolean;
  libraryDialogOpen: boolean;
  libraryDialogTab: LibraryDialogTab;
  openPalette: () => void;
  closePalette: () => void;
  openAddFeedDialog: () => void;
  closeAddFeedDialog: () => void;
  openSavedContentDialog: () => void;
  closeSavedContentDialog: () => void;
  openLibraryDialog: (tab?: LibraryDialogTab) => void;
  closeLibraryDialog: () => void;
}

export const useCommandSurfaceStore = create<CommandSurfaceStore>((set) => ({
  paletteOpen: false,
  addFeedOpen: false,
  savedContentOpen: false,
  libraryDialogOpen: false,
  libraryDialogTab: "import",
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openAddFeedDialog: () => set({ addFeedOpen: true }),
  closeAddFeedDialog: () => set({ addFeedOpen: false }),
  openSavedContentDialog: () => set({ savedContentOpen: true }),
  closeSavedContentDialog: () => set({ savedContentOpen: false }),
  openLibraryDialog: (tab = "import") =>
    set({ libraryDialogOpen: true, libraryDialogTab: tab }),
  closeLibraryDialog: () => set({ libraryDialogOpen: false }),
}));
