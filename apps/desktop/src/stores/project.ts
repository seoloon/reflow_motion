import { create } from "zustand";
import { ipc, toUserMessage } from "../lib/ipc";
import type { ProjectInfo, UserMessage } from "../types";
import { useLog } from "./log";

interface ProjectState {
  info: ProjectInfo | null;
  error: UserMessage | null;
  opening: boolean;
  open: (path: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export const useProject = create<ProjectState>((set, get) => ({
  info: null,
  error: null,
  opening: false,
  async open(path) {
    set({ opening: true, error: null });
    try {
      const info = await ipc.openProject(path);
      set({ info, opening: false });
      useLog.getState().push({
        source: "app",
        level: "INFO",
        message: `Opened ${info.root} (${info.compositions.length} compositions)`,
      });
      return true;
    } catch (e) {
      const err = toUserMessage(e);
      useLog.getState().push({ source: "app", level: "ERROR", message: `${err.title} ${err.details}` });
      set({ error: err, opening: false });
      return false;
    }
  },
  async refresh() {
    if (!get().info) return;
    try {
      set({ info: await ipc.refreshProject() });
    } catch (e) {
      useLog.getState().push({ source: "app", level: "WARN", message: toUserMessage(e).details });
    }
  },
}));
