import { create } from "zustand";

export type Selection =
  | { kind: "composition" }
  | { kind: "layer"; file: string; line: number }
  | { kind: "runtimeLayer"; key: string }
  | { kind: "animation"; file: string; line: number }
  | { kind: "keyframe"; file: string; line: number; index: number }
  | null;

interface SelectionState {
  selection: Selection;
  select: (s: Selection) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selection: { kind: "composition" },
  select: (selection) => set({ selection }),
}));
