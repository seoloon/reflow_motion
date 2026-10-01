import { create } from "zustand";
import type { LogLine } from "../types";

const MAX_LINES = 2000;

interface LogState {
  lines: LogLine[];
  push: (line: LogLine) => void;
  clear: () => void;
}

/** Diagnostics log: application, Remotion and process output with levels. */
export const useLog = create<LogState>((set) => ({
  lines: [],
  push: (line) => set((s) => ({ lines: [...s.lines.slice(-(MAX_LINES - 1)), line] })),
  clear: () => set({ lines: [] }),
}));
