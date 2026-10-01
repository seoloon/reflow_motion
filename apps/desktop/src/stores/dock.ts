import { create } from "zustand";
import type { DockTab } from "../lib/workspace";

export type { DockTab };

interface DockState {
  tab: DockTab;
  setTab: (t: DockTab) => void;
}

export const useDock = create<DockState>((set) => ({ tab: "timeline", setTab: (tab) => set({ tab }) }));
