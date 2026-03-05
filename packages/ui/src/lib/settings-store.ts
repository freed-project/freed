/**
 * settings-store — lightweight Zustand store for controlling the
 * SettingsDialog from outside the UI component tree.
 *
 * Any package (desktop, pwa) can call openTo() to programmatically open
 * the dialog pre-scrolled to a named section. Mirrors the debug-store pattern.
 */

import { create } from "zustand";

interface SettingsStore {
  open: boolean;
  /** Section to scroll to when the dialog opens. Cleared after consumption. */
  targetSection: string | null;
  openTo: (section: string) => void;
  openDefault: () => void;
  close: () => void;
  clearTarget: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  open: false,
  targetSection: null,
  openTo: (section) => set({ open: true, targetSection: section }),
  openDefault: () => set({ open: true, targetSection: null }),
  close: () => set({ open: false, targetSection: null }),
  clearTarget: () => set({ targetSection: null }),
}));
