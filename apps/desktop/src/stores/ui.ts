import { create } from "zustand";

/** Transient UI state that is not part of a workspace layout. */
interface UiState {
  /** the preview fills the whole window */
  previewFullscreen: boolean;
  setPreviewFullscreen: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  previewFullscreen: false,
  setPreviewFullscreen: (previewFullscreen) => set({ previewFullscreen }),
}));
