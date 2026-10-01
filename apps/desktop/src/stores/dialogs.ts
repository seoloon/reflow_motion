import { create } from "zustand";

interface DialogState {
  newProjectOpen: boolean;
  setNewProjectOpen: (v: boolean) => void;
  installing: boolean;
  setInstalling: (v: boolean) => void;
}

export const useDialogs = create<DialogState>((set) => ({
  newProjectOpen: false,
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  installing: false,
  setInstalling: (installing) => set({ installing }),
}));
