import { create } from "zustand";

export type PaletteMode = "commands" | "files";

interface PaletteState {
  open: boolean;
  mode: PaletteMode;
  show: (mode: PaletteMode) => void;
  hide: () => void;
  /** keyboard shortcuts dialog */
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  mode: "commands",
  show: (mode) => set({ open: true, mode }),
  hide: () => set({ open: false }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));
